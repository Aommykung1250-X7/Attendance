// QR token ที่หมุนตามช่วงเวลา ไม่ต้องเก็บลงฐานข้อมูล
//
// token = <เลขช่วงเวลา>.<ลายเซ็น HMAC>
// ช่วงเวลา = floor(วินาทีปัจจุบัน / ttl) ดังนั้น QR บนจอเปลี่ยนทุก ttl วินาที
// ยอมรับ token ของช่วงปัจจุบันและช่วงก่อนหน้า เพราะจอดึงข้อมูลใหม่ทุก 8 วินาที
// คนที่สแกนตอนรหัสเพิ่งเปลี่ยนจึงไม่โดนปฏิเสธ (อายุจริงอยู่ระหว่าง ttl ถึง 2×ttl)
//
// ลายเซ็นผูกกับ displayKey ด้วย กดสร้างรหัสหน้าจอใหม่เมื่อไหร่ token เก่าใช้ไม่ได้ทันที

import { createHmac, timingSafeEqual } from 'node:crypto'

function sign(secret: string, displayKey: string, ttl: number, bucket: number): string {
  return createHmac('sha256', secret).update(`qr|${displayKey}|${ttl}|${bucket}`).digest('base64url').slice(0, 22)
}

export function issueQrToken(secret: string, displayKey: string, ttl: number, nowMs: number) {
  const bucket = Math.floor(nowMs / 1000 / ttl)
  const token = `${bucket.toString(36)}.${sign(secret, displayKey, ttl, bucket)}`
  const expiresIn = Math.max(1, Math.ceil((bucket + 1) * ttl - nowMs / 1000))
  return { token, bucket, expiresIn }
}

export function verifyQrToken(secret: string, displayKey: string, ttl: number, token: string, nowMs: number): boolean {
  if (typeof token !== 'string' || token.length > 64) return false
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token)
  if (!m) return false
  const bucket = parseInt(m[1], 36)
  const current = Math.floor(nowMs / 1000 / ttl)
  if (bucket !== current && bucket !== current - 1) return false
  const expected = Buffer.from(sign(secret, displayKey, ttl, bucket))
  const got = Buffer.from(m[2])
  return expected.length === got.length && timingSafeEqual(expected, got)
}
