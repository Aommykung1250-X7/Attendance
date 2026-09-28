import { buildApp } from './app.js'
import { config } from './config.js'
import { runMigrations } from './migrate.js'
import { pool } from './db/index.js'
import { purgeExpiredSessions } from './lib/sessions.js'
import { reconcileAutoCheckouts } from './services/auto-checkout.js'

async function main() {
  await runMigrations()
  const app = await buildApp()

  await reconcileAutoCheckouts().catch((e) => app.log.warn(e, 'auto-checkout startup reconciliation failed'))

  // เก็บกวาด session ที่หมดอายุทุกชั่วโมง (ไม่มีผลกับการคำนวณสถานะ)
  const sweeper = setInterval(() => purgeExpiredSessions().catch((e) => app.log.warn(e)), 3600_000)
  const autoCheckout = setInterval(
    () => reconcileAutoCheckouts().catch((e) => app.log.warn(e, 'auto-checkout failed')),
    60_000,
  )

  const close = async () => {
    clearInterval(sweeper)
    clearInterval(autoCheckout)
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
