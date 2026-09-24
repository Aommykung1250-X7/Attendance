import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { autoCheckoutDueAt } from '../lib/auto-checkout.js'
import { getSettings } from '../lib/settings.js'
import { zoned } from '../lib/time.js'

/** เติมเวลาออกตามโหมดที่แอดมินเลือก โดยบันทึกเป็นเวลาเลิกงานตามกะ */
export async function reconcileAutoCheckouts(now = new Date()): Promise<number> {
  const settings = await getSettings()
  const rows = await db
    .select({ attendance: schema.attendance, endTime: schema.shifts.endTime })
    .from(schema.attendance)
    .innerJoin(schema.shifts, eq(schema.attendance.shiftId, schema.shifts.id))
    .where(and(isNull(schema.attendance.checkedOutAt), isNull(schema.attendance.earlyLeaveAt)))
  let updated = 0
  for (const { attendance, endTime } of rows) {
    const scheduledEnd = zoned(attendance.date, endTime)
    const dueAt = autoCheckoutDueAt(attendance.date, endTime, settings.autoCheckoutMode as 'after_shift_5m' | 'end_of_day')
    if (now.getTime() < dueAt.getTime()) continue
    const result = await db
      .update(schema.attendance)
      .set({ checkedOutAt: scheduledEnd, checkedOutBy: 'system' })
      .where(and(eq(schema.attendance.id, attendance.id), isNull(schema.attendance.checkedOutAt)))
      .returning({ id: schema.attendance.id })
    updated += result.length
  }
  return updated
}
