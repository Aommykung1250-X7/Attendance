import { and, asc, gte, lte } from 'drizzle-orm'
import type { Holiday } from '../contract.js'
import { db, schema } from '../db/index.js'
import { asBody, badRequest } from '../lib/http.js'
import { addDays, isValidDate } from '../lib/time.js'
import { audit } from './audit.js'

export interface HolidayCandidate extends Holiday {
  existingName: string | null
}

type Event = { summary?: string; start?: string; end?: string; rule?: string; excluded: string[]; cancelled: boolean }

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, char: string) => char.toLowerCase() === 'n' ? ' ' : char).replace(/\s+/g, ' ').trim()
}

function ruleDates(event: Event, year: number): string[] | null {
  if (!event.start || !/^\d{8}$/.test(event.start)) return null
  const original = `${event.start.slice(0, 4)}-${event.start.slice(4, 6)}-${event.start.slice(6, 8)}`
  if (!isValidDate(original)) return null
  if (!event.rule) return [original]

  const entries = Object.fromEntries(event.rule.split(';').map((part) => part.split('=', 2)))
  if (entries.FREQ !== 'YEARLY' || Object.keys(entries).some((key) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYMONTH', 'BYMONTHDAY', 'WKST'].includes(key))) return null
  const interval = Number(entries.INTERVAL ?? 1)
  const count = Number(entries.COUNT ?? Number.POSITIVE_INFINITY)
  const elapsed = year - Number(original.slice(0, 4))
  if (!Number.isInteger(interval) || interval < 1 || count < 1 || (!Number.isInteger(count) && count !== Number.POSITIVE_INFINITY)) return null
  if (elapsed < 0 || elapsed % interval !== 0 || elapsed / interval >= count) return []
  const month = Number(entries.BYMONTH ?? original.slice(5, 7))
  const day = Number(entries.BYMONTHDAY ?? original.slice(8, 10))
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isValidDate(candidate) || candidate < original || entries.UNTIL && candidate.replaceAll('-', '') > entries.UNTIL.slice(0, 8)) return []
  return [candidate]
}

function expandEvent(event: Event, year: number): string[] | null {
  if (event.cancelled) return []
  if (!event.summary || !unescapeText(event.summary)) return null
  const starts = ruleDates(event, year)
  if (!starts) return null
  const original = `${event.start!.slice(0, 4)}-${event.start!.slice(4, 6)}-${event.start!.slice(6, 8)}`
  if (event.end && !/^\d{8}$/.test(event.end)) return null
  const originalEnd = event.end
    ? `${event.end.slice(0, 4)}-${event.end.slice(4, 6)}-${event.end.slice(6, 8)}`
    : addDays(original, 1)
  if (!isValidDate(originalEnd) || originalEnd <= original) return null
  let span = 0
  for (let date = original; date < originalEnd; date = addDays(date, 1)) {
    span++
    if (span > 31) return null
  }
  const excluded = new Set(event.excluded.flatMap((value) => value.split(',')).filter((value) => /^\d{8}$/.test(value)).map((value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`))
  const dates: string[] = []
  for (const start of starts) {
    if (excluded.has(start)) continue
    for (let offset = 0; offset < span; offset++) {
      const date = addDays(start, offset)
      if (date.startsWith(String(year))) dates.push(date)
    }
  }
  return dates
}

export function parseHolidayCalendar(content: string, year: number): { rows: Holiday[]; skipped: number } {
  const lines = content.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n')
  if (!lines.some((line) => line.trim() === 'BEGIN:VCALENDAR') || !lines.some((line) => line.trim() === 'END:VCALENDAR')) {
    throw badRequest('ไฟล์ต้องเป็นปฏิทิน .ics ที่ถูกต้อง')
  }
  const unfolded: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1)
    else unfolded.push(line)
  }
  const holidays = new Map<string, Set<string>>()
  let event: Event | null = null
  let skipped = 0
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { event = { excluded: [], cancelled: false }; continue }
    if (line === 'END:VEVENT') {
      if (event) {
        const dates = expandEvent(event, year)
        if (dates === null) skipped++
        else for (const date of dates) {
          const names = holidays.get(date) ?? new Set<string>()
          names.add(unescapeText(event.summary!))
          holidays.set(date, names)
        }
      }
      event = null
      continue
    }
    if (!event) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).split(';')[0].toUpperCase()
    const value = line.slice(colon + 1)
    if (key === 'SUMMARY') event.summary = value
    if (key === 'DTSTART') event.start = value
    if (key === 'DTEND') event.end = value
    if (key === 'RRULE') event.rule = value
    if (key === 'EXDATE') event.excluded.push(value)
    if (key === 'STATUS' && value === 'CANCELLED') event.cancelled = true
  }
  const rows = [...holidays].sort(([a], [b]) => a.localeCompare(b)).map(([date, names]) => ({ date, name: [...names].join(' / ').slice(0, 120) }))
  return { rows, skipped }
}

export async function previewHolidayCalendar(content: string, year: number): Promise<{ rows: HolidayCandidate[]; skipped: number }> {
  const parsed = parseHolidayCalendar(content, year)
  const existing = await db.select().from(schema.holidays)
    .where(and(gte(schema.holidays.date, `${year}-01-01`), lte(schema.holidays.date, `${year}-12-31`)))
    .orderBy(asc(schema.holidays.date))
  const byDate = new Map(existing.map((item) => [item.date, item.name]))
  return { rows: parsed.rows.map((row) => ({ ...row, existingName: byDate.get(row.date) ?? null })), skipped: parsed.skipped }
}

export async function commitHolidayCalendar(adminEmail: string, raw: unknown): Promise<{ added: number; skipped: number }> {
  const body = asBody(raw)
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 366) throw badRequest('เลือกรายการวันหยุด 1–366 วัน')
  const rows = body.rows.map((item) => {
    const row = asBody(item)
    const date = row.date
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!isValidDate(date) || !name || name.length > 120) throw badRequest('วันที่หรือชื่อวันหยุดไม่ถูกต้อง')
    return { date, name }
  })
  if (new Set(rows.map((row) => row.date)).size !== rows.length) throw badRequest('มีวันที่ซ้ำในรายการที่เลือก')
  return db.transaction(async (tx) => {
    let added = 0
    for (const row of rows) {
      const inserted = await tx.insert(schema.holidays).values(row).onConflictDoNothing().returning()
      if (!inserted.length) continue
      added++
      await audit(tx, { adminEmail, action: 'holiday_import', date: row.date, after: row })
    }
    return { added, skipped: rows.length - added }
  })
}
