// ตัวช่วยจัดรูปแบบ ทุกอย่างคิดเป็นเวลาไทยไม่ว่าเครื่องที่เปิดจะตั้งเขตเวลาไหน

import type { Employee, ShiftEntry } from './types'

export const TZ = 'Asia/Bangkok'

export const WEEKDAYS = [
  { n: 1, short: 'จ', long: 'จันทร์' },
  { n: 2, short: 'อ', long: 'อังคาร' },
  { n: 3, short: 'พ', long: 'พุธ' },
  { n: 4, short: 'พฤ', long: 'พฤหัสบดี' },
  { n: 5, short: 'ศ', long: 'ศุกร์' },
  { n: 6, short: 'ส', long: 'เสาร์' },
  { n: 7, short: 'อา', long: 'อาทิตย์' },
] as const

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function bangkok(d = new Date()) {
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(d)) p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, hh: p.hour, mm: p.minute, ss: p.second }
}

export const todayISO = () => bangkok().date
export const nowHHMM = () => {
  const b = bangkok()
  return `${b.hh}:${b.mm}`
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

const monthFmt = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const monthLabel = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`))

const dateFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
export const dateLabel = (date: string) => dateFmt.format(new Date(`${date}T00:00:00Z`))

const shortFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
export const shortDate = (date: string) => shortFmt.format(new Date(`${date}T00:00:00Z`))

const stampFmt = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })
export const stamp = (iso: string) => stampFmt.format(new Date(iso))

/** ชื่อที่แสดง ต้องมี Gen กำกับเพราะชื่อเล่นซ้ำกันได้ */
export const displayName = (e: Pick<Employee, 'nickname' | 'gen'>) => (e.gen ? `${e.nickname} (${e.gen})` : e.nickname)

export const typeLabel = (t: Employee['type']) => (t === 'staff' ? 'ประจำ' : 'นักศึกษา')

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** "จ–ศ 09:00–18:00" หรือ "จ, พ 09:30–12:00 + 17:00–20:00" */
export function describeShifts(list: ShiftEntry[]): string {
  if (list.length === 0) return 'ไม่มีกะ'
  const perDay = new Map<number, string>()
  for (const w of WEEKDAYS) {
    const r = list
      .filter((s) => s.weekday === w.n)
      .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime))
      .map((s) => `${s.startTime}–${s.endTime}`)
    if (r.length) perDay.set(w.n, r.join(' + '))
  }
  const groups = new Map<string, number[]>()
  for (const [d, r] of perDay) groups.set(r, [...(groups.get(r) ?? []), d])
  return [...groups.entries()].map(([r, days]) => `${dayRange(days)} ${r}`).join(' / ')
}

function dayRange(days: number[]) {
  const out: string[] = []
  let i = 0
  while (i < days.length) {
    let j = i
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++
    if (j - i >= 2) out.push(`${WEEKDAYS[days[i] - 1].short}–${WEEKDAYS[days[j] - 1].short}`)
    else for (let k = i; k <= j; k++) out.push(WEEKDAYS[days[k] - 1].short)
    i = j + 1
  }
  return out.join(', ')
}

export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`
}
