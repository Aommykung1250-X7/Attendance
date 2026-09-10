import { eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { randomToken } from './id.js'

export type SettingsRow = typeof schema.settings.$inferSelect

let cache: { row: SettingsRow; at: number } | null = null

/** สร้างแถว settings ครั้งแรก พร้อมรหัสหน้าจอแบบสุ่ม */
export async function ensureSettings(): Promise<SettingsRow> {
  await db
    .insert(schema.settings)
    .values({ id: 1, displayKey: randomToken(24), qrTokenTtl: config.defaultQrTtl })
    .onConflictDoNothing()
  cache = null
  return getSettings()
}

/** อ่านซ้ำบ่อยจากจอ (ทุก 8 วินาที) จึงแคชไว้สั้นๆ */
export async function getSettings(): Promise<SettingsRow> {
  if (cache && Date.now() - cache.at < 5_000) return cache.row
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1))
  if (!row) return ensureSettings()
  cache = { row, at: Date.now() }
  return row
}

export async function updateSettings(patch: Partial<Omit<SettingsRow, 'id'>>): Promise<SettingsRow> {
  const [row] = await db.update(schema.settings).set(patch).where(eq(schema.settings.id, 1)).returning()
  cache = null
  return row
}

export function displayUrl(displayKey: string): string {
  return `${config.appOrigin}/display/${displayKey}`
}
