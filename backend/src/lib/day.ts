// ประกอบ "กะของวัน" จากตาราง shifts + attendance + status_overrides แล้วคำนวณสถานะตอนอ่าน

import { and, asc, count, eq, gte, inArray, isNull, lte, or, gt } from 'drizzle-orm'
import type { DayLogRow, KioskBoard, LeaveDuration, OverrideStatus } from '../contract.js'
import { db, schema, type Tx } from '../db/index.js'
import type { AttendanceRow, EmployeeRow, OverrideRow, ShiftRow } from '../db/schema.js'
import { computeStatus } from './status.js'
import { getSettings } from './settings.js'
import { addDays, clockOf, localParts, minutesOf, weekdayOf } from './time.js'

export interface InstanceRecord {
  date: string
  shift: ShiftRow
  employee: EmployeeRow
  projectName: string
  attendance: AttendanceRow | null
  /** override ล่าสุด (status อาจเป็น null = ถูกล้างแล้ว) */
  override: OverrideRow | null
  row: DayLogRow
}

export interface RangeResult {
  holidays: Map<string, string>
  byDate: Map<string, InstanceRecord[]>
}

/** กะนี้ใช้ได้ในวันนี้หรือไม่ */
export function shiftValidOn(s: Pick<ShiftRow, 'validFrom' | 'validTo' | 'weekday'>, date: string): boolean {
  return s.weekday === weekdayOf(date) && s.validFrom <= date && (s.validTo === null || s.validTo > date)
}

/** คนที่ถูกซ่อนยังปรากฏในวันก่อนหน้าวันที่ถูกซ่อน เพื่อให้รายงานย้อนหลังไม่เปลี่ยน */
function employeeVisibleOn(e: EmployeeRow, date: string): boolean {
  if (e.isActive) return true
  return !!e.deactivatedAt && localParts(e.deactivatedAt).date > date
}

