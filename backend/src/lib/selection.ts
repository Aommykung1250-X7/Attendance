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
  /** ค่าล่าสุดที่แอดมินแก้ไว้ */
  override: OverrideStatus | null
}

export type Selection =
  | { kind: 'no_shift_today' }
  | { kind: 'early_leave'; shiftId: string; minutesRemaining: number }
  | { kind: 'too_early'; previousEndTime: string }
  | { kind: 'ready'; shiftId: string }
  | { kind: 'all_done' }

/**
 * @param shifts กะทั้งหมดของวันนี้ของคนนี้
 * @param nowTime เวลาอ้างอิง 'HH:MM:SS' (เวลาที่สแกน ตามเวลาของเซิร์ฟเวอร์)
 */
export function selectShift(shifts: SelShift[], nowTime: string): Selection {
  const [h, m, s = 0] = nowTime.split(':').map(Number)
  const now = h * 3600 + m * 60 + s
  const endSec = (x: SelShift) => minutesOf(x.endTime) * 60
  const sorted = [...shifts].sort(
    (a, b) => minutesOf(a.startTime) - minutesOf(b.startTime) || minutesOf(a.endTime) - minutesOf(b.endTime),
  )

  // 1. ไม่มีกะเลยในวันนี้
  if (sorted.length === 0) return { kind: 'no_shift_today' }

  // 2. มีกะที่เช็กเข้าแล้ว ยังไม่ถึงเวลาสิ้นสุด และยังไม่ได้แจ้งกลับก่อน → หน้าแจ้งกลับก่อนเวลา
  //    (ถ้าแอดมินแก้เป็นลาหรือขาดไว้แล้ว ถือว่ากะนั้นจบ)
  const working = sorted.find(
    (x) => x.attended && !x.earlyLeft && x.override !== 'leave' && x.override !== 'absent' && now < endSec(x),
  )
  if (working) {
    return { kind: 'early_leave', shiftId: working.shiftId, minutesRemaining: Math.ceil((endSec(working) - now) / 60) }
  }

  // 3. มีกะที่ยังไม่เช็กเข้า → เอากะแรกสุด
  //    กะที่เลยเวลาสิ้นสุดไปแล้วโดยไม่ได้สแกนคือ "ขาด" ไม่ใช่กะที่ยังเช็กเข้าได้ จึงข้ามไป
  const idx = sorted.findIndex((x) => !x.attended && !x.override && now < endSec(x))
  if (idx >= 0) {
    const prev = idx > 0 ? sorted[idx - 1] : null
    // กะถัดไปจะเช็กเข้าได้ก็ต่อเมื่อเลยเวลาสิ้นสุดของกะก่อนหน้าไปแล้ว
    // กันคนสแกนรวดตอนเช้าเพื่อปิดทั้งวัน คนที่มาเช้าจริงไม่ได้รับผลกระทบ
    if (prev && now < endSec(prev)) return { kind: 'too_early', previousEndTime: prev.endTime }
    return { kind: 'ready', shiftId: sorted[idx].shiftId }
  }

  // 4. ทุกกะถูกจัดการหมดแล้ว
  return { kind: 'all_done' }
}
