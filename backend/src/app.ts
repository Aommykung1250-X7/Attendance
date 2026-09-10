import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { config } from './config.js'
import { HttpError } from './lib/http.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { boardRoutes } from './routes/board.js'
import { checkinRoutes } from './routes/checkin.js'

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: config.isProduction ? 'info' : 'debug' },
    // อยู่หลัง nginx เสมอ ต้องเชื่อ X-Forwarded-* เพื่อให้รู้ว่าเป็น https
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  })

  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

  // กัน CSRF: คำขอที่เปลี่ยนข้อมูลต้องมาจากหน้าเว็บของเราเท่านั้น
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
    let origin = req.headers.origin ?? null
    if (!origin && req.headers.referer) {
      try {
        origin = new URL(req.headers.referer).origin
      } catch {
        origin = null
      }
    }
    if (origin !== config.appOrigin) {
      return reply.code(403).send({ error: 'bad_origin', message: 'คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ' })
    }
  })

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra })
    }
    // unique ชน เช่นกดสองครั้งพร้อมกัน
    if ((err as { code?: string }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
      return reply.code(409).send({ error: 'conflict', message: 'ข้อมูลนี้ถูกบันทึกไปแล้ว ลองรีเฟรชหน้า' })
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message })
    }
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: 'server_error', message: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' })
  })

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }))

  await app.register(authRoutes)
  await app.register(checkinRoutes)
  await app.register(boardRoutes)
  await app.register(adminRoutes)

  return app
}
