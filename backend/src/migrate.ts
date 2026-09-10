// รัน migration ทั้งหมดใน ./drizzle แล้วสร้างแถว settings ถ้ายังไม่มี
// server.ts เรียกไฟล์นี้เองตอนเริ่ม จึงไม่ต้องรันแยกบน production

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './db/index.js'
import { ensureSettings } from './lib/settings.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve(here, '../drizzle') })
  await ensureSettings()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log('migration เรียบร้อย')
      return pool.end()
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
