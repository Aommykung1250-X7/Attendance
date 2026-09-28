// พนักงาน โปรเจก และตารางกะรายคน (spec 9.3 และ 9.4)

import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm'
import type { Employee, EmployeeSchedule, ProjectDetail, ProjectSummary, ScheduleWriteResult, ShiftEntry } from '../contract.js'
import { db, schema, type Tx } from '../db/index.js'
import { asBody, badRequest, conflict, EMAIL_RE, normalizeEmail, notFound, optString, reqString } from '../lib/http.js'
import { displayName, toEmployee, toProject, toShift } from '../lib/mappers.js'
import { applyAssignment, describeSchedule, loadCurrentShifts, reconcile, retireAllShifts, validateEntries } from '../lib/schedule.js'
import { isHHMM, localParts, minutesOf } from '../lib/time.js'
import { audit } from './audit.js'

const today = () => localParts(new Date()).date

// ---------------------------------------------------------------------------
// พนักงาน
// ---------------------------------------------------------------------------

export async function listEmployees(includeInactive: boolean): Promise<Employee[]> {
  const rows = await db
    .select()
    .from(schema.employees)
    .where(includeInactive ? undefined : eq(schema.employees.isActive, true))
    .orderBy(asc(schema.employees.type), asc(schema.employees.gen), asc(schema.employees.nickname))
  return rows.map(toEmployee)
}

async function getEmployee(tx: Tx, id: string) {
  const [e] = await tx.select().from(schema.employees).where(eq(schema.employees.id, id))
  if (!e) throw notFound('ไม่พบพนักงานคนนี้')
  return e
}

function parseEmployeeInput(raw: unknown, partial: boolean) {
  const b = asBody(raw)
  const out: Partial<{ nickname: string; gen: string | null; email: string | null; type: 'staff' | 'student'; position: string }> = {}
  if (!partial || b.nickname !== undefined) out.nickname = reqString(b, 'nickname', 'ชื่อเล่น', 80)
  if (!partial || b.email !== undefined) {
    // เว้นว่างได้ คนที่ยังไม่มีอีเมลจะล็อกอินเช็กชื่อเองไม่ได้ แต่แอดมินกดแทนได้
    const email = normalizeEmail(optString(b, 'email', 200) ?? '')
    if (email && !EMAIL_RE.test(email)) throw badRequest('อีเมลไม่ถูกต้อง แก้ให้อยู่ในรูป name@example.com')
    out.email = email || null
  }
  if (!partial || b.type !== undefined) {
    if (b.type !== 'staff' && b.type !== 'student') throw badRequest('เลือกประเภท: ประจำ หรือ นักศึกษา')
    out.type = b.type
  }
  if (!partial || b.gen !== undefined) {
    const g = optString(b, 'gen', 40)
    out.gen = g ? g : null
  }
  if (!partial || b.position !== undefined) out.position = optString(b, 'position', 120) ?? ''
  return out
}

async function assertEmailFree(tx: Tx, email: string, exceptId?: string) {
  const [dup] = await tx
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.email, email), exceptId ? ne(schema.employees.id, exceptId) : undefined))
  if (dup) {
    throw conflict(
      dup.isActive
        ? `อีเมลนี้เป็นของ ${displayName(dup)} อยู่แล้ว`
        : `อีเมลนี้เป็นของ ${displayName(dup)} ที่ถูกซ่อนไว้ กู้คืนคนนั้นแทนการเพิ่มใหม่`,
    )
  }
}

export async function createEmployee(adminEmail: string, raw: unknown): Promise<Employee> {
  const input = parseEmployeeInput(raw, false) as Required<ReturnType<typeof parseEmployeeInput>>
  return db.transaction(async (tx) => {
    if (input.email) await assertEmailFree(tx, input.email)
    const [e] = await tx.insert(schema.employees).values(input).returning()
    await audit(tx, { adminEmail, action: 'employee_create', employeeId: e.id, after: toEmployee(e) })
    return toEmployee(e)
  })
}

