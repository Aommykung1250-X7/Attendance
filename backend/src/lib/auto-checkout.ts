import type { AutoCheckoutMode } from '../contract.js'
import { zoned } from './time.js'

const FIVE_MINUTES_MS = 5 * 60_000

/** เวลาที่ระบบเริ่มปิดกะอัตโนมัติ โดยคิดตามเวลาไทย */
export function autoCheckoutDueAt(date: string, endTime: string, mode: AutoCheckoutMode): Date {
  if (mode === 'end_of_day') return zoned(date, '23:59')
  return new Date(zoned(date, endTime).getTime() + FIVE_MINUTES_MS)
}
