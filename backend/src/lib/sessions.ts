// session ฝั่งเซิร์ฟเวอร์ (spec หัวข้อ 8 ข้อ 3 และหัวข้อ 11)
// cookie เก็บเฉพาะรหัสสุ่ม ไม่มีอีเมลหรือสถานะอยู่ในนั้น ในฐานข้อมูลเก็บ sha256 ของรหัสแทนตัวรหัสจริง

import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, gt, lt } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { randomToken, sha256 } from './id.js'

export const COOKIE = {
  /** ล็อกอินของพนักงานและแอดมิน อยู่ยาวเป็นเดือน การเช็กชื่อครั้งถัดไปจะเหลือแค่กดปุ่มเดียว */
  auth: 'att_sid',
  /** session ชั่วคราวหลังสแกน QR เก็บเวลาที่สแกน อายุ 60 วินาที */
  scan: 'att_scan',
  /** state ของ OAuth ระหว่างไปหน้า Google */
  oauth: 'att_oauth',
} as const

export const TTL = {
  auth: 30 * 24 * 3600_000,
  /** อีเมลที่ไม่อยู่ในระบบ ให้อยู่แค่พอแสดงข้อความ */
  authUnregistered: 10 * 60_000,
  scan: 60_000,
  oauth: 10 * 60_000,
  import: 30 * 60_000,
} as const

export interface AuthData {
  email: string
  name: string | null
}
export interface ScanData {
  token: string
  scannedAt: string // ISO
  usedAt: string | null
}
export interface OAuthData {
  state: string
  codeVerifier: string
  next: string
}

export type SessionKind = 'auth' | 'scan' | 'oauth' | 'import'

export async function createSession<T extends object>(kind: SessionKind, data: T, ttlMs: number, rawId = randomToken()) {
  const expiresAt = new Date(Date.now() + ttlMs)
  await db
    .insert(schema.sessions)
    .values({ id: sha256(rawId), kind, data, expiresAt })
    .onConflictDoUpdate({ target: schema.sessions.id, set: { kind, data, expiresAt } })
  return { rawId, expiresAt }
}

export async function readSession<T>(kind: SessionKind, rawId: string | undefined | null) {
  if (!rawId) return null
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sha256(rawId)), eq(schema.sessions.kind, kind), gt(schema.sessions.expiresAt, new Date())))
  if (!row) return null
  return { id: row.id, rawId, data: row.data as T, expiresAt: row.expiresAt }
}

export async function writeSessionData<T extends object>(rawId: string, data: T, expiresAt?: Date) {
  await db
    .update(schema.sessions)
    .set(expiresAt ? { data, expiresAt } : { data })
    .where(eq(schema.sessions.id, sha256(rawId)))
}

export async function deleteSession(rawId: string | undefined | null) {
  if (!rawId) return
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(rawId)))
}

export async function purgeExpiredSessions() {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()))
}

export function setCookie(reply: FastifyReply, name: string, value: string, expires: Date) {
  reply.setCookie(name, value, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires,
  })
}

export function clearCookie(reply: FastifyReply, name: string) {
  reply.clearCookie(name, { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' })
}

/** อ่าน session ล็อกอิน และต่ออายุให้อัตโนมัติถ้าเหลือไม่ถึงครึ่ง */
export async function currentAuth(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[COOKIE.auth]
  const s = await readSession<AuthData>('auth', raw)
  if (!s) return null
  const remaining = s.expiresAt.getTime() - Date.now()
  if (remaining < TTL.auth / 2 && remaining > TTL.authUnregistered) {
    const expiresAt = new Date(Date.now() + TTL.auth)
    await writeSessionData(s.rawId, s.data, expiresAt)
    setCookie(reply, COOKIE.auth, s.rawId, expiresAt)
  }
  return s
}
