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
  email: string
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
  status: ShiftStatus
  recordedBy: 'self' | 'admin' | null
  adminNote: string | null
}

export interface KioskBoard {
  serverTime: string // ISO
  dateLabel: string
  qrToken: string
  tokenExpiresIn: number // วินาที
  summary: { expected: number; arrived: number; late: number; pending: number; leave: number; absent: number }
  groups: { startTime: string; label: string; rows: ShiftInstance[] }[]
}

/** สิ่งที่หน้าเช็กชื่อบนมือถือได้รับกลับมา ตรงกับ spec หัวข้อ 8 */
export type CheckInView =
  | { kind: 'expired' }
  | { kind: 'not_registered'; email: string }
  | { kind: 'no_shift_today'; nickname: string }
  | { kind: 'all_done'; nickname: string }
  | { kind: 'too_early'; nickname: string; previousEndTime: string }
  | { kind: 'ready'; nickname: string; shift: ShiftInstance; scannedAt: string }
  | { kind: 'early_leave'; nickname: string; shift: ShiftInstance; minutesRemaining: number }
  | { kind: 'done'; nickname: string; shift: ShiftInstance; status: ShiftStatus }
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
  newEmployees: { nickname: string; email: string; projectName: string }[]
  newAssignments: { nickname: string; projectName: string }[]
  changedShifts: { nickname: string; projectName: string; before: string; after: string }[]
}
