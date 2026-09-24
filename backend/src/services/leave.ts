import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import type { LeaveDuration, LeaveRequest, LeaveType } from '../contract.js'
import { db, schema, type Tx } from '../db/index.js'
import { createId } from '../lib/id.js'
import { badRequest, conflict, notFound } from '../lib/http.js'
import { loadRange } from '../lib/day.js'
import { isValidDate, localParts } from '../lib/time.js'
import { audit } from './audit.js'
import { findActiveEmployee } from './checkin.js'
import { getUploadDir } from './offsite.js'

export interface LeaveInput {
  startDate: string
  endDate: string
  duration: LeaveDuration
  leaveType: LeaveType | null
  reason: string
  medicalCertificatePending: boolean
  medicalBuffer?: Buffer | null
  medicalExt?: string
}

interface CandidateDay {
  employeeId: string
  shiftId: string
  date: string
  portion: LeaveDuration
}

function validateInput(input: LeaveInput, allowPast: boolean) {
  if (!isValidDate(input.startDate) || !isValidDate(input.endDate) || input.startDate > input.endDate)
    throw badRequest('ช่วงวันที่ลาไม่ถูกต้อง')
  if (!allowPast && input.startDate < localParts(new Date()).date) throw badRequest('พนักงานไม่สามารถยื่นลาย้อนหลังได้')
  if (!['full_day', 'morning', 'afternoon'].includes(input.duration)) throw badRequest('รูปแบบการลาไม่ถูกต้อง')
  if (input.startDate !== input.endDate && input.duration !== 'full_day') throw badRequest('การลาหลายวันต้องเป็นลาเต็มวัน')
  if (!input.reason.trim()) throw badRequest('กรุณากรอกเหตุผลการลา')
  if (!['sick', 'personal'].includes(input.leaveType ?? '')) throw badRequest('กรุณาเลือกประเภทลาป่วยหรือลากิจ')
  if (input.leaveType === 'sick' && !input.medicalBuffer && !input.medicalCertificatePending)
    throw badRequest('แนบใบรับรองแพทย์หรือเลือกว่าจะนำส่งภายหลัง')
  if (input.leaveType !== 'sick' && input.medicalCertificatePending) throw badRequest('สถานะรอใบรับรองใช้ได้กับลาป่วยเท่านั้น')
}

async function candidateDays(employeeId: string, input: LeaveInput): Promise<CandidateDay[]> {
  const range = await loadRange(input.startDate, input.endDate, { employeeId })
  const days: CandidateDay[] = []
  for (const [date, records] of range.byDate) {
    for (const record of records) {
      if (input.duration === 'morning' && record.shift.startTime >= '13:00') continue
      if (input.duration === 'afternoon' && record.shift.endTime <= '13:00') continue
      days.push({ employeeId, shiftId: record.shift.id, date, portion: input.duration })
    }
  }
  if (!days.length) throw badRequest('ช่วงวันที่เลือกไม่มีวันที่มีตารางงาน')
  return days
}