export async function updateEmployee(adminEmail: string, id: string, raw: unknown): Promise<Employee> {
  const input = parseEmployeeInput(raw, true)
  return db.transaction(async (tx) => {
    const before = await getEmployee(tx, id)
    if (input.email) await assertEmailFree(tx, input.email, id)
    const [e] = await tx.update(schema.employees).set(input).where(eq(schema.employees.id, id)).returning()
    await audit(tx, { adminEmail, action: 'employee_update', employeeId: id, before: toEmployee(before), after: toEmployee(e) })
    return toEmployee(e)
  })
}

/**
 * ลบแบบซ่อน: หายจากทุกหน้า ล็อกอินไม่ได้ ไม่ต้องมาเช็กชื่อ แต่ข้อมูลเดิมยังอยู่
 * เพื่อไม่ให้รายงานของเดือนที่ผ่านมาเปลี่ยนย้อนหลัง
 */
export async function hideEmployee(adminEmail: string, id: string): Promise<Employee> {
  return db.transaction(async (tx) => {
    const before = await getEmployee(tx, id)
    if (!before.isActive) return toEmployee(before)
    await retireAllShifts(tx, id, today())
    const [e] = await tx
      .update(schema.employees)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(eq(schema.employees.id, id))
      .returning()
    // ออกจากระบบทุกเครื่องทันที
    if (e.email) await tx.execute(sql`delete from ${schema.sessions} where kind = 'auth' and data->>'email' = ${e.email}`)
    await audit(tx, { adminEmail, action: 'employee_hide', employeeId: id, before: toEmployee(before) })
    return toEmployee(e)
  })
}

/** กู้คืนคนที่ถูกซ่อน ตารางกะเดิมไม่กลับมา ต้องเพิ่มเข้าโปรเจกหรือนำเข้าใหม่ */
export async function restoreEmployee(adminEmail: string, id: string): Promise<Employee> {
  return db.transaction(async (tx) => {
    const before = await getEmployee(tx, id)
    const [e] = await tx
      .update(schema.employees)
      .set({ isActive: true, deactivatedAt: null })
      .where(eq(schema.employees.id, id))
      .returning()
    await audit(tx, { adminEmail, action: 'employee_restore', employeeId: id, before: toEmployee(before) })
    return toEmployee(e)
  })
}

/** ลบถาวร สำหรับกรณีเพิ่มผิดคนเท่านั้น ต้องพิมพ์ชื่อยืนยัน */
export async function purgeEmployee(adminEmail: string, id: string, raw: unknown) {
  const confirmName = String(asBody(raw).confirmName ?? '').trim()
  return db.transaction(async (tx) => {
    const e = await getEmployee(tx, id)
    if (confirmName !== e.nickname) throw badRequest(`พิมพ์ชื่อ "${e.nickname}" ให้ตรงเพื่อยืนยัน`)
    await tx.delete(schema.employees).where(eq(schema.employees.id, id)) // shifts/attendance/overrides ถูกลบตาม (cascade)
    if (e.email) await tx.execute(sql`delete from ${schema.sessions} where kind = 'auth' and data->>'email' = ${e.email}`)
    await audit(tx, { adminEmail, action: 'employee_purge', employeeId: id, before: toEmployee(e) })
    return { ok: true }
  })
}

// ---------------------------------------------------------------------------
// ตารางกะรายคน
// ---------------------------------------------------------------------------

export async function employeeSchedule(id: string, tx: Tx = db): Promise<EmployeeSchedule> {
  const e = await getEmployee(tx, id)
  const rows = await tx
    .select({ shift: schema.shifts, project: schema.projects })
    .from(schema.shifts)
    .innerJoin(schema.projects, eq(schema.shifts.projectId, schema.projects.id))
    .where(and(eq(schema.shifts.employeeId, id), isNull(schema.shifts.validTo)))
  const byProject = new Map<string, EmployeeSchedule['assignments'][number]>()
  for (const { shift, project } of rows) {
    const a = byProject.get(project.id) ?? { projectId: project.id, projectName: project.name, shifts: [] }
    a.shifts.push(toShift(shift))
    byProject.set(project.id, a)
  }
  for (const a of byProject.values())
    a.shifts.sort((x, y) => x.weekday - y.weekday || minutesOf(x.startTime) - minutesOf(y.startTime))
  return {
    employee: toEmployee(e),
    assignments: [...byProject.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, 'th')),
  }
}

