// กฎการคำนวณสถานะ (spec หัวข้อ 7)
// คำนวณตอนอ่านเสมอ ไม่มีงานเบื้องหลังตอนกลางคืน ถ้าเซิร์ฟเวอร์ล่มข้ามคืนแล้วเปิดใหม่ ตัวเลขยังถูกเหมือนเดิม

import type { OverrideStatus, ShiftStatus } from '../contract.js'
import { zoned } from './time.js'

export interface StatusInput {
  date: string
  startTime: string
  endTime: string
  holiday: boolean
  /** ค่าล่าสุดจาก status_overrides (null = ไม่มี หรือถูกล้างแล้ว) */
  override: OverrideStatus | null
  scannedAt: Date | null
  now: Date
}

const OVERRIDE_TO_STATUS: Record<OverrideStatus, ShiftStatus> = {
  leave: 'leave',
  present: 'ontime',
  late: 'late',
  absent: 'absent',
}

/**
 * สายคือสแกนตั้งแต่ "เวลาเริ่มกะ + 1 นาทีเต็ม" เป็นต้นไป
 * กะ 09:00 → สแกน 09:00:59.999 ยังปกติ, 09:01:00.000 สาย
 */
export function isLate(scannedAt: Date, date: string, startTime: string): boolean {
  const cutoff = zoned(date, startTime).getTime() + 60_000
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
  // 3. มีการสแกน → ปกติ / สาย
  if (i.scannedAt) return isLate(i.scannedAt, i.date, i.startTime) ? 'late' : 'ontime'
  // 4. ไม่มีการสแกน → ยังไม่มา / ขาด
  const end = zoned(i.date, i.endTime).getTime()
  return i.now.getTime() < end ? 'pending' : 'absent'
}