export async function assertNoRequestConflict(days: CandidateDay[], excludeLeaveId?: string, tx: Tx = db) {
  const employeeId = days[0]?.employeeId
  if (!employeeId) return
  const from = days.reduce((a, x) => (x.date < a ? x.date : a), days[0].date)
  const to = days.reduce((a, x) => (x.date > a ? x.date : a), days[0].date)
  const keys = new Set(days.map((x) => `${x.shiftId}|${x.date}`))
  const leaveConflicts = await tx
    .select({ day: schema.leaveRequestDays, requestId: schema.leaveRequests.id })
    .from(schema.leaveRequestDays)
    .innerJoin(schema.leaveRequests, eq(schema.leaveRequestDays.leaveRequestId, schema.leaveRequests.id))
    .where(
      and(
        eq(schema.leaveRequestDays.employeeId, employeeId),
        gte(schema.leaveRequestDays.date, from),
        lte(schema.leaveRequestDays.date, to),
        inArray(schema.leaveRequests.status, ['pending', 'approved']),
        excludeLeaveId ? ne(schema.leaveRequests.id, excludeLeaveId) : undefined,
      ),
    )
  if (leaveConflicts.some(({ day }) => keys.has(`${day.shiftId}|${day.date}`))) throw conflict('มีคำขอลาที่ทับกับวันและกะนี้อยู่แล้ว')
  const offsite = await tx
    .select({ shiftId: schema.offsiteRequests.shiftId, date: schema.offsiteRequests.date })
    .from(schema.offsiteRequests)
    .where(
      and(
        eq(schema.offsiteRequests.employeeId, employeeId),
        gte(schema.offsiteRequests.date, from),
        lte(schema.offsiteRequests.date, to),
        inArray(schema.offsiteRequests.status, ['pending', 'approved']),
      ),
    )
  if (offsite.some((x) => keys.has(`${x.shiftId}|${x.date}`))) throw conflict('มีคำขอทำงานนอกสถานที่ที่ทับกับวันและกะนี้อยู่แล้ว')
}

function saveMedicalFile(buffer: Buffer, ext = 'pdf') {
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'pdf'
  const filename = `${createId()}.${cleanExt}`
  fs.writeFileSync(path.join(getUploadDir(), filename), buffer)
  return `/api/requests/files/${filename}`
}

export async function createLeaveRequest(email: string, input: LeaveInput): Promise<LeaveRequest> {
  const employee = await findActiveEmployee(email)
  if (!employee) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
  return createLeaveForEmployee(employee.id, input, { allowPast: false })
}