export function parseEntries(raw: unknown): ShiftEntry[] {
  const list = asBody(raw).shifts
  if (!Array.isArray(list)) throw badRequest('ไม่มีรายการกะ')
  if (list.length > 21) throw badRequest('กะมากเกินไป')
  const entries = list.map((x) => {
    const b = asBody(x)
    return { weekday: Number(b.weekday), startTime: String(b.startTime ?? ''), endTime: String(b.endTime ?? '') }
  })
  const errors = validateEntries(entries)
  if (errors.length) throw badRequest(errors.join('\n'))
  return entries
}

/**
 * เขียนกะของคู่ (คนนี้, โปรเจกนี้) ทับทั้งหมด ส่งรายการว่าง = เอาออกจากโปรเจก
 * ถ้าเวลาทับกับกะของโปรเจกอื่นของคนเดียวกัน กะเดิมจะถูกแทนที่ (ใครเขียนทีหลังชนะ)
 */
export async function writeAssignment(
  adminEmail: string,
  employeeId: string,
  projectId: string,
  entries: ShiftEntry[],
): Promise<ScheduleWriteResult> {
  return db.transaction(async (tx) => {
    const e = await getEmployee(tx, employeeId)
    if (!e.isActive) throw badRequest('คนนี้ถูกซ่อนอยู่ กู้คืนก่อนจึงจะแก้ตารางได้')
    const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId))
    if (!project) throw notFound('ไม่พบโปรเจกนี้')

    const current = await loadCurrentShifts(tx, [employeeId])
    const { next, replaced } = applyAssignment(current, employeeId, projectId, entries)
    const writeResult = await reconcile(tx, current, next, today())

    const projectNames = new Map(
      (await tx.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects)).map((p) => [p.id, p.name]),
    )
    await audit(tx, {
      adminEmail,
      action: 'schedule_write',
      employeeId,
      before: { project: project.name, schedule: describeSchedule(current.filter((s) => s.projectId === projectId)) },
      after: {
        project: project.name,
        schedule: describeSchedule(entries),
        replaced: replaced.map((r) => `${projectNames.get(r.projectId)} ${describeSchedule([r])}`),
      },
    })
    return {
      schedule: await employeeSchedule(employeeId, tx),
      replaced: replaced.map((r) => ({
        projectName: projectNames.get(r.projectId) ?? '',
        weekday: r.weekday,
        startTime: r.startTime,
        endTime: r.endTime,
      })),
      effectiveFrom: writeResult.effectiveFrom,
      deferredBecauseTodayUsed: writeResult.deferredBecauseTodayUsed,
    }
  })
}

// ---------------------------------------------------------------------------
// โปรเจก
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await db.select().from(schema.projects).orderBy(asc(schema.projects.name))
  const counts = await db
    .select({ projectId: schema.shifts.projectId, n: sql<number>`count(distinct ${schema.shifts.employeeId})` })
    .from(schema.shifts)
    .innerJoin(schema.employees, eq(schema.shifts.employeeId, schema.employees.id))
    .where(and(isNull(schema.shifts.validTo), eq(schema.employees.isActive, true)))
    .groupBy(schema.shifts.projectId)
  const n = new Map(counts.map((c) => [c.projectId, Number(c.n)]))
  return rows.map((p) => ({ ...toProject(p), memberCount: n.get(p.id) ?? 0 }))
}

function parseProjectInput(raw: unknown, partial: boolean) {
  const b = asBody(raw)
  const out: Partial<{ name: string; defaultStart: string; defaultEnd: string }> = {}
  if (!partial || b.name !== undefined) out.name = reqString(b, 'name', 'ชื่อโปรเจก', 120)
  for (const k of ['defaultStart', 'defaultEnd'] as const) {
    if (!partial || b[k] !== undefined) {
      if (!isHHMM(b[k])) throw badRequest('เวลาต้องอยู่ในรูป HH:MM เช่น 09:30')
      out[k] = b[k] as string
    }
  }
  return out
}

