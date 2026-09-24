// การเช็กชื่อของพนักงาน (spec หัวข้อ 8)

import { and, eq } from 'drizzle-orm'
import type { CheckInView } from '../contract.js'
import { db, schema } from '../db/index.js'
import type { EmployeeRow } from '../db/schema.js'
import { loadDay, type InstanceRecord } from '../lib/day.js'
import { selectShift } from '../lib/selection.js'
import { getSettings } from '../lib/settings.js'
import { isLate } from '../lib/status.js'
import { localParts, zoned } from '../lib/time.js'
import { validateCheckinLocation, type CheckinLocation } from '../lib/location.js'

/** ต้องมีอีเมลอยู่ในตารางพนักงานและยังไม่ถูกซ่อน ห้ามสร้างผู้ใช้ใหม่อัตโนมัติเด็ดขาด */
export async function findActiveEmployee(email: string): Promise<EmployeeRow | null> {
  const [e] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.email, email.toLowerCase()), eq(schema.employees.isActive, true)))
  return e ?? null
}

interface ViewResult {
  view: CheckInView
  record: InstanceRecord | null
  date: string
}

/**
 * ตัดสินว่าจะแสดงหน้าไหน โดยใช้ "เวลาที่สแกน" เป็นเวลาอ้างอิง ไม่ใช่เวลาที่กลับมาจากหน้า Google
 */
export async function buildView(employee: EmployeeRow, scannedAt: Date): Promise<ViewResult> {
  const { date, time } = localParts(scannedAt)
  const nickname = employee.nickname
  const { holiday, records } = await loadDay(date, { employeeId: employee.id })
  if (holiday || records.length === 0) return { view: { kind: 'no_shift_today', nickname }, record: null, date }

  const sel = selectShift(
    records.map((r) => ({
      shiftId: r.shift.id,
      startTime: r.row.leavePortion === 'morning' && r.shift.endTime > '13:00' ? '13:00' : r.shift.startTime,
      endTime: r.shift.endTime,
      attended:
        !!r.attendance ||
        ['present', 'late', 'offsite'].includes(r.override?.status ?? '') ||
        ['ontime', 'late', 'offsite'].includes(r.row.status) ||
        r.row.leavePortion === 'full_day' ||
        (r.row.leavePortion === 'morning' && r.shift.endTime <= '13:00') ||
        (r.row.leavePortion === 'afternoon' && r.shift.startTime >= '13:00') ||
        (r.row.leavePortion === 'afternoon' && time >= '13:00:00'),
      earlyLeft: !!r.attendance?.earlyLeaveAt,
      checkedOut:
        !!r.attendance?.checkedOutAt ||
        r.row.leavePortion === 'full_day' ||
        (r.row.leavePortion === 'morning' && r.shift.endTime <= '13:00') ||
        (r.row.leavePortion === 'afternoon' && r.shift.startTime >= '13:00') ||
        (r.row.leavePortion === 'afternoon' && time >= '13:00:00'),
      override: r.override?.status ?? null,
    })),
    time,
  )
  const find = (id: string) => records.find((r) => r.shift.id === id)!

  if ('shiftId' in sel) {
    const selected = find(sel.shiftId)
    if (selected.row.leavePortion === 'morning' && selected.shift.endTime > '13:00' && time < '13:00:00') {
      return {
        view: { kind: 'too_early_for_shift', nickname, startTime: '13:00', availableFrom: '13:00' },
        record: null,
        date,
      }
    }
  }

  switch (sel.kind) {
    case 'no_shift_today':
    case 'all_done':
      return { view: { kind: sel.kind, nickname }, record: null, date }
    case 'too_early':
      return { view: { kind: 'too_early', nickname, previousEndTime: sel.previousEndTime }, record: null, date }
    case 'too_early_for_shift':
      return {
        view: {
          kind: 'too_early_for_shift',
          nickname,
          startTime: sel.startTime,
          availableFrom: sel.availableFrom,
        },
        record: null,
        date,
      }
    case 'ready': {
      const r = find(sel.shiftId)
      return {
        view: {
          kind: 'ready',
          nickname,
          shift: r.row.leavePortion === 'morning' && r.shift.endTime > '13:00' ? { ...r.row, startTime: '13:00' } : r.row,
          scannedAt: time,
          isUpdate: sel.isUpdate,
        },
        record: r,
        date,
      }
    }
    case 'ready_checkout': {
      const r = find(sel.shiftId)
      return { view: { kind: 'ready_checkout', nickname, shift: r.row, scannedAt: time }, record: r, date }
    }
    case 'early_leave': {
      const r = find(sel.shiftId)
      return {
        view: { kind: 'early_leave', nickname, shift: r.row, minutesRemaining: sel.minutesRemaining },
        record: r,
        date,
      }
    }
  }
}

