import { and, desc, eq, inArray } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import type { OffsiteRequest, OffsiteStatus } from '../contract.js'
import { db, schema } from '../db/index.js'
import { createId } from '../lib/id.js'
import { badRequest, conflict, notFound } from '../lib/http.js'
import { toEmployee } from '../lib/mappers.js'
import { localParts } from '../lib/time.js'
import { loadDay } from '../lib/day.js'
import { audit } from './audit.js'
import { findActiveEmployee } from './checkin.js'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export function getUploadDir() {
  return UPLOAD_DIR
}

async function assertOffsiteAvailable(employeeId: string, shiftId: string, date: string) {
  const [offsite] = await db
    .select({ id: schema.offsiteRequests.id })
    .from(schema.offsiteRequests)
    .where(
      and(
        eq(schema.offsiteRequests.employeeId, employeeId),
        eq(schema.offsiteRequests.shiftId, shiftId),
        eq(schema.offsiteRequests.date, date),
        inArray(schema.offsiteRequests.status, ['pending', 'approved']),
      ),
    )
  if (offsite) throw conflict('มีคำขอทำงานนอกสถานที่ของกะนี้อยู่แล้ว')
  const [leave] = await db
    .select({ id: schema.leaveRequestDays.id })
    .from(schema.leaveRequestDays)
    .innerJoin(schema.leaveRequests, eq(schema.leaveRequestDays.leaveRequestId, schema.leaveRequests.id))
    .where(
      and(
        eq(schema.leaveRequestDays.employeeId, employeeId),
        eq(schema.leaveRequestDays.shiftId, shiftId),
        eq(schema.leaveRequestDays.date, date),
        inArray(schema.leaveRequests.status, ['pending', 'approved']),
      ),
    )
  if (leave) throw conflict('มีคำขอลาที่ทับกับกะนี้อยู่แล้ว')
}

export async function getEmployeeOffsiteStatus(email: string) {
  const emp = await findActiveEmployee(email)
  if (!emp) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')

  const now = new Date()
  const { date, time } = localParts(now)
  const { holiday, records } = await loadDay(date, { employeeId: emp.id })

  const requests = await db
    .select({
      req: schema.offsiteRequests,
      projectName: schema.projects.name,
      startTime: schema.shifts.startTime,
      endTime: schema.shifts.endTime,
    })
    .from(schema.offsiteRequests)
    .innerJoin(schema.shifts, eq(schema.offsiteRequests.shiftId, schema.shifts.id))
    .innerJoin(schema.projects, eq(schema.shifts.projectId, schema.projects.id))
    .where(and(eq(schema.offsiteRequests.employeeId, emp.id), eq(schema.offsiteRequests.date, date)))
    .orderBy(desc(schema.offsiteRequests.createdAt))

  const formattedRequests: OffsiteRequest[] = requests.map(({ req, projectName, startTime, endTime }) => ({
    kind: 'offsite',
    id: req.id,
    employeeId: req.employeeId,
    shiftId: req.shiftId,
    date: req.date,
    taskDescription: req.taskDescription,
    photoPath: req.photoPath,
    latitude: req.latitude,
    longitude: req.longitude,
    locationName: req.locationName,
    status: req.status as OffsiteStatus,
    reviewedBy: req.reviewedBy,
    reviewedAt: req.reviewedAt ? req.reviewedAt.toISOString() : null,
    rejectReason: req.rejectReason,
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
    nickname: emp.nickname,
    gen: emp.gen,
    projectName,
    startTime,
    endTime,
  }))

  return {
    employee: toEmployee(emp),
    date,
    time,
    holiday,
    shifts: records.map((r) => r.row),
    requests: formattedRequests,
  }
}