async function assertProjectNameFree(tx: Tx, name: string, exceptId?: string) {
  const [dup] = await tx
    .select()
    .from(schema.projects)
    .where(and(sql`lower(${schema.projects.name}) = lower(${name})`, exceptId ? ne(schema.projects.id, exceptId) : undefined))
  if (dup) throw conflict(`มีโปรเจกชื่อ ${dup.name} อยู่แล้ว`)
}

export async function createProject(adminEmail: string, raw: unknown) {
  const input = parseProjectInput(raw, false) as Required<ReturnType<typeof parseProjectInput>>
  if (minutesOf(input.defaultEnd) <= minutesOf(input.defaultStart)) throw badRequest('เวลาเลิกต้องอยู่หลังเวลาเริ่ม')
  return db.transaction(async (tx) => {
    await assertProjectNameFree(tx, input.name)
    const [p] = await tx.insert(schema.projects).values(input).returning()
    await audit(tx, { adminEmail, action: 'project_create', after: toProject(p) })
    return toProject(p)
  })
}

export async function updateProject(adminEmail: string, id: string, raw: unknown) {
  const input = parseProjectInput(raw, true)
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projects).where(eq(schema.projects.id, id))
    if (!before) throw notFound('ไม่พบโปรเจกนี้')
    if (input.name) await assertProjectNameFree(tx, input.name, id)
    const merged = { ...before, ...input }
    if (minutesOf(merged.defaultEnd) <= minutesOf(merged.defaultStart)) throw badRequest('เวลาเลิกต้องอยู่หลังเวลาเริ่ม')
    const [p] = await tx.update(schema.projects).set(input).where(eq(schema.projects.id, id)).returning()
    await audit(tx, { adminEmail, action: 'project_update', before: toProject(before), after: toProject(p) })
    return toProject(p)
  })
}

/** ลบได้เฉพาะโปรเจกที่ไม่เคยมีกะเลย ไม่งั้นประวัติการเช็กชื่อจะเสีย */
export async function deleteProject(adminEmail: string, id: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.projects).where(eq(schema.projects.id, id))
    if (!p) throw notFound('ไม่พบโปรเจกนี้')
    const [{ n }] = await tx.select({ n: count() }).from(schema.shifts).where(eq(schema.shifts.projectId, id))
    if (Number(n) > 0) throw conflict('โปรเจกนี้เคยมีกะแล้ว ลบไม่ได้เพื่อรักษาประวัติ เอาคนออกจากโปรเจกแทน')
    await tx.delete(schema.projects).where(eq(schema.projects.id, id))
    await audit(tx, { adminEmail, action: 'project_delete', before: toProject(p) })
    return { ok: true }
  })
}

export async function projectDetail(id: string): Promise<ProjectDetail> {
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, id))
  if (!p) throw notFound('ไม่พบโปรเจกนี้')
  const rows = await db
    .select({ shift: schema.shifts, employee: schema.employees })
    .from(schema.shifts)
    .innerJoin(schema.employees, eq(schema.shifts.employeeId, schema.employees.id))
    .where(and(eq(schema.shifts.projectId, id), isNull(schema.shifts.validTo), eq(schema.employees.isActive, true)))
  const members = new Map<string, ProjectDetail['members'][number]>()
  for (const { shift, employee } of rows) {
    const m = members.get(employee.id) ?? { employee: toEmployee(employee), shifts: [] }
    m.shifts.push(toShift(shift))
    members.set(employee.id, m)
  }
  for (const m of members.values())
    m.shifts.sort((a, b) => a.weekday - b.weekday || minutesOf(a.startTime) - minutesOf(b.startTime))
  return {
    project: toProject(p),
    members: [...members.values()].sort((a, b) => a.employee.nickname.localeCompare(b.employee.nickname, 'th')),
  }
}
