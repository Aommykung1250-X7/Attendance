// ข้อมูลตัวอย่างสำหรับลองระบบบนเครื่องตัวเอง (อีเมลสมมติทั้งหมด)
// ห้ามรันบน production: pnpm db:seed

import { config } from './config.js'
import { db, pool, schema } from './db/index.js'
import { runMigrations } from './migrate.js'
import { applyAssignment, loadCurrentShifts, reconcile } from './lib/schedule.js'
import { localParts } from './lib/time.js'

if (config.isProduction) {
  console.error('ห้ามรัน seed บน production')
  process.exit(1)
}

const people: { nickname: string; gen: string | null; type: 'staff' | 'student'; project: string; days: number[]; r1: [string, string]; r2?: [string, string] }[] = [
  { nickname: 'ต้น', gen: null, type: 'staff', project: 'TurnPRO', days: [1, 2, 3, 4, 5], r1: ['09:00', '18:00'] },
  { nickname: 'แนน', gen: null, type: 'staff', project: 'TurnPRO', days: [1, 2, 3, 4, 5], r1: ['09:30', '18:00'] },
  { nickname: 'บีม', gen: null, type: 'staff', project: 'TurnPRO', days: [1, 2, 3, 4, 5], r1: ['09:30', '17:30'] },
  { nickname: 'ยูริ', gen: 'Gen 7', type: 'student', project: 'LU-Phuket', days: [1, 3, 5], r1: ['09:30', '12:00'], r2: ['16:30', '19:00'] },
  { nickname: 'ยูริ', gen: 'Gen 8', type: 'student', project: 'LU-Phuket', days: [2, 4], r1: ['13:00', '17:00'] },
  { nickname: 'มิว', gen: 'Gen 8', type: 'student', project: 'LU-Phuket', days: [1, 2, 3, 4, 5], r1: ['09:30', '12:00'] },
  { nickname: 'ฟ้า', gen: 'Gen 7', type: 'student', project: 'Mobile App', days: [1, 2, 3, 4, 5, 6, 7], r1: ['10:00', '15:00'] },
]

async function main() {
  await runMigrations()
  const projects = new Map<string, string>()
  for (const [name, s, e] of [
    ['TurnPRO', '09:00', '18:00'],
    ['LU-Phuket', '09:30', '12:00'],
    ['Mobile App', '10:00', '15:00'],
  ]) {
    const [p] = await db
      .insert(schema.projects)
      .values({ name, defaultStart: s, defaultEnd: e })
      .onConflictDoUpdate({ target: schema.projects.name, set: { defaultStart: s } })
      .returning()
    projects.set(name, p.id)
  }
  const today = localParts(new Date()).date
  for (const [i, p] of people.entries()) {
    const email = `demo${i + 1}@example.com`
    const [e] = await db
      .insert(schema.employees)
      .values({ nickname: p.nickname, gen: p.gen, email, type: p.type })
      .onConflictDoUpdate({ target: schema.employees.email, set: { nickname: p.nickname } })
      .returning()
    const entries = p.days.flatMap((d) => [
      { weekday: d, startTime: p.r1[0], endTime: p.r1[1] },
      ...(p.r2 ? [{ weekday: d, startTime: p.r2[0], endTime: p.r2[1] }] : []),
    ])
    await db.transaction(async (tx) => {
      const current = await loadCurrentShifts(tx, [e.id])
      const { next } = applyAssignment(current, e.id, projects.get(p.project)!, entries)
      await reconcile(tx, current, next, today)
    })
    console.log(`${p.nickname}${p.gen ? ` (${p.gen})` : ''} → ${email}`)
  }
  console.log('\nเสร็จแล้ว ล็อกอินเป็นพนักงานตัวอย่างได้ที่ /api/auth/dev-login?email=demo1@example.com (ต้องตั้ง DEV_LOGIN=true)')
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
