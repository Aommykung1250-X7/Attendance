// ล็อกอินด้วย Google (Authorization Code + PKCE) ผ่าน Google Auth Platform
// ขอเฉพาะ scope openid email profile และตรวจ ID token ทุกครั้ง

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { config, isAdminEmail } from '../config.js'
import { randomToken } from '../lib/id.js'
import { toEmployee } from '../lib/mappers.js'
import {
  clearCookie,
  COOKIE,
  createSession,
  currentAuth,
  deleteSession,
  readSession,
  setCookie,
  TTL,
  type AuthData,
  type OAuthData,
} from '../lib/sessions.js'
import { findActiveEmployee } from '../services/checkin.js'

const oauth = () =>
  new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  })

/** รับเฉพาะ path ภายในเว็บเดียวกัน กัน open redirect */
export function safeNext(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v.slice(0, 500)
}

async function startSession(reply: FastifyReply, email: string, name: string | null) {
  const registered = !!(await findActiveEmployee(email)) || isAdminEmail(email)
  // อีเมลที่ไม่อยู่ในระบบได้ session สั้นๆ แค่พอให้หน้าเว็บบอกว่า "บัญชีนี้ยังไม่ได้ลงทะเบียน"
  const ttl = registered ? TTL.auth : TTL.authUnregistered
  const { rawId, expiresAt } = await createSession<AuthData>('auth', { email: email.toLowerCase(), name }, ttl)
  setCookie(reply, COOKIE.auth, rawId, expiresAt)
}

async function endSession(req: FastifyRequest, reply: FastifyReply) {
  await deleteSession(req.cookies[COOKIE.auth])
  clearCookie(reply, COOKIE.auth)
}

function errorRedirect(reply: FastifyReply, reason: string) {
  return reply.redirect(`${config.appOrigin}/auth/error?reason=${encodeURIComponent(reason)}`)
}

export async function authRoutes(app: FastifyInstance) {
  /** เริ่มล็อกอิน ?next=/checkin?token=... &switch=1 ใช้เปลี่ยนบัญชี */
  app.get('/api/auth/google', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    if (q.switch) await endSession(req, reply)
    const client = oauth()
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = randomToken(16)
    const { rawId, expiresAt } = await createSession<OAuthData>(
      'oauth',
      { state, codeVerifier, next: safeNext(q.next) },
      TTL.oauth,
    )
    setCookie(reply, COOKIE.oauth, rawId, expiresAt)
    const url = client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
      access_type: 'online',
      include_granted_scopes: false,
    })
    return reply.redirect(url)
  })

  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const raw = req.cookies[COOKIE.oauth]
    const pending = await readSession<OAuthData>('oauth', raw)
    await deleteSession(raw)
    clearCookie(reply, COOKIE.oauth)

    if (q.error) return errorRedirect(reply, q.error === 'access_denied' ? 'cancelled' : 'google_error')
    if (!pending || !q.state || pending.data.state !== q.state || !q.code) return errorRedirect(reply, 'state')

    try {
      const client = oauth()
      const { tokens } = await client.getToken({ code: q.code, codeVerifier: pending.data.codeVerifier })
      if (!tokens.id_token) return errorRedirect(reply, 'google_error')
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId })
      const p = ticket.getPayload()
      if (!p?.email || !p.email_verified) return errorRedirect(reply, 'unverified')
      await endSession(req, reply)
      await startSession(reply, p.email, p.name ?? null)
      return reply.redirect(`${config.appOrigin}${pending.data.next}`)
    } catch (e) {
      req.log.warn({ err: e }, 'google callback failed')
      return errorRedirect(reply, 'google_error')
    }
  })

  /** ทางลัดสำหรับทดสอบบนเครื่องตัวเองเท่านั้น ปิดเสมอใน production */
  if (config.devLogin) {
    app.log.warn('DEV_LOGIN เปิดอยู่ — ห้ามใช้บนเซิร์ฟเวอร์จริง')
    app.get('/api/auth/dev-login', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>
      if (!q.email) return reply.code(400).send({ error: 'bad_request', message: 'ใส่ ?email=' })
      await endSession(req, reply)
      await startSession(reply, q.email, null)
      return reply.redirect(`${config.appOrigin}${safeNext(q.next)}`)
    })
  }

  app.post('/api/auth/logout', async (req, reply) => {
    await endSession(req, reply)
    return { ok: true }
  })

  app.get('/api/me', async (req, reply) => {
    const s = await currentAuth(req, reply)
    if (!s) return reply.code(401).send({ error: 'login_required', message: 'กรุณาเข้าสู่ระบบ' })
    const emp = await findActiveEmployee(s.data.email)
    return {
      email: s.data.email,
      name: s.data.name,
      isAdmin: isAdminEmail(s.data.email),
      employee: emp ? toEmployee(emp) : null,
    }
  })
}

/** ใช้ใน preHandler ของทุก endpoint ฝั่งแอดมิน */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const s = await currentAuth(req, reply)
  if (!s) {
    return reply.code(401).send({ error: 'login_required', message: 'กรุณาเข้าสู่ระบบ', loginUrl: '/api/auth/google?next=/admin' })
  }
  if (!isAdminEmail(s.data.email)) {
    return reply.code(403).send({ error: 'forbidden', message: `${s.data.email} ไม่มีสิทธิ์แอดมิน` })
  }
  req.adminEmail = s.data.email
}

declare module 'fastify' {
  interface FastifyRequest {
    adminEmail?: string
  }
}
