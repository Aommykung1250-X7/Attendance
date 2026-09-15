// หน้าบันทึกประจำวันของแอดมิน (spec 9.6)
// ทุกการกดบันทึกว่าใครกด กดเมื่อไหร่ และค่าเดิมคืออะไร

import { and, eq } from 'drizzle-orm'
import type { AdminAction, DayLog, DayLogRow, OverrideStatus } from '../contract.js'
import { db, schema } from '../db/index.js'
import { loadDay, shiftValidOn, summarize, type InstanceRecord } from '../lib/day.js'
import { badRequest, notFound } from '../lib/http.js'
import { clockOf, isHHMM, localParts, thaiDateLabel, zoned } from '../lib/time.js'
import { audit, type SnapState } from './audit.js'

export async function dayLog(date: string): Promise<DayLog> {
  const now = new Date()
  const { holiday, records } = await loadDay(date, { now, withHistory: true })
  const rows = records.map((r) => r.row)
  return {
    date,
    dateLabel: thaiDateLabel(date),
    isToday: localParts(now).date === date,
    holiday,
    summary: summarize(rows),
    rows,
  }
}

const snap = (r: InstanceRecord): SnapState => ({
  status: r.row.status,
  scannedAt: r.row.scannedAt,
  earlyLeaveAt: r.row.earlyLeaveAt,
  checkedOutAt: r.row.checkedOutAt ?? null,
})

const OVERRIDES: OverrideStatus[] = ['leave', 'present', 'late', 'absent']

