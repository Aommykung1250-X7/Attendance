// การเลือกกะตอนสแกน (spec หัวข้อ 8 "การเลือกกะ")
// ฟังก์ชันล้วน ไม่แตะฐานข้อมูล จะได้ทดสอบทุกกรณีได้ง่าย

import type { OverrideStatus } from '../contract.js'
import { minutesOf } from './time.js'

export interface SelShift {
  shiftId: string
  startTime: string
  endTime: string
  /** มีแถวใน attendance แล้ว */
  attended: boolean
  /** แจ้งกลับก่อนเวลาแล้ว (กะนั้นถือว่าจบ) */
  earlyLeft: boolean
  /** เช็กชื่อออกงานแล้ว (กะนั้นถือว่าจบ) */
  checkedOut?: boolean
  /** ค่าล่าสุดที่แอดมินแก้ไว้ */
  override: OverrideStatus | null
}

export const EARLY_WINDOW_MINUTES = 30

function timeMinusMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.max(0, h * 60 + m - mins)
  const rh = Math.floor(total / 60)
  const rm = total % 60
  return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`
}

export type Selection =
  | { kind: 'no_shift_today' }
  | { kind: 'early_leave'; shiftId: string; minutesRemaining: number }
  | { kind: 'ready_checkout'; shiftId: string }
  | { kind: 'too_early'; previousEndTime: string }
  | { kind: 'too_early_for_shift'; shiftId: string; startTime: string; availableFrom: string }
  | { kind: 'ready'; shiftId: string; isUpdate?: boolean }
  | { kind: 'all_done' }

/**
 * @param shifts กะทั้งหมดของวันนี้ของคนนี้
 * @param nowTime เวลาอ้างอิง 'HH:MM:SS' (เวลาที่สแกน ตามเวลาของเซิร์ฟเวอร์)
 */
export function selectShift(shifts: SelShift[], nowTime: string): Selection {
  const [h, m, s = 0] = nowTime.split(':').map(Number)
  const now = h * 3600 + m * 60 + s
  const endSec = (x: SelShift) => minutesOf(x.endTime) * 60
  const startSec = (x: SelShift) => minutesOf(x.startTime) * 60
  const sorted = [...shifts].sort(
    (a, b) => minutesOf(a.startTime) - minutesOf(b.startTime) || minutesOf(a.endTime) - minutesOf(b.endTime),
  )

  // 1. ไม่มีกะเลยในวันนี้
  if (sorted.length === 0) return { kind: 'no_shift_today' }

  // 2. มีกะที่เช็กเข้าแล้ว ยังไม่แจ้งกลับก่อน และยังไม่เช็กออก
  //    (ถ้าแอดมินแก้เป็นลาหรือขาดไว้แล้ว ถือว่ากะนั้นจบ)
  const working = sorted.find(
    (x) => x.attended && !x.earlyLeft && !x.checkedOut && x.override !== 'leave' && x.override !== 'absent',
  )
  if (working) {
    // 2.0 สแกนก่อนหรือตรงเวลาเริ่มกะ (เช่น สแกนเข้าล่วงหน้า แล้วมาสแกนซ้ำก่อนเวลางานเริ่ม)
    // ถือว่าเป็นการอัปเดตเวลาเข้างาน ไม่ใช่การแจ้งกลับก่อนเวลา!
    if (now <= startSec(working)) {
      return { kind: 'ready', shiftId: working.shiftId, isUpdate: true }
    }
    // 2.1 สแกนก่อนเวลาสิ้นสุดกะ (เช่น เลิก 18:00 สแกน 17:59:59) → หน้าแจ้งกลับก่อนเวลา
    if (now < endSec(working)) {
      return { kind: 'early_leave', shiftId: working.shiftId, minutesRemaining: Math.ceil((endSec(working) - now) / 60) }
    }
    // 2.2 สแกนตั้งแต่เวลาสิ้นสุดกะเป็นต้นไป (เช่น 18:00:00 หรือ 18:00:01) → หน้าเช็กชื่อออกงาน
    return { kind: 'ready_checkout', shiftId: working.shiftId }
  }

  // 3. มีกะที่ยังไม่เช็กเข้า → เอากะแรกสุด
  //    กะที่เลยเวลาสิ้นสุดไปแล้วโดยไม่ได้สแกนคือ "ขาด" ไม่ใช่กะที่ยังเช็กเข้าได้ จึงข้ามไป
  const idx = sorted.findIndex((x) => !x.attended && !x.override && now < endSec(x))
  if (idx >= 0) {
    const shift = sorted[idx]
    const prev = idx > 0 ? sorted[idx - 1] : null
    // กะถัดไปจะเช็กเข้าได้ก็ต่อเมื่อเลยเวลาสิ้นสุดของกะก่อนหน้าไปแล้ว
    // กันคนสแกนรวดตอนเช้าเพื่อปิดทั้งวัน คนที่มาเช้าจริงไม่ได้รับผลกระทบ
    if (prev && now < endSec(prev)) return { kind: 'too_early', previousEndTime: prev.endTime }

    // เปิดให้เช็กชื่อเข้างานล่วงหน้าได้ไม่เกิน EARLY_WINDOW_MINUTES (30 นาที)
    const windowStartSec = startSec(shift) - EARLY_WINDOW_MINUTES * 60
    if (now < windowStartSec) {
      return {
        kind: 'too_early_for_shift',
        shiftId: shift.shiftId,
        startTime: shift.startTime,
        availableFrom: timeMinusMinutes(shift.startTime, EARLY_WINDOW_MINUTES),
      }
    }

    return { kind: 'ready', shiftId: shift.shiftId }
  }

  // 4. ทุกกะถูกจัดการหมดแล้ว
  return { kind: 'all_done' }
}
