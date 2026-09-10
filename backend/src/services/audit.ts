import { and, asc, eq } from 'drizzle-orm'
import { STATUS_LABEL, type AuditEntry, type ShiftStatus } from '../contract.js'
import { db, schema, type Tx } from '../db/index.js'

export interface AuditInput {
  adminEmail: string
  action: string
  employeeId?: string | null
  shiftId?: string | null
  date?: string | null
  before?: unknown
  after?: unknown
  note?: string
}

export async function audit(tx: Tx, e: AuditInput) {
  await tx.insert(schema.auditLog).values({
    adminEmail: e.adminEmail,
    action: e.action,
    employeeId: e.employeeId ?? null,
    shiftId: e.shiftId ?? null,
    date: e.date ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
    note: e.note ?? '',
  })
}

/** สถานะของกะในรูปที่เก็บลง audit */
export interface SnapState {
  status: ShiftStatus
  scannedAt: string | null
  earlyLeaveAt: string | null
}

function describe(s: SnapState | null): string | null {
  if (!s) return null
  let t = STATUS_LABEL[s.status]
  if (s.scannedAt) t += ` (สแกน ${s.scannedAt.slice(0, 5)})`
  if (s.earlyLeaveAt) t += ` · กลับก่อน ${s.earlyLeaveAt.slice(0, 5)}`
  return t
}

const LABEL: Record<string, (a: SnapState | null, extra: Record<string, unknown>) => string> = {
  checkin: (_a, x) => `เช็กชื่อแทน เวลา ${x.time ?? ''}`,
  undo_checkin: () => 'ยกเลิกการเช็กชื่อที่กดแทน',
  early_leave: (_a, x) => `แจ้งกลับก่อนแทน เวลา ${x.time ?? ''}`,
  clear_early_leave: () => 'ล้างการแจ้งกลับก่อนเวลา',
  set_status: (a) => `แก้สถานะเป็น ${a ? STATUS_LABEL[a.status] : ''}`,
  clear_status: () => 'ล้างสถานะที่แก้ไว้ กลับไปใช้ค่าที่คำนวณได้',
}

/** ประวัติการกดของแอดมินสำหรับกะหนึ่งกะในวันหนึ่ง */
export async function shiftHistory(shiftId: string, date: string): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.shiftId, shiftId), eq(schema.auditLog.date, date)))
    .orderBy(asc(schema.auditLog.createdAt))
  return rows.map((r) => {
    const before = r.before as SnapState | null
    const after = r.after as (SnapState & Record<string, unknown>) | null
    return {
      id: r.id,
      adminEmail: r.adminEmail,
      label: (LABEL[r.action] ?? (() => r.action))(after, after ?? {}),
      before: describe(before),
      after: describe(after),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }
  })
}