export async function adminAction(adminEmail: string, shiftId: string, date: string, act: AdminAction): Promise<DayLogRow> {
  const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId))
  if (!shift || !shiftValidOn(shift, date)) throw notFound('ไม่พบกะนี้ในวันที่เลือก')

  const { holiday, records } = await loadDay(date, { employeeId: shift.employeeId, withHistory: true })
  if (holiday) throw badRequest(`วันที่เลือกเป็นวันหยุด (${holiday})`)
  const rec = records.find((r) => r.shift.id === shiftId)
  if (!rec) throw notFound('ไม่พบกะนี้ในวันที่เลือก')

  const note = typeof act.note === 'string' ? act.note.trim().slice(0, 500) : ''
  const now = new Date()
  const extra: Record<string, unknown> = {}
  let updated: InstanceRecord | undefined

  await db.transaction(async (tx) => {
    const clearOverride = async () => {
      if (!rec.override?.status) return
      await tx.insert(schema.statusOverrides).values({
        employeeId: shift.employeeId,
        shiftId,
        date,
        status: null,
        previousStatus: rec.row.status,
        adminEmail,
        note,
      })
    }
    const whereAtt = and(eq(schema.attendance.shiftId, shiftId), eq(schema.attendance.date, date))

    switch (act.action) {
      case 'checkin': {
        // กดเช็กชื่อแทนคนที่ลืมมือถือหรือแบตหมด แอดมินใส่เวลาที่มาถึงจริงได้
        if (!isHHMM(act.time)) throw badRequest('เวลาต้องอยู่ในรูป HH:MM')
        if (rec.attendance) throw badRequest(`มีการเช็กชื่อแล้ว เวลา ${rec.row.scannedAt} ถ้าต้องการเปลี่ยนให้ใช้แก้สถานะ`)
        const at = zoned(date, act.time)
        if (at.getTime() > now.getTime()) throw badRequest('เวลาที่เช็กชื่อต้องไม่อยู่ในอนาคต')
        await tx.insert(schema.attendance).values({
          employeeId: shift.employeeId,
          shiftId,
          date,
          scannedAt: at,
          recordedBy: adminEmail,
        })
        // สถานะที่แก้ไว้ก่อนหน้า (เช่น ขาด) ไม่ควรบังการเช็กชื่อที่เพิ่งบันทึก
        await clearOverride()
        extra.time = act.time
        break
      }
      case 'undo_checkin': {
        if (!rec.attendance) throw badRequest('กะนี้ยังไม่มีการเช็กชื่อ')
        if (rec.attendance.recordedBy === 'self')
          throw badRequest('การเช็กชื่อนี้พนักงานสแกนเอง ลบไม่ได้ ถ้าต้องการเปลี่ยนให้ใช้แก้สถานะ')
        await tx.delete(schema.attendance).where(whereAtt)
        break
      }
      case 'checkout': {
        if (!isHHMM(act.time)) throw badRequest('เวลาต้องอยู่ในรูป HH:MM')
        if (!rec.attendance) throw badRequest('ต้องเช็กชื่อเข้าก่อน จึงจะบันทึกเวลาออกได้')
        if (rec.attendance.earlyLeaveAt) throw badRequest('กะนี้แจ้งกลับก่อนเวลาไว้แล้ว')
        const at = zoned(date, act.time)
        if (at.getTime() < rec.attendance.scannedAt.getTime())
          throw badRequest(`เวลาออกต้องอยู่หลังเวลาเข้า (${clockOf(rec.attendance.scannedAt).slice(0, 5)})`)
        await tx.update(schema.attendance).set({ checkedOutAt: at, checkedOutBy: adminEmail }).where(whereAtt)
        extra.time = act.time
        break
      }
      case 'clear_checkout': {
        if (!rec.attendance?.checkedOutAt) throw badRequest('กะนี้ยังไม่ได้บันทึกเวลาออกงาน')
        await tx.update(schema.attendance).set({ checkedOutAt: null, checkedOutBy: null }).where(whereAtt)
        break
      }
      case 'early_leave': {
        if (!isHHMM(act.time)) throw badRequest('เวลาต้องอยู่ในรูป HH:MM')
        if (!rec.attendance) throw badRequest('ต้องเช็กชื่อเข้าก่อน จึงจะแจ้งกลับก่อนเวลาได้')
        if (rec.attendance.earlyLeaveAt) throw badRequest(`แจ้งกลับก่อนไว้แล้ว เวลา ${rec.row.earlyLeaveAt}`)
        const at = zoned(date, act.time)
        if (at.getTime() < rec.attendance.scannedAt.getTime())
          throw badRequest(`เวลากลับต้องอยู่หลังเวลาเข้า (${clockOf(rec.attendance.scannedAt).slice(0, 5)})`)
        if (at.getTime() > now.getTime()) throw badRequest('เวลากลับต้องไม่อยู่ในอนาคต')
        await tx.update(schema.attendance).set({ earlyLeaveAt: at, earlyLeaveBy: adminEmail }).where(whereAtt)
        extra.time = act.time
        break
      }
      case 'clear_early_leave': {
        if (!rec.attendance?.earlyLeaveAt) throw badRequest('กะนี้ไม่ได้แจ้งกลับก่อนเวลา')
        await tx.update(schema.attendance).set({ earlyLeaveAt: null, earlyLeaveBy: null }).where(whereAtt)
        break
      }
      case 'set_status': {
        if (!OVERRIDES.includes(act.status)) throw badRequest('สถานะไม่ถูกต้อง')
        await tx.insert(schema.statusOverrides).values({
          employeeId: shift.employeeId,
          shiftId,
          date,
          status: act.status,
          previousStatus: rec.row.status,
          adminEmail,
          note,
        })
        break
      }
      case 'clear_status': {
        if (!rec.override?.status) throw badRequest('กะนี้ไม่มีสถานะที่แก้ไว้')
        await clearOverride()
        break
      }
      default:
        throw badRequest('ไม่รู้จักคำสั่งนี้')
    }

    const after = await loadDay(date, { employeeId: shift.employeeId, tx })
    updated = after.records.find((r) => r.shift.id === shiftId)!
    await audit(tx, {
      adminEmail,
      action: act.action,
      employeeId: shift.employeeId,
      shiftId,
      date,
      before: snap(rec),
      after: { ...snap(updated), ...extra },
      note,
    })
  })

  return { ...updated!.row, historyCount: rec.row.historyCount + 1 }
}
