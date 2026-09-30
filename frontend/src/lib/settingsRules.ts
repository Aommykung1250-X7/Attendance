// กติกาค่าตั้งค่า ตรงกับ backend/src/services/settings.ts
// ใช้ตรวจในหน้าตั้งค่าก่อนส่ง และใน mock ให้ทำงานเหมือนของจริง ทุกฟังก์ชันคืนข้อความผิดพลาด หรือ null ถ้าถูก

export const INT_RULES = {
  qrTokenTtl: { min: 10, max: 300, label: 'รอบเปลี่ยน QR', unit: 'วินาที' },
  lateGraceMinutes: { min: 0, max: 120, label: 'อนุโลมเข้าสาย', unit: 'นาที' },
  checkinRadiusMeters: { min: 10, max: 10_000, label: 'รัศมีเช็กอิน', unit: 'เมตร' },
  maxLocationAccuracyMeters: { min: 1, max: 1_000, label: 'GPS คลาดเคลื่อนได้', unit: 'เมตร' },
} as const

export const COORD_RULES = {
  officeLatitude: { min: -90, max: 90, label: 'ละติจูดสำนักงาน' },
  officeLongitude: { min: -180, max: 180, label: 'ลองจิจูดสำนักงาน' },
} as const

/** ช่องว่างถือว่าไม่ได้กรอก (Number('') เป็น 0 จึงต้องกันเอง) */
const numberOf = (raw: string | number) => (typeof raw === 'number' ? raw : raw.trim() === '' ? Number.NaN : Number(raw))

export function intError(key: keyof typeof INT_RULES, raw: string | number) {
  const r = INT_RULES[key]
  const v = numberOf(raw)
  return Number.isInteger(v) && v >= r.min && v <= r.max ? null : `${r.label} ต้องเป็นจำนวนเต็ม ${r.min.toLocaleString()}–${r.max.toLocaleString()} ${r.unit}`
}

export function coordError(key: keyof typeof COORD_RULES, raw: string | number) {
  const r = COORD_RULES[key]
  const v = numberOf(raw)
  return Number.isFinite(v) && v >= r.min && v <= r.max ? null : `${r.label} ต้องเป็นตัวเลขระหว่าง ${r.min} ถึง ${r.max}`
}

/** ลิงก์ LINE OA ถูกแสดงเป็นปุ่มหลังเช็กเอาต์ ต้องเป็น https เท่านั้น ว่างได้ (ไม่แสดงปุ่มของ OA) */
export function lineOaUrlError(raw: string) {
  const s = raw.trim()
  if (!s) return null
  if (s.length > 500) return 'ลิงก์ LINE OA ยาวเกิน 500 ตัวอักษร'
  try {
    return new URL(s).protocol === 'https:' ? null : 'ลิงก์ LINE OA ต้องขึ้นต้นด้วย https://'
  } catch {
    return 'ลิงก์ LINE OA ต้องเป็น URL ที่ขึ้นต้นด้วย https://'
  }
}

/** ใช้ตอนแสดงลิงก์ที่มาจากข้อมูล: คืนเฉพาะ https ไม่งั้น null */
export function safeHttpsUrl(raw: string | null | undefined) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
