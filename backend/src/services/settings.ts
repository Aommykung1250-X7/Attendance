// ตั้งค่า: วันหยุด รหัสสุ่มของ URL หน้าจอ อายุ token (spec 9.8)

import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { AppSettings, Holiday } from '../contract.js'
import { db, schema } from '../db/index.js'
import { asBody, badRequest, notFound, reqString } from '../lib/http.js'
import { randomToken } from '../lib/id.js'
import { displayUrl, getSettings, updateSettings } from '../lib/settings.js'
import { isValidDate } from '../lib/time.js'
import { audit } from './audit.js'

export async function readAppSettings(): Promise<AppSettings> {
  const s = await getSettings()
  return { displayKey: s.displayKey, displayUrl: displayUrl(s.displayKey), qrTokenTtl: s.qrTokenTtl }
}

export async function patchAppSettings(adminEmail: string, raw: unknown): Promise<AppSettings> {
  const b = asBody(raw)
  const ttl = Number(b.qrTokenTtl)
  if (!Number.isInteger(ttl) || ttl < 10 || ttl > 300) throw badRequest('อายุ token ต้องอยู่ระหว่าง 10 ถึง 300 วินาที')
  const before = await getSettings()
  await updateSettings({ qrTokenTtl: ttl })
  await audit(db, { adminEmail, action: 'settings_ttl', before: { qrTokenTtl: before.qrTokenTtl }, after: { qrTokenTtl: ttl } })
  return readAppSettings()
}

/** สร้างรหัสใหม่ ลิงก์เดิมใช้ไม่ได้ทันที */
export async function rotateDisplayKey(adminEmail: string): Promise<AppSettings> {
  await updateSettings({ displayKey: randomToken(24) })
  await audit(db, { adminEmail, action: 'settings_rotate_display_key' })
  return readAppSettings()
}

export async function listHolidays(year?: string): Promise<Holiday[]> {
  const y = year && /^\d{4}$/.test(year) ? year : null
  return db
    .select()
    .from(schema.holidays)
    .where(y ? and(gte(schema.holidays.date, `${y}-01-01`), lte(schema.holidays.date, `${y}-12-31`)) : undefined)
    .orderBy(asc(schema.holidays.date))
}

export async function addHoliday(adminEmail: string, raw: unknown): Promise<Holiday> {
  const b = asBody(raw)
  if (!isValidDate(b.date)) throw badRequest('เลือกวันที่')
  const name = reqString(b, 'name', 'ชื่อวันหยุด', 120)
  const [h] = await db
    .insert(schema.holidays)
    .values({ date: b.date, name })
    .onConflictDoUpdate({ target: schema.holidays.date, set: { name } })
    .returning()
  await audit(db, { adminEmail, action: 'holiday_add', date: h.date, after: h })
  return h
}

export async function removeHoliday(adminEmail: string, date: string) {
  const [h] = await db.delete(schema.holidays).where(eq(schema.holidays.date, date)).returning()
  if (!h) throw notFound('ไม่พบวันหยุดนี้')
  await audit(db, { adminEmail, action: 'holiday_remove', date, before: h })
  return { ok: true }
}
