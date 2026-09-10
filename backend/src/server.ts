import { buildApp } from './app.js'
import { config } from './config.js'
import { runMigrations } from './migrate.js'
import { pool } from './db/index.js'
import { purgeExpiredSessions } from './lib/sessions.js'

async function main() {
  await runMigrations()
  const app = await buildApp()

  // เก็บกวาด session ที่หมดอายุทุกชั่วโมง (ไม่มีผลกับการคำนวณสถานะ)
  const sweeper = setInterval(() => purgeExpiredSessions().catch((e) => app.log.warn(e)), 3600_000)

  const close = async () => {
    clearInterval(sweeper)
    await app.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)

  await app.listen({ port: config.port, host: config.host })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
