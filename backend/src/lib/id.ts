import { createHash, randomBytes } from 'node:crypto'

/** id สั้นที่เรียงตามเวลาได้คร่าวๆ ไม่ต้องพึ่งแพ็กเกจเพิ่ม */
export function createId(): string {
  return Date.now().toString(36) + randomBytes(8).toString('hex')
}

/** รหัสสุ่มสำหรับ cookie และ URL หน้าจอ */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