export async function createOffsiteRequest(
  email: string,
  params: {
    shiftId: string
    taskDescription: string
    latitude: string
    longitude: string
    locationName?: string
    photoBuffer: Buffer
    ext: string
  },
): Promise<OffsiteRequest> {
  const emp = await findActiveEmployee(email)
  if (!emp) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')

  const { shiftId, taskDescription, latitude, longitude, locationName, photoBuffer, ext } = params
  if (!shiftId) throw badRequest('กรุณาเลือกกะทำงาน')
  if (!taskDescription.trim()) throw badRequest('กรุณาระบุงานที่จะทำในวันนี้')
  if (!latitude || !longitude) throw badRequest('กรุณาแชร์พิกัดสถานที่ทำงาน')
  if (!photoBuffer || photoBuffer.length === 0) throw badRequest('กรุณาแนบภาพถ่ายหลักฐาน')

  const now = new Date()
  const { date } = localParts(now)

  // ตรวจสอบว่ากะนี้เป็นของพนักงานคนนี้และมีอยู่ในวันนี้
  const { records } = await loadDay(date, { employeeId: emp.id })
  const rec = records.find((r) => r.shift.id === shiftId)
  if (!rec) throw badRequest('ไม่พบกะงานนี้สำหรับวันนี้')
  await assertOffsiteAvailable(emp.id, shiftId, date)

  // บันทึกไฟล์รูป
  const fileId = createId()
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg'
  const filename = `${fileId}.${cleanExt}`
  const filePath = path.join(UPLOAD_DIR, filename)
  fs.writeFileSync(filePath, photoBuffer)
  const photoPath = `/api/requests/files/${filename}`

  const id = createId()
  const [created] = await db
    .insert(schema.offsiteRequests)
    .values({
      id,
      employeeId: emp.id,
      shiftId,
      date,
      taskDescription: taskDescription.trim(),
      photoPath,
      latitude,
      longitude,
      locationName: locationName ? locationName.trim() : null,
      status: 'pending',
      createdAt: now,
    })
    .returning()

  return {
    kind: 'offsite',
    id: created.id,
    employeeId: created.employeeId,
    shiftId: created.shiftId,
    date: created.date,
    taskDescription: created.taskDescription,
    photoPath: created.photoPath,
    latitude: created.latitude,
    longitude: created.longitude,
    locationName: created.locationName,
    status: created.status as OffsiteStatus,
    reviewedBy: created.reviewedBy,
    reviewedAt: null,
    rejectReason: null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    nickname: emp.nickname,
    gen: emp.gen,
    projectName: rec.projectName,
    startTime: rec.shift.startTime,
    endTime: rec.shift.endTime,
  }
}

export async function listAdminOffsiteRequests(opts: { date?: string; status?: string } = {}): Promise<OffsiteRequest[]> {
  const query = db
    .select({
      req: schema.offsiteRequests,
      nickname: schema.employees.nickname,
      gen: schema.employees.gen,
      projectName: schema.projects.name,
      startTime: schema.shifts.startTime,
      endTime: schema.shifts.endTime,
    })
    .from(schema.offsiteRequests)
    .innerJoin(schema.employees, eq(schema.offsiteRequests.employeeId, schema.employees.id))
    .innerJoin(schema.shifts, eq(schema.offsiteRequests.shiftId, schema.shifts.id))
    .innerJoin(schema.projects, eq(schema.shifts.projectId, schema.projects.id))
    .orderBy(desc(schema.offsiteRequests.createdAt))

  const rows = await (opts.date ? query.where(eq(schema.offsiteRequests.date, opts.date)) : query)

  return rows
    .filter((r) => !opts.status || r.req.status === opts.status)
    .map(({ req, nickname, gen, projectName, startTime, endTime }) => ({
      kind: 'offsite' as const,
      id: req.id,
      employeeId: req.employeeId,
      shiftId: req.shiftId,
      date: req.date,
      taskDescription: req.taskDescription,
      photoPath: req.photoPath,
      latitude: req.latitude,
      longitude: req.longitude,
      locationName: req.locationName,
      status: req.status as OffsiteStatus,
      reviewedBy: req.reviewedBy,
      reviewedAt: req.reviewedAt ? req.reviewedAt.toISOString() : null,
      rejectReason: req.rejectReason,
      createdAt: req.createdAt.toISOString(),
      updatedAt: req.updatedAt.toISOString(),
      nickname,
      gen,
      projectName,
      startTime,
      endTime,
    }))
}

