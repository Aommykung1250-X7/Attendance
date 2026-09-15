// ชนิดข้อมูลกลาง ตรงกับ spec หัวข้อ 6 และ 7
// backend ต้องส่ง JSON ตามรูปนี้เป๊ะๆ

export type EmployeeType = 'staff' | 'student'

/** สถานะของ "กะ" หนึ่งกะ ไม่ใช่ของทั้งวัน */
export type ShiftStatus = 'ontime' | 'late' | 'absent' | 'leave' | 'pending'

export const STATUS_LABEL: Record<ShiftStatus, string> = {
  ontime: 'ปกติ',
  late: 'สาย',
  absent: 'ขาด',
  leave: 'ลา',
  pending: 'ยังไม่มา',
}

export interface Employee {
  id: string
  nickname: string
  gen: string | null
  /** null = ยังไม่ได้กรอก คนนี้ล็อกอินเช็กชื่อเองไม่ได้จนกว่าจะกรอก */
  email: string | null
  type: EmployeeType
  position: string
  isActive: boolean
}

export interface Project {
  id: string
  name: string
  defaultStart: string // 'HH:MM'
  defaultEnd: string
}

/** หนึ่งแถว = คนนี้ โปรเจกนี้ วันนี้ของสัปดาห์ เวลานี้ */
export interface Shift {
  id: string
  employeeId: string
  projectId: string
  weekday: number // 1 = จันทร์ ... 7 = อาทิตย์
  startTime: string
  endTime: string
}

/** กะหนึ่งกะของวันหนึ่ง พร้อมสถานะที่คำนวณแล้ว */
export interface ShiftInstance {
  shiftId: string
  employeeId: string
  nickname: string
  gen: string | null
  projectName: string
  startTime: string
  endTime: string
  scannedAt: string | null // 'HH:MM:SS'
  earlyLeaveAt: string | null
  checkedOutAt: string | null
  status: ShiftStatus
  recordedBy: 'self' | 'admin' | null
  checkedOutBy: 'self' | 'admin' | null
  adminNote: string | null
}

export interface KioskBoard {
  serverTime: string // ISO
  dateLabel: string
  qrToken: string
  tokenExpiresIn: number // วินาที
  summary: { expected: number; arrived: number; late: number; pending: number; leave: number; absent: number }
  groups: { startTime: string; label: string; rows: ShiftInstance[] }[]
  /** ทุกกะของวันนี้ ใช้แสดงว่าใครต้องมาและใครมาแล้ว */
  today: ShiftInstance[]
}

/** สิ่งที่หน้าเช็กชื่อบนมือถือได้รับกลับมา ตรงกับ spec หัวข้อ 8 */
export type CheckInView =
  | { kind: 'expired' }
  | { kind: 'not_registered'; email: string }
  | { kind: 'no_shift_today'; nickname: string }
  | { kind: 'all_done'; nickname: string }
  | { kind: 'too_early'; nickname: string; previousEndTime: string }
  | { kind: 'ready'; nickname: string; shift: ShiftInstance; scannedAt: string }
  | { kind: 'ready_checkout'; nickname: string; shift: ShiftInstance; scannedAt: string }
  | { kind: 'early_leave'; nickname: string; shift: ShiftInstance; minutesRemaining: number }
  | { kind: 'done'; nickname: string; shift: ShiftInstance; status: ShiftStatus }
  | { kind: 'checkout_done'; nickname: string; shift: ShiftInstance }
  | { kind: 'early_leave_done'; nickname: string; shift: ShiftInstance }

export interface MonthlyReport {
  employee: Employee
  month: string // 'YYYY-MM'
  totals: { workdays: number; present: number; late: number; leave: number; absent: number; earlyLeave: number }
  days: { date: string; dateLabel: string; entries: ShiftInstance[] }[]
}

export interface ImportProblem {
  row: number
  column: string
  message: string
  fix: string
}

export interface ImportPreview {
  ok: boolean
  problems: ImportProblem[]
  newProjects: { name: string; memberCount: number; defaultStart?: string | null; defaultEnd?: string | null }[]
  newEmployees: { nickname: string; email: string | null; projectName: string }[]
  newAssignments: { nickname: string; projectName: string }[]
  changedShifts: { nickname: string; projectName: string; before: string; after: string }[]
  /** แถวที่ตรงกับของเดิมอยู่แล้ว ไม่มีอะไรเปลี่ยน */
  unchangedCount?: number
}

// ---------------------------------------------------------------------------
// ส่วนที่เพิ่มสำหรับหน้าแอดมิน (ของเดิมด้านบนไม่ได้เปลี่ยน)
// ---------------------------------------------------------------------------

/** ผู้ใช้ที่ล็อกอินอยู่ */
export interface Me {
  email: string
  name: string | null
  isAdmin: boolean
  employee: Employee | null
}

/** หน้าบันทึกประจำวัน (spec 9.6) */
export interface DayLog {
  date: string // 'YYYY-MM-DD'
  dateLabel: string
  isToday: boolean
  holiday: string | null
  summary: KioskBoard['summary']
  rows: DayLogRow[]
}

export interface DayLogRow extends ShiftInstance {
  /** สถานะมาจากการแก้ของแอดมิน ไม่ใช่การคำนวณ */
  overridden: boolean
  /** จำนวนครั้งที่แอดมินเคยกดกับกะนี้ในวันนี้ */
  historyCount: number
}

export type OverrideStatus = 'leave' | 'present' | 'late' | 'absent'

export type AdminAction =
  | { action: 'checkin'; time: string; note?: string } // กดเช็กชื่อแทน เวลา 'HH:MM'
  | { action: 'undo_checkin'; note?: string } // ยกเลิกการเช็กชื่อที่แอดมินกดแทน (ของที่พนักงานสแกนเองลบไม่ได้)
  | { action: 'checkout'; time: string; note?: string } // กดออกงานแทน เวลา 'HH:MM'
  | { action: 'clear_checkout'; note?: string } // ล้างเวลาออกงาน
  | { action: 'early_leave'; time: string; note?: string } // กดแจ้งกลับก่อนแทน
  | { action: 'clear_early_leave'; note?: string }
  | { action: 'set_status'; status: OverrideStatus; note?: string } // ลา / แก้สถานะย้อนหลัง
  | { action: 'clear_status'; note?: string } // กลับไปใช้ค่าที่คำนวณได้

export interface AuditEntry {
  id: string
  adminEmail: string
  label: string // ข้อความที่คนอ่านเข้าใจ เช่น 'แก้สถานะเป็น ลา'
  before: string | null
  after: string | null
  note: string
  createdAt: string // ISO
}

export interface ProjectSummary extends Project {
  memberCount: number
}

export interface ShiftEntry {
  weekday: number
  startTime: string
  endTime: string
}

/** กะทั้งหมดของหนึ่งคนในหนึ่งโปรเจก */
export interface Assignment {
  projectId: string
  projectName: string
  shifts: Shift[]
}

export interface EmployeeSchedule {
  employee: Employee
  assignments: Assignment[]
}

export interface ProjectDetail {
  project: Project
  members: { employee: Employee; shifts: Shift[] }[]
}

export interface Holiday {
  date: string
  name: string
}

export interface AppSettings {
  displayKey: string
  displayUrl: string
  qrTokenTtl: number
}

/** ผลการเขียนกะ ถ้ามีกะของโปรเจกอื่นที่เวลาทับกันจะถูกแทนที่ (ใครเขียนทีหลังชนะ) */
export interface ScheduleWriteResult {
  schedule: EmployeeSchedule
  replaced: { projectName: string; weekday: number; startTime: string; endTime: string }[]
}
