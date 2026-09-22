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
  return {
    displayKey: s.displayKey,
    displayUrl: displayUrl(s.displayKey),
    qrTokenTtl: s.qrTokenTtl,
    lineOaUrl: s.lineOaUrl ?? null,
    lateGraceMinutes: s.lateGraceMinutes,
    officeLatitude: s.officeLatitude,
    officeLongitude: s.officeLongitude,
    checkinRadiusMeters: s.checkinRadiusMeters,
    maxLocationAccuracyMeters: s.maxLocationAccuracyMeters,
  }
}

export async function patchAppSettings(adminEmail: string, raw: unknown): Promise<AppSettings> {
  const b = asBody(raw)
  const patch: Partial<{
    qrTokenTtl: number
    lineOaUrl: string | null
    lateGraceMinutes: number
    officeLatitude: number
    officeLongitude: number
    checkinRadiusMeters: number
    maxLocationAccuracyMeters: number
  }> = {}
  if (b.qrTokenTtl !== undefined) {
    const ttl = Number(b.qrTokenTtl)
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 300) throw badRequest('อายุ token ต้องอยู่ระหว่าง 10 ถึง 300 วินาที')
    patch.qrTokenTtl = ttl
  }
  if (b.lineOaUrl !== undefined) {
    patch.lineOaUrl = b.lineOaUrl ? String(b.lineOaUrl).trim() : null
  }
  const intSetting = (key: 'lateGraceMinutes' | 'checkinRadiusMeters' | 'maxLocationAccuracyMeters', min: number, max: number, label: string) => {
    if (b[key] === undefined) return
    const value = Number(b[key])
    if (!Number.isInteger(value) || value < min || value > max) throw badRequest(`${label}ต้องอยู่ระหว่าง ${min} ถึง ${max}`)
    patch[key] = value
  }
  intSetting('lateGraceMinutes', 0, 120, 'เวลาผ่อนผัน ')
  intSetting('checkinRadiusMeters', 10, 10_000, 'รัศมีเช็กอิน ')
  intSetting('maxLocationAccuracyMeters', 1, 1_000, 'ค่าความคลาดเคลื่อน GPS ')
  if (b.officeLatitude !== undefined) {
    const value = Number(b.officeLatitude)
    if (!Number.isFinite(value) || value < -90 || value > 90) throw badRequest('ละติจูดสำนักงานไม่ถูกต้อง')
    patch.officeLatitude = value
  }
  if (b.officeLongitude !== undefined) {
    const value = Number(b.officeLongitude)
    if (!Number.isFinite(value) || value < -180 || value > 180) throw badRequest('ลองจิจูดสำนักงานไม่ถูกต้อง')
    patch.officeLongitude = value
  }
  const before = await getSettings()
  await updateSettings(patch)
  await audit(db, { adminEmail, action: 'settings_update', before, after: patch })
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

/** รีเซ็ตข้อมูลการเข้างานและการแก้สถานะทั้งหมด (ใช้สำหรับล้างข้อมูลทดสอบก่อนเปิดใช้งานจริง) */
export async function resetAttendanceData(adminEmail: string) {
  return db.transaction(async (tx) => {
    const deletedAttendance = await tx.delete(schema.attendance).returning()
    const deletedOverrides = await tx.delete(schema.statusOverrides).returning()
    await audit(tx, {
      adminEmail,
      action: 'reset_attendance_data',
      after: {
        deletedAttendanceCount: deletedAttendance.length,
        deletedOverridesCount: deletedOverrides.length,
      },
    })
    return {
      ok: true as const,
      deletedAttendance: deletedAttendance.length,
      deletedOverrides: deletedOverrides.length,
    }
  })
}
