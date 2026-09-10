import 'dotenv/config'

// ค่าทั้งหมดมาจาก env ที่เดียว ไม่มีพอร์ตหรืออีเมลไหน hardcode ในโค้ด

function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`ต้องตั้งค่า ${name} ใน .env`)
  return v
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  if (!v) return fallback
  return ['1', 'true', 'yes', 'on'].includes(v)
}

const nodeEnv = optional('NODE_ENV', 'development')
const appOrigin = required('APP_ORIGIN').replace(/\/+$/, '')

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(optional('PORT', '5292')),
  host: optional('HOST', '127.0.0.1'),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  appOrigin,
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional('GOOGLE_REDIRECT_URI', `${appOrigin}/api/auth/google/callback`),
  },
  /** อีเมลแอดมิน คั่นด้วย comma เทียบแบบไม่สนตัวพิมพ์ */
  adminEmails: new Set(
    optional('ADMIN_EMAILS', '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
  /** ค่าเริ่มต้นตอนสร้างแถว settings ครั้งแรก หลังจากนั้นแก้ในหน้าตั้งค่า */
  defaultQrTtl: Number(optional('QR_TOKEN_TTL_SECONDS', '30')),
  /** ปิดได้เฉพาะตอนพัฒนาบน http://localhost เท่านั้น */
  cookieSecure: bool('COOKIE_SECURE', true),
  /**
   * ทางลัดล็อกอินโดยไม่ผ่าน Google สำหรับทดสอบบนเครื่องตัวเอง
   * ทำงานเฉพาะเมื่อ DEV_LOGIN=true และ NODE_ENV ไม่ใช่ production
   */
  devLogin: bool('DEV_LOGIN', false) && nodeEnv !== 'production',
  timezone: 'Asia/Bangkok',
}

if (config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร สร้างด้วย: openssl rand -hex 32')
}
if (config.isProduction && !config.cookieSecure) {
  throw new Error('ห้ามปิด COOKIE_SECURE ใน production')
}
if (config.adminEmails.size === 0) {
  console.warn('[config] ADMIN_EMAILS ว่าง จะไม่มีใครเข้าหน้าแอดมินได้')
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && config.adminEmails.has(email.toLowerCase())
}