/** กดยืนยันเช็กชื่อ บันทึกเวลาที่สแกน ไม่ใช่เวลาที่กดปุ่ม */
export async function confirmCheckIn(
  employee: EmployeeRow,
  scannedAt: Date,
  rawLocation?: Partial<CheckinLocation> | null,
): Promise<{ view: CheckInView; acted: boolean }> {
  const current = await buildView(employee, scannedAt)
  if (current.view.kind !== 'ready' || !current.record) return { view: current.view, acted: false }
  const shift = current.record.shift
  const settings = await getSettings()
  const location = validateCheckinLocation(rawLocation, settings)

  // ถ้าเช็กครั้งแรกจะ insert ถ้าสแกนซ้ำก่อนเวลากะจะ update scannedAt ให้เป็นเวลาล่าสุด
  await db
    .insert(schema.attendance)
    .values({
      employeeId: employee.id,
      shiftId: shift.id,
      date: current.date,
      scannedAt,
      recordedBy: 'self',
      checkinLatitude: location.latitude,
      checkinLongitude: location.longitude,
      checkinAccuracyMeters: location.accuracy,
      checkinDistanceMeters: location.distance,
    })
    .onConflictDoUpdate({
      target: [schema.attendance.shiftId, schema.attendance.date],
      set: {
        scannedAt,
        recordedBy: 'self',
        checkinLatitude: location.latitude,
        checkinLongitude: location.longitude,
        checkinAccuracyMeters: location.accuracy,
        checkinDistanceMeters: location.distance,
      },
    })

  const { records } = await loadDay(current.date, { employeeId: employee.id })
  const r = records.find((x) => x.shift.id === shift.id)!
  const at = r.attendance?.scannedAt ?? scannedAt
  return {
    view: {
      kind: 'done',
      nickname: employee.nickname,
      shift: r.row,
      status: isLate(
        at,
        current.date,
        current.record.row.leavePortion === 'morning' ? '13:00' : shift.startTime,
        settings.lateGraceMinutes,
      )
        ? 'late'
        : 'ontime',
    },
    acted: true,
  }
}

/** แจ้งกลับก่อนเวลา เมื่อยืนยันแล้วกะนั้นถือว่าจบ สแกนกลับเข้ามาใหม่ไม่ได้ แก้ได้เฉพาะแอดมิน */
export async function confirmEarlyLeave(employee: EmployeeRow, scannedAt: Date): Promise<{ view: CheckInView; acted: boolean }> {
  const current = await buildView(employee, scannedAt)
  if (current.view.kind !== 'early_leave' || !current.record) return { view: current.view, acted: false }
  const shift = current.record.shift

  const checkinTime = current.record.attendance?.scannedAt ?? zoned(current.date, shift.startTime)
  const recordedBy = current.record.attendance?.recordedBy ?? current.record.override?.adminEmail ?? 'admin'

  await db
    .insert(schema.attendance)
    .values({
      employeeId: employee.id,
      shiftId: shift.id,
      date: current.date,
      scannedAt: checkinTime,
      recordedBy,
      earlyLeaveAt: scannedAt,
      earlyLeaveBy: 'self',
    })
    .onConflictDoUpdate({
      target: [schema.attendance.shiftId, schema.attendance.date],
      set: { earlyLeaveAt: scannedAt, earlyLeaveBy: 'self' },
    })

  const { records } = await loadDay(current.date, { employeeId: employee.id })
  const r = records.find((x) => x.shift.id === shift.id)!
  return { view: { kind: 'early_leave_done', nickname: employee.nickname, shift: r.row }, acted: true }
}

/** กดยืนยันออกงาน บันทึกเวลาที่สแกน ไม่ใช่เวลาที่กดปุ่ม */
export async function confirmCheckOut(employee: EmployeeRow, scannedAt: Date): Promise<{ view: CheckInView; acted: boolean }> {
  const current = await buildView(employee, scannedAt)
  if (current.view.kind !== 'ready_checkout' || !current.record) return { view: current.view, acted: false }
  const shift = current.record.shift

  const checkinTime = current.record.attendance?.scannedAt ?? zoned(current.date, shift.startTime)
  const recordedBy = current.record.attendance?.recordedBy ?? current.record.override?.adminEmail ?? 'admin'

  await db
    .insert(schema.attendance)
    .values({
      employeeId: employee.id,
      shiftId: shift.id,
      date: current.date,
      scannedAt: checkinTime,
      recordedBy,
      checkedOutAt: scannedAt,
      checkedOutBy: 'self',
    })
    .onConflictDoUpdate({
      target: [schema.attendance.shiftId, schema.attendance.date],
      set: { checkedOutAt: scannedAt, checkedOutBy: 'self' },
    })

  const s = await getSettings()
  const { records } = await loadDay(current.date, { employeeId: employee.id })
  const r = records.find((x) => x.shift.id === shift.id)!
  return {
    view: {
      kind: 'checkout_done',
      nickname: employee.nickname,
      shift: r.row,
      lineOaUrl: s.lineOaUrl ?? null,
    },
    acted: true,
  }
}