export async function reviewOffsiteRequest(
  adminEmail: string,
  requestId: string,
  action: 'approve' | 'reject',
  rejectReason?: string,
): Promise<OffsiteRequest> {
  const [req] = await db.select().from(schema.offsiteRequests).where(eq(schema.offsiteRequests.id, requestId))
  if (!req) throw notFound('ไม่พบคำขอนี้')
  if (req.status !== 'pending') throw badRequest('คำขอนี้ได้รับการพิจารณาไปแล้ว')

  const now = new Date()

  if (action === 'approve') {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.offsiteRequests)
        .set({
          status: 'approved',
          reviewedBy: adminEmail,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.offsiteRequests.id, requestId))
        .returning()

      // บันทึกเวลาเข้างาน: เวลาที่พนักงานกดส่งคำขอ (req.createdAt)
      await tx
        .insert(schema.attendance)
        .values({
          employeeId: req.employeeId,
          shiftId: req.shiftId,
          date: req.date,
          scannedAt: req.createdAt,
          isOffsite: true,
          recordedBy: adminEmail,
        })
        .onConflictDoUpdate({
          target: [schema.attendance.shiftId, schema.attendance.date],
          set: {
            scannedAt: req.createdAt,
            isOffsite: true,
            recordedBy: adminEmail,
          },
        })

      await audit(tx, {
        adminEmail,
        action: 'offsite_approve',
        employeeId: req.employeeId,
        shiftId: req.shiftId,
        date: req.date,
        note: req.taskDescription,
        after: { requestId: req.id, status: 'approved' },
      })

      const [emp] = await tx.select().from(schema.employees).where(eq(schema.employees.id, req.employeeId))
      const [shift] = await tx.select().from(schema.shifts).where(eq(schema.shifts.id, req.shiftId))
      const [project] = shift ? await tx.select().from(schema.projects).where(eq(schema.projects.id, shift.projectId)) : [null]

      return {
        kind: 'offsite',
        id: updated.id,
        employeeId: updated.employeeId,
        shiftId: updated.shiftId,
        date: updated.date,
        taskDescription: updated.taskDescription,
        photoPath: updated.photoPath,
        latitude: updated.latitude,
        longitude: updated.longitude,
        locationName: updated.locationName,
        status: 'approved',
        reviewedBy: adminEmail,
        reviewedAt: now.toISOString(),
        rejectReason: null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        nickname: emp?.nickname,
        gen: emp?.gen,
        projectName: project?.name,
        startTime: shift?.startTime,
        endTime: shift?.endTime,
      }
    })
  } else {
    const reason = rejectReason ? rejectReason.trim() : null
    if (!reason) throw badRequest('กรุณาระบุเหตุผลที่ปฏิเสธ')
    const [updated] = await db
      .update(schema.offsiteRequests)
      .set({
        status: 'rejected',
        reviewedBy: adminEmail,
        reviewedAt: now,
        rejectReason: reason,
        updatedAt: now,
      })
      .where(eq(schema.offsiteRequests.id, requestId))
      .returning()

    await audit(db, {
      adminEmail,
      action: 'offsite_reject',
      employeeId: req.employeeId,
      shiftId: req.shiftId,
      date: req.date,
      note: reason || '',
      after: { requestId: req.id, status: 'rejected' },
    })

    const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.id, req.employeeId))
    const [shift] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, req.shiftId))
    const [project] = shift ? await db.select().from(schema.projects).where(eq(schema.projects.id, shift.projectId)) : [null]

    return {
      kind: 'offsite',
      id: updated.id,
      employeeId: updated.employeeId,
      shiftId: updated.shiftId,
      date: updated.date,
      taskDescription: updated.taskDescription,
      photoPath: updated.photoPath,
      latitude: updated.latitude,
      longitude: updated.longitude,
      locationName: updated.locationName,
      status: 'rejected',
      reviewedBy: adminEmail,
      reviewedAt: now.toISOString(),
      rejectReason: reason,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      nickname: emp?.nickname,
      gen: emp?.gen,
      projectName: project?.name,
      startTime: shift?.startTime,
      endTime: shift?.endTime,
    }
  }
}

export async function cancelOffsiteRequest(email: string, requestId: string): Promise<{ ok: true }> {
  const emp = await findActiveEmployee(email)
  if (!emp) throw notFound('ไม่พบพนักงานบัญชีนี้ในระบบ')
  const now = new Date()
  const rows = await db
    .update(schema.offsiteRequests)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(and(eq(schema.offsiteRequests.id, requestId), eq(schema.offsiteRequests.employeeId, emp.id), eq(schema.offsiteRequests.status, 'pending')))
    .returning({ id: schema.offsiteRequests.id })
  if (!rows.length) throw conflict('ยกเลิกไม่ได้ คำขออาจได้รับการพิจารณาไปแล้ว')
  return { ok: true }
}
