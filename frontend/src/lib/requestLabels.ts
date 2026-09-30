// ข้อความบนการ์ดคำขอของพนักงาน ใช้ร่วมกันระหว่างหน้า /request และ /history

import { shortDate, shortWeekdayDate, todayISO } from './format'
import type { LeaveDuration, RequestStatus, UnifiedRequest } from './types'

export const REQUEST_STATUS: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'รออนุมัติ', className: 'bg-rq-pending-bg text-rq-pending-ink' },
  approved: { label: 'อนุมัติแล้ว', className: 'bg-rq-approved-bg text-rq-approved-ink' },
  rejected: { label: 'ไม่อนุมัติ', className: 'bg-rq-rejected-bg text-rq-rejected-ink' },
  cancelled: { label: 'ยกเลิกแล้ว', className: 'bg-rq-cancelled-bg text-rq-cancelled-ink' },
}

const PORTION: Record<LeaveDuration, string> = { full_day: 'เต็มวัน', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }

const dateParts = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const partsOf = (date: string) => {
  const p: Record<string, string> = {}
  for (const x of dateParts.formatToParts(new Date(`${date}T00:00:00Z`))) p[x.type] = x.value
  return { d: p.day, m: p.month, y: p.year }
}

/** "วันนี้ · อ. 29 ก.ย. 69" · "10–11 ก.ย. 69" · "30 ก.ย. – 2 ต.ค. 69" */
export function dateRangeLabel(start: string, end: string) {
  if (start === end) return start === todayISO() ? `วันนี้ · ${shortWeekdayDate(start)}` : shortWeekdayDate(start)
  const a = partsOf(start)
  const b = partsOf(end)
  if (a.y !== b.y) return `${shortDate(start)} – ${shortDate(end)}`
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`
  return `${a.d}–${b.d} ${a.m} ${a.y}`
}

export const dateLabelOf = (r: UnifiedRequest) => (r.kind === 'leave' ? dateRangeLabel(r.startDate, r.endDate) : dateRangeLabel(r.date, r.date))

function leaveDayCount(start: string, end: string, days?: { date: string }[]) {
  if (days?.length) return new Set(days.map((d) => d.date)).size
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
}

/** "ลากิจ · ครึ่งเช้า" · "ลาป่วย · 2 วัน" · "ทำงานนอกสถานที่ · ร้านลูกค้า" */
export function typeLabelOf(r: UnifiedRequest) {
  if (r.kind === 'offsite') return r.locationName ? `ทำงานนอกสถานที่ · ${r.locationName}` : 'ทำงานนอกสถานที่'
  const type = r.leaveType === 'sick' ? 'ลาป่วย' : r.leaveType === 'personal' ? 'ลากิจ' : 'ลา'
  const period = r.startDate === r.endDate ? PORTION[r.duration] : `${leaveDayCount(r.startDate, r.endDate, r.days)} วัน`
  return `${type} · ${period}`
}
