// รายงานรายเดือนรายบุคคล (spec 9.7)
// แสดงทีละคนเสมอ ไม่มีตารางรวมทุกคน เพื่อไม่ให้คนหนึ่งเห็นสถิติของคนอื่นทั้งออฟฟิศ

import { eq } from 'drizzle-orm'
import type { MonthlyReport } from '../contract.js'
import { db, schema } from '../db/index.js'
import { loadRange } from '../lib/day.js'
import { notFound } from '../lib/http.js'
import { toEmployee } from '../lib/mappers.js'
import { localParts, monthDays, thaiShortDateLabel } from '../lib/time.js'

export async function monthlyReport(employeeId: string, month: string): Promise<MonthlyReport> {
  const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId))
  if (!e) throw notFound('ไม่พบพนักงานคนนี้')

  const now = new Date()
  const today = localParts(now).date
  const all = monthDays(month)
  const from = all[0]
  const to = all[all.length - 1] < today ? all[all.length - 1] : today
  const totals: MonthlyReport['totals'] = { workdays: 0, present: 0, late: 0, leave: 0, absent: 0, earlyLeave: 0, offsite: 0, leaveFullDays: 0, leaveMornings: 0, leaveAfternoons: 0 }
  const days: MonthlyReport['days'] = []

  if (from <= to) {
    const { byDate } = await loadRange(from, to, { employeeId, now, includeHidden: true })
    for (const [date, records] of byDate) {
      if (records.length === 0) continue
      const entries = records.map((r) => r.row)
      days.push({ date, dateLabel: thaiShortDateLabel(date), entries })

      // วันที่ทุกกะยังเป็น "ยังไม่มา" (เช่นวันนี้ช่วงเช้า) ยังไม่นับเป็นวันทำงาน
      if (entries.some((x) => x.status !== 'pending')) totals.workdays++
      if (entries.some((x) => x.status === 'ontime' || x.status === 'late' || x.status === 'offsite')) totals.present++
      const leavePortions = new Set(entries.map((x) => x.leavePortion).filter(Boolean))
      if (leavePortions.has('full_day')) totals.leaveFullDays = (totals.leaveFullDays ?? 0) + 1
      if (leavePortions.has('morning')) totals.leaveMornings = (totals.leaveMornings ?? 0) + 1
      if (leavePortions.has('afternoon')) totals.leaveAfternoons = (totals.leaveAfternoons ?? 0) + 1
      for (const x of entries) {
        if (x.status === 'late') totals.late++
        if (x.status === 'leave') totals.leave++
        if (x.status === 'absent') totals.absent++
        if (x.status === 'offsite') totals.offsite = (totals.offsite ?? 0) + 1
        if (x.earlyLeaveAt) totals.earlyLeave++
      }
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  return { employee: toEmployee(e), month, totals, days }
}
