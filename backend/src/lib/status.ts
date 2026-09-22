// กฎการคำนวณสถานะ (spec หัวข้อ 7)
// คำนวณตอนอ่านเสมอ ไม่มีงานเบื้องหลังตอนกลางคืน ถ้าเซิร์ฟเวอร์ล่มข้ามคืนแล้วเปิดใหม่ ตัวเลขยังถูกเหมือนเดิม

import type { LeaveDuration, OverrideStatus, ShiftStatus } from '../contract.js'
import { zoned } from './time.js'

export interface StatusInput {
  date: string
  startTime: string
  endTime: string
  holiday: boolean
  /** ค่าล่าสุดจาก status_overrides (null = ไม่มี หรือถูกล้างแล้ว) */
  override: OverrideStatus | null
  scannedAt: Date | null
  isOffsite?: boolean
  leavePortion?: LeaveDuration | null
  lateGraceMinutes?: number
  now: Date
}

const OVERRIDE_TO_STATUS: Record<OverrideStatus, ShiftStatus> = {
  leave: 'leave',
  present: 'ontime',
  late: 'late',
  absent: 'absent',
  offsite: 'offsite',
}

/**
 * สายคือสแกนตั้งแต่ "เวลาเริ่มกะ + 1 นาทีเต็ม" เป็นต้นไป
 * กะ 09:00 → สแกน 09:00:59.999 ยังปกติ, 09:01:00.000 สาย
 */
export function isLate(scannedAt: Date, date: string, startTime: string, graceMinutes = 0): boolean {
  const cutoff = zoned(date, startTime).getTime() + (graceMinutes + 1) * 60_000
  return scannedAt.getTime() >= cutoff
}

export function overrideToStatus(o: OverrideStatus): ShiftStatus {
  return OVERRIDE_TO_STATUS[o]
}

/** คืน null เมื่อไม่นับ (วันหยุด) */
export function computeStatus(i: StatusInput): ShiftStatus | null {
  // 1. วันหยุด → ไม่นับ
  if (i.holiday) return null
  // 2. มี override → ใช้ค่านั้น
  if (i.override) return OVERRIDE_TO_STATUS[i.override]
  // 3. ลาเต็มวัน
  if (i.leavePortion === 'full_day') return 'leave'
  if (i.leavePortion === 'morning' && i.endTime <= '13:00') return 'leave'
  if (i.leavePortion === 'afternoon' && i.startTime >= '13:00') return 'leave'
  // 4. ทำงานนอกสถานที่
  if (i.isOffsite) return 'offsite'
  // 5. ลาครึ่งเช้า: ก่อน 13:00 ให้จอแสดงลา หลังจากนั้นต้องเช็กอิน
  const effectiveStart = i.leavePortion === 'morning' ? '13:00' : i.startTime
  if (i.leavePortion === 'morning' && i.now.getTime() < zoned(i.date, '13:00').getTime()) return 'leave'
  // 6. มีการสแกน → ปกติ / สาย
  if (i.scannedAt) return isLate(i.scannedAt, i.date, effectiveStart, i.lateGraceMinutes ?? 0) ? 'late' : 'ontime'
  // 7. ไม่มีการสแกน → ยังไม่มา / ขาด
  const end = zoned(i.date, i.endTime).getTime()
  return i.now.getTime() < end ? 'pending' : 'absent'
}
