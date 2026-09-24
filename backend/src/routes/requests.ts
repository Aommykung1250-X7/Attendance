import type { FastifyInstance, FastifyReply } from 'fastify'
import { and, eq, isNull } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { isAdminEmail } from '../config.js'
import { db, schema } from '../db/index.js'
import { asBody, badRequest, notFound } from '../lib/http.js'
import { currentAuth } from '../lib/sessions.js'
import { localParts } from '../lib/time.js'
import { findActiveEmployee } from '../services/checkin.js'
import {
  adminCancelLeave,
  adminUpdateLeave,
  cancelLeaveRequest,
  createLeaveForEmployee,
  createLeaveRequest,
  listLeaveRequests,
  markMedicalReceived,
  reviewLeaveRequest,
  uploadMedicalCertificate,
  type LeaveInput,
} from '../services/leave.js'
import {
  cancelOffsiteRequest,
  createOffsiteRequest,
  getEmployeeOffsiteStatus,
  getUploadDir,
  listAdminOffsiteRequests,
  reviewOffsiteRequest,
} from '../services/offsite.js'
import { requireAdmin } from './auth.js'

function loginRequired(reply: FastifyReply) {
  return reply.code(401).send({
    error: 'login_required',
    message: 'กรุณาเข้าสู่ระบบด้วยบัญชี Google',
    loginUrl: '/api/auth/google?next=/request',
  })
}

function boolValue(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

function leaveInput(raw: Record<string, unknown>, file?: { buffer: Buffer; ext: string } | null): LeaveInput {
  const duration = String(raw.duration ?? '') as LeaveInput['duration']
  const type = String(raw.leaveType ?? '')
  return {
    startDate: String(raw.startDate ?? ''),
    endDate: String(raw.endDate ?? raw.startDate ?? ''),
    duration,
    leaveType: type === 'sick' || type === 'personal' ? type : null,
    reason: String(raw.reason ?? ''),
    medicalCertificatePending: boolValue(raw.medicalCertificatePending),
    medicalBuffer: file?.buffer,
    medicalExt: file?.ext,
  }
}

async function parseMultipart(req: Parameters<FastifyInstance['post']>[1] extends never ? never : any) {
  const fields: Record<string, unknown> = {}
  let file: { buffer: Buffer; ext: string } | null = null
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer()
      const ext = path.extname(part.filename).slice(1).toLowerCase() || 'bin'
      file = { buffer, ext }
    } else fields[part.fieldname] = String(part.value ?? '')
  }
  return { fields, file }
}

