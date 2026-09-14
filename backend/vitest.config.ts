import { defineConfig } from 'vitest/config'

// test ใช้ฐานข้อมูลแยก (ถูกล้างทุกครั้งที่รัน) ตั้ง TEST_DATABASE_URL ถ้าไม่ใช่ค่าเริ่มต้นนี้
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://attendance:attendance@localhost:5433/attendance',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-000',
      GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-secret',
      APP_ORIGIN: 'https://attendance.test',
      ADMIN_EMAILS: 'Boss@Example.com',
      COOKIE_SECURE: 'true',
      DEV_LOGIN: 'true',
      QR_TOKEN_TTL_SECONDS: '30',
    },
  },
})
