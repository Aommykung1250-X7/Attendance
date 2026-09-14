// endpoint ฝั่งแอดมิน ทุกตัวต้องผ่าน requireAdmin

import type { FastifyInstance } from 'fastify'
import type { AdminAction } from '../contract.js'
import { asBody, badRequest } from '../lib/http.js'
import { sha256 } from '../lib/id.js'
import { COOKIE, createSession, deleteSession, readSession, TTL } from '../lib/sessions.js'
import { isValidDate, isValidMonth, localParts } from '../lib/time.js'
import { shiftHistory } from '../services/audit.js'
import { adminAction, dayLog } from '../services/day-admin.js'
import { commitImport, parseWorkbook, previewImport, templateWorkbook, type DeclaredProject, type ImportRow } from '../services/import.js'
import * as people from '../services/people.js'
import { monthlyReport } from '../services/report.js'
import * as settings from '../services/settings.js'
import { requireAdmin } from './auth.js'

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
  })
  const admin = (req: { adminEmail?: string }) => req.adminEmail!

  // ---- บันทึกประจำวัน -------------------------------------------------------
  app.get('/api/admin/day', async (req) => {
    const q = req.query as { date?: string }
    const date = q.date ?? localParts(new Date()).date
    if (!isValidDate(date)) throw badRequest('วันที่ไม่ถูกต้อง')
    return dayLog(date)
  })

  app.post('/api/admin/attendance', async (req) => {
    const b = asBody(req.body)
    const shiftId = String(b.shiftId ?? '')
    const date = b.date
    if (!shiftId || !isValidDate(date)) throw badRequest('ต้องระบุกะและวันที่')
    return adminAction(admin(req), shiftId, date, b as unknown as AdminAction)
  })

  app.get('/api/admin/attendance/history', async (req) => {
    const q = req.query as { shiftId?: string; date?: string }
    if (!q.shiftId || !isValidDate(q.date)) throw badRequest('ต้องระบุกะและวันที่')
    return shiftHistory(q.shiftId, q.date)
  })

  // ---- พนักงาน --------------------------------------------------------------
  app.get('/api/employees', async (req) => people.listEmployees(!!(req.query as { inactive?: string }).inactive))
  app.post('/api/employees', async (req) => people.createEmployee(admin(req), req.body))
  app.patch('/api/employees/:id', async (req) => people.updateEmployee(admin(req), (req.params as { id: string }).id, req.body))
  app.delete('/api/employees/:id', async (req) => people.hideEmployee(admin(req), (req.params as { id: string }).id))
  app.post('/api/employees/:id/restore', async (req) => people.restoreEmployee(admin(req), (req.params as { id: string }).id))
  app.delete('/api/employees/:id/purge', async (req) =>
    people.purgeEmployee(admin(req), (req.params as { id: string }).id, req.body),
  )
  app.get('/api/employees/:id/schedule', async (req) => people.employeeSchedule((req.params as { id: string }).id))
  app.put('/api/employees/:id/schedule/:projectId', async (req) => {
    const p = req.params as { id: string; projectId: string }
    return people.writeAssignment(admin(req), p.id, p.projectId, people.parseEntries(req.body))
  })

  // ---- โปรเจก ---------------------------------------------------------------
  app.get('/api/projects', async () => people.listProjects())
  app.post('/api/projects', async (req) => people.createProject(admin(req), req.body))
  app.get('/api/projects/:id', async (req) => people.projectDetail((req.params as { id: string }).id))
  app.patch('/api/projects/:id', async (req) => people.updateProject(admin(req), (req.params as { id: string }).id, req.body))
  app.delete('/api/projects/:id', async (req) => people.deleteProject(admin(req), (req.params as { id: string }).id))
  /** เพิ่มคนเข้าโปรเจก (หรือแก้กะของคนนั้นในโปรเจกนี้) */
  app.post('/api/projects/:id/assign', async (req) => {
    const employeeId = String(asBody(req.body).employeeId ?? '')
    if (!employeeId) throw badRequest('เลือกคนที่จะเพิ่ม')
    return people.writeAssignment(admin(req), employeeId, (req.params as { id: string }).id, people.parseEntries(req.body))
  })

  // ---- รายงาน ---------------------------------------------------------------
  app.get('/api/report/:employeeId', async (req) => {
    const month = (req.query as { month?: string }).month ?? localParts(new Date()).date.slice(0, 7)
    if (!isValidMonth(month)) throw badRequest('เดือนต้องอยู่ในรูป YYYY-MM')
    return monthlyReport((req.params as { employeeId: string }).employeeId, month)
  })

  // ---- นำเข้า Excel ---------------------------------------------------------
  // ผลการ parse เก็บใน session ผูกกับ session ล็อกอินของแอดมินคนนั้น แอดมินหนึ่งคนมีงานนำเข้าที่ค้างได้หนึ่งงาน
  const importKey = (authRaw: string) => `import:${sha256(authRaw)}`

  app.post('/api/import/preview', async (req) => {
    const file = await req.file()
    if (!file) throw badRequest('เลือกไฟล์ Excel')
    const buf = await file.toBuffer()
    const { rows, problems, declaredProjects } = await parseWorkbook(buf)
    const preview = await previewImport(rows, problems, declaredProjects)
    const key = importKey(req.cookies[COOKIE.auth]!)
    if (preview.ok) await createSession('import', { rows, declaredProjects }, TTL.import, key)
    else await deleteSession(key)
    return preview
  })

  app.post('/api/import/commit', async (req) => {
    const key = importKey(req.cookies[COOKIE.auth]!)
    const pending = await readSession<{ rows: ImportRow[]; declaredProjects?: DeclaredProject[] }>('import', key)
    if (!pending) throw badRequest('ไม่พบไฟล์ที่รอยืนยัน หรือหมดเวลาแล้ว กรุณาอัปโหลดใหม่')
    const result = await commitImport(admin(req), pending.data.rows, pending.data.declaredProjects)
    await deleteSession(key)
    return result
  })

  app.post('/api/import/cancel', async (req) => {
    await deleteSession(importKey(req.cookies[COOKIE.auth]!))
    return { ok: true }
  })

  app.get('/api/import/template', async (_req, reply) => {
    const buf = await templateWorkbook()
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="attendance-template.xlsx"`)
    return reply.send(buf)
  })

  // ---- ตั้งค่าและวันหยุด -----------------------------------------------------
  app.get('/api/settings', async () => settings.readAppSettings())
  app.patch('/api/settings', async (req) => settings.patchAppSettings(admin(req), req.body))
  app.post('/api/settings/display-key', async (req) => settings.rotateDisplayKey(admin(req)))
  app.post('/api/settings/reset-attendance', async (req) => settings.resetAttendanceData(admin(req)))
  app.get('/api/holidays', async (req) => settings.listHolidays((req.query as { year?: string }).year))
  app.post('/api/holidays', async (req) => settings.addHoliday(admin(req), req.body))
  app.delete('/api/holidays/:date', async (req) => settings.removeHoliday(admin(req), (req.params as { date: string }).date))
}
