import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { zoned } from '../lib/time.js'

const GRACE_MS = 5 * 60_000

/** เติมเวลาออกให้รายการที่เลยเวลาเลิกกะ 5 นาที บันทึกเป็นเวลาเลิกงานตามกะ */
export async function reconcileAutoCheckouts(now = new Date()): Promise<number> {
  const rows = await db
    .select({ attendance: schema.attendance, endTime: schema.shifts.endTime })
    .from(schema.attendance)
    .innerJoin(schema.shifts, eq(schema.attendance.shiftId, schema.shifts.id))
    .where(isNull(schema.attendance.checkedOutAt))
  let updated = 0
  for (const { attendance, endTime } of rows) {
    const scheduledEnd = zoned(attendance.date, endTime)
    if (now.getTime() < scheduledEnd.getTime() + GRACE_MS) continue
    const result = await db
      .update(schema.attendance)
      .set({ checkedOutAt: scheduledEnd, checkedOutBy: 'system' })
      .where(and(eq(schema.attendance.id, attendance.id), isNull(schema.attendance.checkedOutAt)))
      .returning({ id: schema.attendance.id })
    updated += result.length
  }
  return updated
}
