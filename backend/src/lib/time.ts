// เวลาทั้งหมดของระบบคิดเป็นเวลาไทย (Asia/Bangkok) ไม่ขึ้นกับ TZ ของเครื่องที่รัน
// ค่า "ตอนนี้" มาจากนาฬิกาของเซิร์ฟเวอร์เสมอ ห้ามรับเวลาจาก client (spec หัวข้อ 7)

export const TZ = 'Asia/Bangkok'

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

export interface LocalParts {
  /** 'YYYY-MM-DD' */
  date: string
  /** 1 = จันทร์ ... 7 = อาทิตย์ */
  weekday: number
  /** 'HH:MM:SS' */
  time: string
}

export function localParts(d: Date): LocalParts {
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(d)) p[x.type] = x.value
  const date = `${p.year}-${p.month}-${p.day}`
  return { date, weekday: weekdayOf(date), time: `${p.hour}:${p.minute}:${p.second}` }
}

/** วันในสัปดาห์ของวันที่ 'YYYY-MM-DD' (1 = จันทร์ ... 7 = อาทิตย์) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = อาทิตย์
  return dow === 0 ? 7 : dow
}

function offsetMs(at: Date): number {
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(at)) p[x.type] = x.value
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** แปลง "วันที่ + เวลาไทย" เป็นเวลาจริง (Date) */
export function zoned(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm, ss = 0] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss)
  return new Date(guess - offsetMs(new Date(guess)))
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return addDays(s, 0) === s
}

export function isValidMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && HHMM.test(s)
}

/** 'HH:MM' → นาทีนับจากเที่ยงคืน */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** เวลาไทยของ Date เป็น 'HH:MM:SS' */
export function clockOf(d: Date): string {
  return localParts(d).time
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

const fullFmt = new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeZone: 'UTC' })
const shortFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** 'วันพฤหัสบดีที่ 10 กันยายน พ.ศ. 2569' */
export function thaiDateLabel(date: string): string {
  return fullFmt.format(new Date(`${date}T00:00:00Z`))
}

/** 'พฤหัส 10 ก.ย.' */
export function thaiShortDateLabel(date: string): string {
  return shortFmt.format(new Date(`${date}T00:00:00Z`))
}

export const WEEKDAY_SHORT = ['', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'] as const