export async function loadRange(
  from: string,
  to: string,
  opts: { employeeId?: string; now?: Date; tx?: Tx; withHistory?: boolean; includeHidden?: boolean } = {},
): Promise<RangeResult> {
  const q = opts.tx ?? db
  const now = opts.now ?? new Date()
  const settings = await getSettings()

  const shiftRows = await q
    .select({ shift: schema.shifts, employee: schema.employees, projectName: schema.projects.name })
    .from(schema.shifts)
    .innerJoin(schema.employees, eq(schema.shifts.employeeId, schema.employees.id))
    .innerJoin(schema.projects, eq(schema.shifts.projectId, schema.projects.id))
    .where(
      and(
        lte(schema.shifts.validFrom, to),
        or(isNull(schema.shifts.validTo), gt(schema.shifts.validTo, from)),
        opts.employeeId ? eq(schema.shifts.employeeId, opts.employeeId) : undefined,
      ),
    )

  const holidayRows = await q
    .select()
    .from(schema.holidays)
    .where(and(gte(schema.holidays.date, from), lte(schema.holidays.date, to)))
  const holidays = new Map(holidayRows.map((h) => [h.date, h.name]))

  const byDate = new Map<string, InstanceRecord[]>()
  if (shiftRows.length === 0) return { holidays, byDate }

  const shiftIds = shiftRows.map((r) => r.shift.id)
  const inRange = (col: typeof schema.attendance.date | typeof schema.statusOverrides.date) =>
    and(gte(col, from), lte(col, to))

  const attRows = await q
    .select()
    .from(schema.attendance)
    .where(and(inRange(schema.attendance.date), inArray(schema.attendance.shiftId, shiftIds)))
  const att = new Map(attRows.map((a) => [`${a.shiftId}|${a.date}`, a]))

  const ovRows = await q
    .select()
    .from(schema.statusOverrides)
    .where(and(inRange(schema.statusOverrides.date), inArray(schema.statusOverrides.shiftId, shiftIds)))
    .orderBy(asc(schema.statusOverrides.createdAt))
  const ov = new Map<string, OverrideRow>()
  for (const o of ovRows) ov.set(`${o.shiftId}|${o.date}`, o) // แถวหลังทับแถวก่อน = ค่าล่าสุด

  const leaveRows = await q
    .select({ day: schema.leaveRequestDays })
    .from(schema.leaveRequestDays)
    .innerJoin(schema.leaveRequests, eq(schema.leaveRequestDays.leaveRequestId, schema.leaveRequests.id))
    .where(
      and(
        gte(schema.leaveRequestDays.date, from),
        lte(schema.leaveRequestDays.date, to),
        inArray(schema.leaveRequestDays.shiftId, shiftIds),
        eq(schema.leaveRequests.status, 'approved'),
      ),
    )
  const leaves = new Map(leaveRows.map(({ day }) => [`${day.shiftId}|${day.date}`, day.portion as LeaveDuration]))

  const history = new Map<string, number>()
  if (opts.withHistory) {
    const rows = await q
      .select({ shiftId: schema.auditLog.shiftId, date: schema.auditLog.date, n: count() })
      .from(schema.auditLog)
      .where(and(gte(schema.auditLog.date, from), lte(schema.auditLog.date, to), inArray(schema.auditLog.shiftId, shiftIds)))
      .groupBy(schema.auditLog.shiftId, schema.auditLog.date)
    for (const r of rows) history.set(`${r.shiftId}|${r.date}`, Number(r.n))
  }

  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (holidays.has(date)) continue // วันหยุด → ไม่นับ
    const list: InstanceRecord[] = []
    for (const { shift, employee, projectName } of shiftRows) {
      if (!shiftValidOn(shift, date)) continue
      if (!opts.includeHidden && !employeeVisibleOn(employee, date)) continue
      const key = `${shift.id}|${date}`
      const a = att.get(key) ?? null
      const o = ov.get(key) ?? null
      const overrideStatus = (o?.status ?? null) as OverrideStatus | null
      const leavePortion = leaves.get(key) ?? null
      const status = computeStatus({
        date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        holiday: false,
        override: overrideStatus,
        scannedAt: a?.scannedAt ?? null,
        isOffsite: a?.isOffsite ?? false,
        leavePortion,
        lateGraceMinutes: settings.lateGraceMinutes,
        now,
      })!
      list.push({
        date,
        shift,
        employee,
        projectName,
        attendance: a,
        override: o,
        row: {
          shiftId: shift.id,
          employeeId: employee.id,
          nickname: employee.nickname,
          gen: employee.gen,
          projectName,
          startTime: shift.startTime,
          endTime: shift.endTime,
          scannedAt: a ? clockOf(a.scannedAt) : null,
          earlyLeaveAt: a?.earlyLeaveAt ? clockOf(a.earlyLeaveAt) : null,
          checkedOutAt: a?.checkedOutAt ? clockOf(a.checkedOutAt) : null,
          status,
          recordedBy: a ? (a.recordedBy === 'self' ? 'self' : 'admin') : null,
          checkedOutBy: a?.checkedOutBy
            ? a.checkedOutBy === 'self'
              ? 'self'
              : a.checkedOutBy === 'system'
                ? 'system'
                : 'admin'
            : null,
          leavePortion,
          adminNote: o?.status ? o.note || null : null,
          overridden: !!overrideStatus,
          historyCount: history.get(key) ?? 0,
        },
      })
    }
    list.sort(
      (x, y) =>
        minutesOf(x.shift.startTime) - minutesOf(y.shift.startTime) ||
        x.employee.nickname.localeCompare(y.employee.nickname, 'th') ||
        (x.employee.gen ?? '').localeCompare(y.employee.gen ?? ''),
    )
    byDate.set(date, list)
  }
  return { holidays, byDate }
}

export async function loadDay(date: string, opts: { employeeId?: string; now?: Date; tx?: Tx; withHistory?: boolean } = {}) {
  const r = await loadRange(date, date, opts)
  return { holiday: r.holidays.get(date) ?? null, records: r.byDate.get(date) ?? [] }
}

export function summarize(rows: { status: string; leavePortion?: string | null }[], nowTime?: string): KioskBoard['summary'] {
  const s: KioskBoard['summary'] = { expected: rows.length, arrived: 0, late: 0, pending: 0, leave: 0, absent: 0, offsite: 0 }
  for (const r of rows) {
    const activeHalfLeave =
      !!nowTime &&
      ((r.leavePortion === 'morning' && nowTime < '13:00:00') ||
        (r.leavePortion === 'afternoon' && nowTime >= '13:00:00'))
    if (activeHalfLeave) {
      s.leave++
      continue
    }
    if (r.status === 'ontime') s.arrived++
    else if (r.status === 'late') {
      s.arrived++
      s.late++
    } else if (r.status === 'offsite') {
      s.arrived++
      s.offsite = (s.offsite ?? 0) + 1
    } else if (r.status === 'pending') s.pending++
    else if (r.status === 'leave') s.leave++
    else if (r.status === 'absent') s.absent++
  }
  return s
}