export async function requestRoutes(app: FastifyInstance) {
  app.get('/api/requests/me', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const employee = await findActiveEmployee(auth.data.email)
    if (!employee) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
    const offsite = await getEmployeeOffsiteStatus(auth.data.email)
    const [leaves, allOffsites] = await Promise.all([
      listLeaveRequests({ employeeId: employee.id }),
      listAdminOffsiteRequests(),
    ])
    const ownOffsites = allOffsites.filter((request) => request.employeeId === employee.id)
    return { ...offsite, requests: [...leaves, ...ownOffsites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  })

  app.post('/api/requests/leave', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('multipart/form-data')) {
      const { fields, file } = await parseMultipart(req)
      if (file && !['pdf', 'jpg', 'jpeg', 'png'].includes(file.ext))
        throw badRequest('ใบรับรองแพทย์ต้องเป็น PDF, JPEG หรือ PNG')
      return createLeaveRequest(auth.data.email, leaveInput(fields, file))
    }
    return createLeaveRequest(auth.data.email, leaveInput(asBody(req.body)))
  })

  app.post('/api/requests/offsite', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const { fields, file } = await parseMultipart(req)
    if (!file) throw badRequest('กรุณาแนบรูปภาพหลักฐาน')
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(file.ext)) throw badRequest('รูปหลักฐานต้องเป็น JPEG, PNG หรือ WebP')
    return createOffsiteRequest(auth.data.email, {
      shiftId: String(fields.shiftId ?? ''),
      taskDescription: String(fields.taskDescription ?? ''),
      locationName: String(fields.locationName ?? ''),
      photoBuffer: file.buffer,
      ext: file.ext,
    })
  })

  app.post('/api/requests/leave/:id/cancel', async (req, reply) => {
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    return cancelLeaveRequest(auth.data.email, (req.params as { id: string }).id)
  })

  app.post('/api/requests/offsite/:id/cancel', async (req, reply) => {
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    return cancelOffsiteRequest(auth.data.email, (req.params as { id: string }).id)
  })

  app.post('/api/requests/leave/:id/medical-certificate', async (req, reply) => {
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const file = await req.file()
    if (!file) throw badRequest('กรุณาเลือกไฟล์ใบรับรองแพทย์')
    const buffer = await file.toBuffer()
    const ext = path.extname(file.filename).slice(1).toLowerCase()
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw badRequest('ใบรับรองแพทย์ต้องเป็น PDF, JPEG หรือ PNG')
    return uploadMedicalCertificate(auth.data.email, (req.params as { id: string }).id, buffer, ext)
  })

  app.post('/api/requests/offsite/checkout', async (req, reply) => {
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const employee = await findActiveEmployee(auth.data.email)
    if (!employee) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
    const shiftId = String(asBody(req.body).shiftId ?? '')
    const { date } = localParts(new Date())
    await db
      .update(schema.attendance)
      .set({ checkedOutAt: new Date(), checkedOutBy: 'self' })
      .where(and(eq(schema.attendance.employeeId, employee.id), eq(schema.attendance.shiftId, shiftId), eq(schema.attendance.date, date), isNull(schema.attendance.checkedOutAt)))
    return { ok: true }
  })

  app.get('/api/requests/files/:filename', async (req, reply) => {
    const auth = await currentAuth(req, reply)
    if (!auth) return loginRequired(reply)
    const filename = (req.params as { filename: string }).filename
    if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$/i.test(filename)) throw badRequest('ชื่อไฟล์ไม่ถูกต้อง')
    const publicPath = `/api/requests/files/${filename}`
    const employee = await findActiveEmployee(auth.data.email)
    const [leave] = await db
      .select({ employeeId: schema.leaveRequests.employeeId })
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.medicalCertificatePath, publicPath))
    const [offsite] = await db
      .select({ employeeId: schema.offsiteRequests.employeeId })
      .from(schema.offsiteRequests)
      .where(eq(schema.offsiteRequests.photoPath, publicPath))
    const ownerId = leave?.employeeId ?? offsite?.employeeId
    if (!ownerId) throw notFound('ไม่พบไฟล์')
    if (!isAdminEmail(auth.data.email) && employee?.id !== ownerId) return reply.code(403).send({ error: 'forbidden', message: 'ไม่มีสิทธิ์เปิดไฟล์นี้' })
    const filePath = path.join(getUploadDir(), filename)
    if (!fs.existsSync(filePath)) throw notFound('ไม่พบไฟล์')
    const ext = path.extname(filename).toLowerCase()
    const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' }
    reply.header('Content-Type', types[ext] ?? 'application/octet-stream')
    reply.header('Content-Disposition', `inline; filename="${filename}"`)
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(fs.createReadStream(filePath))
  })

  app.get('/api/admin/requests', { preHandler: requireAdmin }, async (req) => {
    const query = req.query as { status?: string; kind?: string }
    const [leaves, offsites] = await Promise.all([
      query.kind === 'offsite' ? [] : listLeaveRequests({ status: query.status }),
      query.kind === 'leave' ? [] : listAdminOffsiteRequests({ status: query.status }),
    ])
    return [...leaves, ...offsites].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })

  app.post('/api/admin/requests/leave/:id/review', { preHandler: requireAdmin }, async (req) => {
    const body = asBody(req.body)
    const action = body.action === 'reject' ? 'reject' : 'approve'
    return reviewLeaveRequest(req.adminEmail!, (req.params as { id: string }).id, action, String(body.rejectReason ?? ''))
  })

  app.post('/api/admin/requests/offsite/:id/review', { preHandler: requireAdmin }, async (req) => {
    const body = asBody(req.body)
    const action = body.action === 'reject' ? 'reject' : 'approve'
    return reviewOffsiteRequest(req.adminEmail!, (req.params as { id: string }).id, action, String(body.rejectReason ?? ''))
  })

  app.post('/api/admin/requests/leave', { preHandler: requireAdmin }, async (req) => {
    const body = asBody(req.body)
    const employeeId = String(body.employeeId ?? '')
    if (!employeeId) throw badRequest('กรุณาเลือกพนักงาน')
    return createLeaveForEmployee(employeeId, leaveInput(body), { allowPast: true, approved: true, adminEmail: req.adminEmail! })
  })

  app.patch('/api/admin/requests/leave/:id', { preHandler: requireAdmin }, async (req) =>
    adminUpdateLeave(req.adminEmail!, (req.params as { id: string }).id, leaveInput(asBody(req.body))),
  )

  app.post('/api/admin/requests/leave/:id/cancel', { preHandler: requireAdmin }, async (req) =>
    adminCancelLeave(req.adminEmail!, (req.params as { id: string }).id),
  )

  app.post('/api/admin/requests/leave/:id/mark-document-received', { preHandler: requireAdmin }, async (req) =>
    markMedicalReceived(req.adminEmail!, (req.params as { id: string }).id),
  )
}
