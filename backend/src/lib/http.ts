// ข้อผิดพลาดที่ส่งกลับไปให้หน้าเว็บ ข้อความเป็นภาษาคน ไม่ใช่ error code

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(400, message, 'bad_request', extra)
export const notFound = (message = 'ไม่พบข้อมูล') => new HttpError(404, message, 'not_found')
export const conflict = (message: string, extra?: Record<string, unknown>) => new HttpError(409, message, 'conflict', extra)

type Body = Record<string, unknown>

export function asBody(v: unknown): Body {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : {}
}

export function reqString(b: Body, key: string, label: string, max = 200): string {
  const v = b[key]
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`กรอก${label}`)
  if (v.trim().length > max) throw badRequest(`${label}ยาวเกิน ${max} ตัวอักษร`)
  return v.trim()
}

export function optString(b: Body, key: string, max = 500): string | undefined {
  const v = b[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw badRequest(`ค่า ${key} ไม่ถูกต้อง`)
  if (v.trim().length > max) throw badRequest(`ข้อความยาวเกิน ${max} ตัวอักษร`)
  return v.trim()
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase()
}
