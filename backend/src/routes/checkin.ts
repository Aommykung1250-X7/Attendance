// หน้าเช็กชื่อบนมือถือ (spec หัวข้อ 8 และ 9.2)
//
// 1. สแกน QR → GET /api/checkin?token=...
// 2. token ยังไม่หมดอายุ → สร้าง session ชั่วคราว 5 นาที บันทึกเวลาที่สแกนทันที ส่ง cookie อ้างอิงกลับ
// 3. ยังไม่ได้ล็อกอิน → ตอบ 401 พร้อม loginUrl หน้าเว็บพาไปหน้า Google แล้วกลับมาที่ URL เดิม
// 4. กลับมาแล้ว cookie ยังชี้ไป session เดิม เวลาที่ใช้จึงเป็นเวลาจากข้อ 2 ไม่ใช่เวลาที่ล็อกอินเสร็จ

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { asBody } from '../lib/http.js'
import { verifyQrToken } from '../lib/qr.js'
import {
  COOKIE,
  createSession,
  currentAuth,
  deleteSession,
  readSession,
  setCookie,
  TTL,
  writeSessionData,
  type ScanData,
} from '../lib/sessions.js'
import { getSettings } from '../lib/settings.js'
import { buildView, confirmCheckIn, confirmCheckOut, confirmEarlyLeave, findActiveEmployee } from '../services/checkin.js'

/** หา session การสแกนของ token นี้ ถ้าไม่มีและ token ยังใช้ได้ให้สร้างใหม่ ถ้าหมดอายุคืน null */
async function resolveScan(req: FastifyRequest, reply: FastifyReply, token: string) {
  const raw = req.cookies[COOKIE.scan]
  const existing = await readSession<ScanData>('scan', raw)
  if (existing && existing.data.token === token && !existing.data.usedAt) return existing

  const s = await getSettings()
  if (!verifyQrToken(config.sessionSecret, s.displayKey, s.qrTokenTtl, token, Date.now())) return null

  if (existing) await deleteSession(existing.rawId)
  const data: ScanData = { token, scannedAt: new Date().toISOString(), usedAt: null }
  const { rawId, expiresAt } = await createSession('scan', data, TTL.scan)
  setCookie(reply, COOKIE.scan, rawId, expiresAt)
  return { rawId, data, expiresAt }
}

function loginRequired(reply: FastifyReply, token: string) {
  const next = `/checkin?token=${encodeURIComponent(token)}`
  return reply.code(401).send({
    error: 'login_required',
    message: 'กรุณาเข้าสู่ระบบด้วยบัญชี Google',
    loginUrl: `/api/auth/google?next=${encodeURIComponent(next)}`,
  })
}

export async function checkinRoutes(app: FastifyInstance) {
  app.get('/api/checkin', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const token = String((req.query as Record<string, unknown>).token ?? '')
    const scan = await resolveScan(req, reply, token)
    if (!scan) return { kind: 'expired' }

    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply, token)
    const emp = await findActiveEmployee(auth.data.email)
    if (!emp) return { kind: 'not_registered', email: auth.data.email }

    const { view } = await buildView(emp, new Date(scan.data.scannedAt))
    return view
  })

  for (const [path, action] of [
    ['/api/checkin', confirmCheckIn],
    ['/api/checkin/early-leave', confirmEarlyLeave],
    ['/api/checkin/checkout', confirmCheckOut],
  ] as const) {
    app.post(path, async (req, reply) => {
      reply.header('Cache-Control', 'no-store')
      const token = String(asBody(req.body).token ?? '')
      const scan = await resolveScan(req, reply, token)
      if (!scan) return { kind: 'expired' }

      const auth = await currentAuth(req, reply)
      if (!auth) return loginRequired(reply, token)
      const emp = await findActiveEmployee(auth.data.email)
      if (!emp) return { kind: 'not_registered', email: auth.data.email }

      const body = asBody(req.body)
      const location =
        path === '/api/checkin'
          ? {
              latitude: Number(body.latitude),
              longitude: Number(body.longitude),
              accuracy: Number(body.accuracy),
            }
          : undefined
      const at = new Date(scan.data.scannedAt)
      const { view, acted } =
        path === '/api/checkin' ? await confirmCheckIn(emp, at, location) : await action(emp, at)
      // ใช้การสแกนหนึ่งครั้งทำได้หนึ่งอย่าง ครั้งถัดไปต้องสแกนใหม่
      if (acted) await writeSessionData(scan.rawId, { ...scan.data, usedAt: new Date().toISOString() })
      return view
    })
  }
}