export async function createLeaveForEmployee(
  employeeId: string,
  input: LeaveInput,
  opts: { allowPast: boolean; adminEmail?: string; approved?: boolean },
): Promise<LeaveRequest> {
  validateInput(input, opts.allowPast)
  const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId))
  if (!employee) throw notFound('ไม่พบพนักงานคนนี้')
  const days = await candidateDays(employeeId, input)
  await assertNoRequestConflict(days)
  const now = new Date()
  const medicalCertificatePath = input.medicalBuffer ? saveMedicalFile(input.medicalBuffer, input.medicalExt) : null
  const id = createId()
  await db.transaction(async (tx) => {
    await assertNoRequestConflict(days, undefined, tx)
    await tx.insert(schema.leaveRequests).values({
      id,
      employeeId,
      startDate: input.startDate,
      endDate: input.endDate,
      duration: input.duration,
      leaveType: input.leaveType,
      reason: input.reason.trim(),
      medicalCertificatePath,
      medicalCertificatePending: input.medicalBuffer ? false : input.medicalCertificatePending,
      medicalCertificateReceivedAt: input.medicalBuffer ? now : null,
      status: opts.approved ? 'approved' : 'pending',
      reviewedBy: opts.approved ? opts.adminEmail : null,
      reviewedAt: opts.approved ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(schema.leaveRequestDays).values(days.map((d) => ({ id: createId(), leaveRequestId: id, ...d })))
    if (opts.adminEmail) {
      await audit(tx, {
        adminEmail: opts.adminEmail,
        action: opts.approved ? 'leave_create_approved' : 'leave_create',
        employeeId,
        date: input.startDate,
        after: { requestId: id, ...input, medicalBuffer: undefined },
      })
    }
  })
  return getLeaveRequest(id)
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest> {
  const [row] = await db
    .select({ request: schema.leaveRequests, nickname: schema.employees.nickname, gen: schema.employees.gen })
    .from(schema.leaveRequests)
    .innerJoin(schema.employees, eq(schema.leaveRequests.employeeId, schema.employees.id))
    .where(eq(schema.leaveRequests.id, id))
  if (!row) throw notFound('ไม่พบคำขอลา')
  const days = await db
    .select({
      shiftId: schema.leaveRequestDays.shiftId,
      date: schema.leaveRequestDays.date,
      portion: schema.leaveRequestDays.portion,
      projectName: schema.projects.name,
      startTime: schema.shifts.startTime,
      endTime: schema.shifts.endTime,
    })
    .from(schema.leaveRequestDays)
    .innerJoin(schema.shifts, eq(schema.leaveRequestDays.shiftId, schema.shifts.id))
    .innerJoin(schema.projects, eq(schema.shifts.projectId, schema.projects.id))
    .where(eq(schema.leaveRequestDays.leaveRequestId, id))
    .orderBy(asc(schema.leaveRequestDays.date), asc(schema.shifts.startTime))
  const r = row.request
  return {
    kind: 'leave',
    id: r.id,
    employeeId: r.employeeId,
    startDate: r.startDate,
    endDate: r.endDate,
    duration: r.duration,
    leaveType: r.leaveType,
    reason: r.reason,
    medicalCertificatePath: r.medicalCertificatePath,
    medicalCertificatePending: r.medicalCertificatePending,
    medicalCertificateReceivedAt: r.medicalCertificateReceivedAt?.toISOString() ?? null,
    status: r.status,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    nickname: row.nickname,
    gen: row.gen,
    days,
  }
}

export async function listLeaveRequests(opts: { employeeId?: string; status?: string } = {}): Promise<LeaveRequest[]> {
  const rows = await db
    .select({ id: schema.leaveRequests.id, status: schema.leaveRequests.status })
    .from(schema.leaveRequests)
    .where(opts.employeeId ? eq(schema.leaveRequests.employeeId, opts.employeeId) : undefined)
    .orderBy(desc(schema.leaveRequests.createdAt))
  const filtered = rows.filter((r) => !opts.status || r.status === opts.status)
  return Promise.all(filtered.map((r) => getLeaveRequest(r.id)))
}

export async function cancelLeaveRequest(email: string, id: string): Promise<{ ok: true }> {
  const employee = await findActiveEmployee(email)
  if (!employee) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
  const now = new Date()
  const rows = await db
    .update(schema.leaveRequests)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.employeeId, employee.id), eq(schema.leaveRequests.status, 'pending')))
    .returning({ id: schema.leaveRequests.id })
  if (!rows.length) throw conflict('ยกเลิกไม่ได้ คำขออาจได้รับการพิจารณาไปแล้ว')
  return { ok: true }
}

export async function reviewLeaveRequest(adminEmail: string, id: string, action: 'approve' | 'reject', reason = '') {
  const request = await getLeaveRequest(id)
  if (request.status !== 'pending') throw conflict('คำขอนี้ได้รับการพิจารณาไปแล้ว')
  if (action === 'reject' && !reason.trim()) throw badRequest('กรุณาระบุเหตุผลที่ปฏิเสธ')
  const days = (request.days ?? []).map((d) => ({ employeeId: request.employeeId, shiftId: d.shiftId, date: d.date, portion: d.portion }))
  await db.transaction(async (tx) => {
    if (action === 'approve') await assertNoRequestConflict(days, id, tx)
    const now = new Date()
    const changed = await tx
      .update(schema.leaveRequests)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedBy: adminEmail,
        reviewedAt: now,
        rejectReason: action === 'reject' ? reason.trim() : null,
        updatedAt: now,
      })
      .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.status, 'pending')))
      .returning({ id: schema.leaveRequests.id })
    if (!changed.length) throw conflict('คำขอนี้ได้รับการพิจารณาไปแล้ว')
    await audit(tx, {
      adminEmail,
      action: action === 'approve' ? 'leave_approve' : 'leave_reject',
      employeeId: request.employeeId,
      date: request.startDate,
      before: { status: 'pending' },
      after: { status: action === 'approve' ? 'approved' : 'rejected', requestId: id },
      note: reason.trim(),
    })
  })
  return getLeaveRequest(id)
}

export async function adminCancelLeave(adminEmail: string, id: string) {
  const request = await getLeaveRequest(id)
  if (request.status === 'cancelled') throw conflict('คำขอนี้ถูกยกเลิกแล้ว')
  const now = new Date()
  await db.update(schema.leaveRequests).set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where(eq(schema.leaveRequests.id, id))
  await audit(db, {
    adminEmail,
    action: 'leave_cancel',
    employeeId: request.employeeId,
    date: request.startDate,
    before: { status: request.status },
    after: { status: 'cancelled', requestId: id },
  })
  return getLeaveRequest(id)
}

export async function adminUpdateLeave(adminEmail: string, id: string, input: LeaveInput) {
  const current = await getLeaveRequest(id)
  if (current.status === 'cancelled') throw conflict('แก้คำขอที่ยกเลิกแล้วไม่ได้')
  if (current.medicalCertificatePath && input.leaveType === 'sick') input.medicalCertificatePending = false
  validateInput(input, true)
  const days = await candidateDays(current.employeeId, input)
  await assertNoRequestConflict(days, id)
  const now = new Date()
  await db.transaction(async (tx) => {
    await assertNoRequestConflict(days, id, tx)
    await tx
      .update(schema.leaveRequests)
      .set({
        startDate: input.startDate,
        endDate: input.endDate,
        duration: input.duration,
        leaveType: input.leaveType,
        reason: input.reason.trim(),
        medicalCertificatePending: input.leaveType === 'sick' ? input.medicalCertificatePending : false,
        medicalCertificatePath: input.leaveType === 'sick' ? current.medicalCertificatePath : null,
        medicalCertificateReceivedAt: input.leaveType === 'sick' ? current.medicalCertificateReceivedAt ? new Date(current.medicalCertificateReceivedAt) : null : null,
        updatedAt: now,
      })
      .where(eq(schema.leaveRequests.id, id))
    await tx.delete(schema.leaveRequestDays).where(eq(schema.leaveRequestDays.leaveRequestId, id))
    await tx.insert(schema.leaveRequestDays).values(days.map((day) => ({ id: createId(), leaveRequestId: id, ...day })))
    await audit(tx, {
      adminEmail,
      action: 'leave_update',
      employeeId: current.employeeId,
      date: input.startDate,
      before: current,
      after: { requestId: id, ...input, medicalBuffer: undefined },
    })
  })
  return getLeaveRequest(id)
}

export async function uploadMedicalCertificate(email: string, id: string, buffer: Buffer, ext: string) {
  const employee = await findActiveEmployee(email)
  if (!employee) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
  const [request] = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, id))
  if (!request || request.employeeId !== employee.id) throw notFound('ไม่พบคำขอลา')
  if (request.leaveType !== 'sick') throw badRequest('คำขอนี้ไม่ใช่ลาป่วย')
  const now = new Date()
  const filePath = saveMedicalFile(buffer, ext)
  await db
    .update(schema.leaveRequests)
    .set({ medicalCertificatePath: filePath, medicalCertificatePending: false, medicalCertificateReceivedAt: now, updatedAt: now })
    .where(eq(schema.leaveRequests.id, id))
  return getLeaveRequest(id)
}

export async function markMedicalReceived(adminEmail: string, id: string) {
  const request = await getLeaveRequest(id)
  if (request.leaveType !== 'sick') throw badRequest('คำขอนี้ไม่ใช่ลาป่วย')
  const now = new Date()
  await db
    .update(schema.leaveRequests)
    .set({ medicalCertificatePending: false, medicalCertificateReceivedAt: now, updatedAt: now })
    .where(eq(schema.leaveRequests.id, id))
  await audit(db, { adminEmail, action: 'leave_document_received', employeeId: request.employeeId, date: request.startDate, after: { requestId: id } })
  return getLeaveRequest(id)
}
