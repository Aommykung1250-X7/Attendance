// ทดสอบทั้งระบบกับ Postgres จริง ผ่าน HTTP (app.inject) ตั้งเวลาเครื่องปลอมเพื่อทดสอบเกณฑ์เวลา

import ExcelJS from 'exceljs'
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://attendance.test'
let app: FastifyInstance

// ---- cookie jar แบบง่าย -------------------------------------------------------
class Client {
  jar = new Map<string, string>()
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const isForm = body instanceof FormPayload
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method !== 'GET' ? { origin: ORIGIN } : {}),
        ...(isForm ? { 'content-type': `multipart/form-data; boundary=${FormPayload.boundary}` } : {}),
        ...headers,
      },
      payload: isForm ? (body as FormPayload).buf : (body as object | undefined),
    })
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) this.jar.delete(c.name)
      else this.jar.set(c.name, c.value)
    }
    return res
  }
  get = (url: string) => this.req('GET', url)
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {})
  json = async (method: string, url: string, body?: unknown) => {
    const r = await this.req(method, url, body)
    return { status: r.statusCode, body: r.json() }
  }
  async login(email: string) {
    const r = await this.get(`/api/auth/dev-login?email=${encodeURIComponent(email)}`)
    expect(r.statusCode).toBe(302)
  }
}

class FormPayload {
  static boundary = '----attendance-test'
  buf: Buffer
  constructor(file: Buffer, name = 'schedule.xlsx') {
    const head = `--${FormPayload.boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    this.buf = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${FormPayload.boundary}--\r\n`)])
  }
}

// ---- เวลา --------------------------------------------------------------------
// วันศุกร์ที่ 11 กันยายน 2026
const at = (t: string) => vi.setSystemTime(new Date(`2026-09-11T${t}+07:00`))

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('s')
  rows.forEach((r) => ws.addRow(r))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

async function multiSheetXlsx(sheets: { name: string; rows: unknown[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    s.rows.forEach((r) => ws.addRow(r))
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
const HEAD = ['ชื่อเล่น', 'Gen', 'อีเมล', 'โปรเจก', 'ประเภท', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา', 'เวลาเข้ารอบ 1', 'เวลาออกรอบ 1', 'เวลาเข้ารอบ 2', 'เวลาออกรอบ 2', 'หมายเหตุ']

const admin = new Client()
let displayKey = ''
let turnpro = ''
let lu = ''
const ids: Record<string, string> = {}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at('07:00:00')
  const { db, pool } = await import('../src/db/index.js')
  await db.execute(sql`drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;`)
  const { runMigrations } = await import('../src/migrate.js')
  await runMigrations()
  const { buildApp } = await import('../src/app.js')
  app = await buildApp({ logger: false })
  afterAll(async () => {
    await app.close()
    await pool.end()
    vi.useRealTimers()
  })
})

describe('ตั้งค่าเริ่มต้นโดยแอดมิน', () => {
  it('คนที่ไม่ใช่แอดมินเข้า API แอดมินไม่ได้', async () => {
    const anon = new Client()
    expect((await anon.get('/api/employees')).statusCode).toBe(401)
    await anon.login('someone@gmail.com')
    expect((await anon.get('/api/employees')).statusCode).toBe(403)
  })

  it('แอดมินจาก ADMIN_EMAILS (ไม่สนตัวพิมพ์) สร้างโปรเจกและพนักงานได้', async () => {
    await admin.login('boss@example.com')
    const me = await admin.json('GET', '/api/me')
    expect(me.body).toMatchObject({ email: 'boss@example.com', isAdmin: true, employee: null })

    turnpro = (await admin.json('POST', '/api/projects', { name: 'TurnPRO', defaultStart: '09:00', defaultEnd: '18:00' })).body.id
    lu = (await admin.json('POST', '/api/projects', { name: 'LU-Phuket', defaultStart: '09:30', defaultEnd: '12:00' })).body.id
    expect(turnpro && lu).toBeTruthy()

    const a = await admin.json('POST', '/api/employees', { nickname: 'ต้น', gen: '', email: 'Ton@Gmail.com', type: 'staff', position: 'Dev' })
    expect(a.status).toBe(200)
    expect(a.body.email).toBe('ton@gmail.com')
    ids.ton = a.body.id
    const b = await admin.json('POST', '/api/employees', { nickname: 'ยูริ', gen: 'Gen 7', email: 'yuri7@gmail.com', type: 'student' })
    ids.yuri = b.body.id
    const dup = await admin.json('POST', '/api/employees', { nickname: 'x', email: 'ton@gmail.com', type: 'staff' })
    expect(dup.status).toBe(409)
    // เว้นอีเมลว่างได้ ไว้มากรอกทีหลัง คนแบบนี้ยังล็อกอินเช็กชื่อเองไม่ได้
    const noMail = await admin.json('POST', '/api/employees', { nickname: 'ไข่', gen: 'Gen 9', email: '', type: 'student' })
    expect(noMail.status).toBe(200)
    expect(noMail.body.email).toBe(null)
    expect((await admin.json('PATCH', `/api/employees/${noMail.body.id}`, { email: 'ไม่ใช่อีเมล' })).status).toBe(400)

    const wk = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startTime: '09:00', endTime: '18:00' }))
    expect((await admin.json('POST', `/api/projects/${turnpro}/assign`, { employeeId: ids.ton, shifts: wk })).status).toBe(200)
    const two = [5].flatMap((d) => [
      { weekday: d, startTime: '09:30', endTime: '12:00' },
      { weekday: d, startTime: '17:00', endTime: '20:00' },
    ])
    const r = await admin.json('PUT', `/api/employees/${ids.yuri}/schedule/${lu}`, { shifts: two })
    expect(r.body.schedule.assignments[0].shifts).toHaveLength(2)

    displayKey = (await admin.json('GET', '/api/settings')).body.displayKey
    expect(displayKey.length).toBeGreaterThan(20)
  })
})

describe('จอในออฟฟิศ', () => {
  it('รหัสผิด → 404', async () => {
    expect((await new Client().get('/api/board/wrong')).statusCode).toBe(404)
  })
  it('แสดงสรุป กะที่กำลังดำเนินและกะถัดไป พร้อม QR', async () => {
    at('09:10:00')
    const b = (await new Client().json('GET', `/api/board/${displayKey}`)).body
    expect(b.summary).toEqual({ expected: 3, arrived: 0, late: 0, pending: 3, leave: 0, absent: 0 })
    expect(b.groups.map((g: { label: string }) => g.label)).toEqual(['เข้า 09:00', 'ถัดไป 09:30'])
    expect(b.qrToken).toMatch(/\./)
    expect(b.dateLabel).toContain('11 กันยายน')
  })
})

async function tokenAt(t: string) {
  at(t)
  return (await new Client().json('GET', `/api/board/${displayKey}`)).body.qrToken as string
}

describe('เช็กชื่อ: เวลาที่บันทึกคือเวลาที่สแกน ไม่ใช่เวลาที่ล็อกอินเสร็จ', () => {
  const ton = new Client()
  let token = ''

  it('สแกนตอน 08:59:50 ยังไม่ล็อกอิน → 401 พร้อมลิงก์ไป Google และได้ cookie การสแกน', async () => {
    token = await tokenAt('08:59:50')
    const r = await ton.get(`/api/checkin?token=${token}`)
    expect(r.statusCode).toBe(401)
    expect(r.json().loginUrl).toContain('/api/auth/google?next=')
    expect(ton.jar.has('att_scan')).toBe(true)
    const setCookie = String(r.headers['set-cookie'])
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).not.toContain('ton@gmail.com')
  })

  it('กลับจาก Google ตอน 09:01:30 แล้วกดยืนยัน → บันทึก 08:59:50 สถานะปกติ', async () => {
    at('09:01:30')
    await ton.login('ton@gmail.com')
    const v = (await ton.json('GET', `/api/checkin?token=${token}`)).body
    expect(v).toMatchObject({ kind: 'ready', nickname: 'ต้น', scannedAt: '08:59:50' })
    const done = (await ton.json('POST', '/api/checkin', { token })).body
    expect(done).toMatchObject({ kind: 'done', status: 'ontime' })
    expect(done.shift.scannedAt).toBe('08:59:50')
  })

  it('คำขอที่ไม่ได้มาจากหน้าเว็บของระบบถูกปฏิเสธ', async () => {
    const r = await ton.req('POST', '/api/checkin', { token }, { origin: 'https://evil.example' })
    expect(r.statusCode).toBe(403)
  })

  it('QR เก่าเกินอายุ → หมดอายุ', async () => {
    at('09:03:00')
    expect((await ton.json('GET', `/api/checkin?token=${token}`)).body).toEqual({ kind: 'expired' })
  })

  it('สแกนซ้ำระหว่างกะ → หน้าแจ้งกลับก่อนเวลา แล้วยืนยัน กะนั้นถือว่าจบ', async () => {
    const t = await tokenAt('15:00:00')
    const v = (await ton.json('GET', `/api/checkin?token=${t}`)).body
    expect(v).toMatchObject({ kind: 'early_leave', minutesRemaining: 180 })
    const d = (await ton.json('POST', '/api/checkin/early-leave', { token: t })).body
    expect(d.kind).toBe('early_leave_done')
    expect(d.shift.earlyLeaveAt).toBe('15:00:00')
    const t2 = await tokenAt('15:05:00')
    expect((await ton.json('GET', `/api/checkin?token=${t2}`)).body).toMatchObject({ kind: 'all_done' })
  })

  it('บัญชี Google ที่ไม่อยู่ในรายชื่อ → not_registered ไม่สร้างผู้ใช้ใหม่', async () => {
    const stranger = new Client()
    await stranger.login('stranger@gmail.com')
    const t = await tokenAt('15:06:00')
    expect((await stranger.json('GET', `/api/checkin?token=${t}`)).body).toEqual({
      kind: 'not_registered',
      email: 'stranger@gmail.com',
    })
    const emps = (await admin.json('GET', '/api/employees?inactive=1')).body
    expect(emps.find((e: { email: string }) => e.email === 'stranger@gmail.com')).toBeUndefined()
  })
})

describe('นักศึกษาที่มาสองรอบต่อวัน', () => {
  const yuri = new Client()
  it('รอบเช้าสาย, รอบเย็นกลับมาสแกนแล้วเช็กเข้ากะเย็น ไม่ใช่หน้าแจ้งกลับ', async () => {
    await yuri.login('yuri7@gmail.com')
    let t = await tokenAt('09:31:00')
    expect((await yuri.json('POST', '/api/checkin', { token: t })).body).toMatchObject({ kind: 'done', status: 'late' })

    t = await tokenAt('10:00:00')
    expect((await yuri.json('GET', `/api/checkin?token=${t}`)).body.kind).toBe('early_leave')

    t = await tokenAt('16:55:00')
    const v = (await yuri.json('GET', `/api/checkin?token=${t}`)).body
    expect(v.kind).toBe('ready')
    expect(v.shift.startTime).toBe('17:00')
  })
})

describe('บันทึกประจำวันของแอดมิน', () => {
  it('กดลา แล้วล้าง มีประวัติว่าใครกด ค่าเดิมคืออะไร', async () => {
    at('16:58:00')
    const day = (await admin.json('GET', '/api/admin/day?date=2026-09-11')).body
    expect(day.rows).toHaveLength(3)
    const evening = day.rows.find((r: { startTime: string }) => r.startTime === '17:00')
    expect(evening.status).toBe('pending')

    const leave = await admin.json('POST', '/api/admin/attendance', {
      shiftId: evening.shiftId,
      date: '2026-09-11',
      action: 'set_status',
      status: 'leave',
      note: 'โทรมาลา',
    })
    expect(leave.body).toMatchObject({ status: 'leave', overridden: true, adminNote: 'โทรมาลา', historyCount: 1 })

    const hist = (await admin.json('GET', `/api/admin/attendance/history?shiftId=${evening.shiftId}&date=2026-09-11`)).body
    expect(hist[0]).toMatchObject({ adminEmail: 'boss@example.com', label: 'แก้สถานะเป็น ลา', before: 'ยังไม่มา', note: 'โทรมาลา' })

    const cleared = (await admin.json('POST', '/api/admin/attendance', { shiftId: evening.shiftId, date: '2026-09-11', action: 'clear_status' })).body
    expect(cleared.status).toBe('pending')
  })

  it('กดเช็กชื่อแทนย้อนหลัง ใส่เวลาที่มาจริงได้ และแยกว่าแอดมินเป็นคนกด', async () => {
    const day = (await admin.json('GET', '/api/admin/day?date=2026-09-11')).body
    const evening = day.rows.find((r: { startTime: string }) => r.startTime === '17:00')
    const future = await admin.json('POST', '/api/admin/attendance', { shiftId: evening.shiftId, date: '2026-09-11', action: 'checkin', time: '17:30' })
    expect(future.status).toBe(400) // อนาคต
    at('17:40:00')
    const ok = (await admin.json('POST', '/api/admin/attendance', { shiftId: evening.shiftId, date: '2026-09-11', action: 'checkin', time: '17:00' })).body
    expect(ok).toMatchObject({ status: 'ontime', recordedBy: 'admin', scannedAt: '17:00:00' })
  })

  it('ของที่พนักงานสแกนเองลบไม่ได้', async () => {
    const day = (await admin.json('GET', '/api/admin/day?date=2026-09-11')).body
    const tonRow = day.rows.find((r: { nickname: string }) => r.nickname === 'ต้น')
    const r = await admin.json('POST', '/api/admin/attendance', { shiftId: tonRow.shiftId, date: '2026-09-11', action: 'undo_checkin' })
    expect(r.status).toBe(400)
  })
})

describe('รายงานรายเดือน', () => {
  it('นับวันมา สาย กลับก่อน และดูรายวันได้', async () => {
    at('21:00:00')
    const rep = (await admin.json('GET', `/api/report/${ids.ton}?month=2026-09`)).body
    // ต้นมีกะตั้งแต่วันที่ 11 (วันที่ถูกเพิ่ม) รายงานเดือนก่อนหน้าจึงไม่เปลี่ยน
    expect(rep.totals).toEqual({ workdays: 1, present: 1, late: 0, leave: 0, absent: 0, earlyLeave: 1 })
    expect(rep.days[0].entries[0]).toMatchObject({ scannedAt: '08:59:50', earlyLeaveAt: '15:00:00' })

    const y = (await admin.json('GET', `/api/report/${ids.yuri}?month=2026-09`)).body
    expect(y.totals).toMatchObject({ workdays: 1, present: 1, late: 1 })
    expect(y.days[0].entries).toHaveLength(2)
  })
})

describe('เปลี่ยนตารางกลางวัน ประวัติวันนี้ไม่หาย', () => {
  it('ต้นเปลี่ยนเป็น 10:00–19:00: วันนี้ยังเป็นกะเดิมที่เช็กไปแล้ว ตารางใหม่เริ่มครั้งถัดไป', async () => {
    const wk = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startTime: '10:00', endTime: '19:00' }))
    await admin.json('POST', `/api/projects/${turnpro}/assign`, { employeeId: ids.ton, shifts: wk })
    const today = (await admin.json('GET', '/api/admin/day?date=2026-09-11')).body
    const tonToday = today.rows.filter((r: { nickname: string }) => r.nickname === 'ต้น')
    expect(tonToday).toHaveLength(1)
    expect(tonToday[0]).toMatchObject({ startTime: '09:00', scannedAt: '08:59:50' })
    const mon = (await admin.json('GET', '/api/admin/day?date=2026-09-14')).body
    expect(mon.rows.find((r: { nickname: string }) => r.nickname === 'ต้น').startTime).toBe('10:00')
  })
})

describe('นำเข้า Excel', () => {
  it('รายงานปัญหาครบทุกแถวในครั้งเดียว และไม่บันทึกอะไรเลย', async () => {
    const file = await xlsx([
      HEAD,
      ['เอ', 'Gen 8', '', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '09:30', '12:00'],
      ['บี', '8', 'b@gmail', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '9.30', '12:00'],
      ['ซี', '', 'c@gmail.com', 'LU-Phuket', 'พาร์ทไทม์', '', '', '', '', '', '', '', '09:30', '12:00'],
      ['ดี', '', 'd@gmail.com', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '12:00', '09:30'],
      ['อี', '', 'e@gmail.com', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '09:30', '12:00', '11:00', '13:00'],
      ['อี', '', 'e@gmail.com', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '13:00', '15:00'],
      ['ปลอม', '', 'ton@gmail.com', 'LU-Phuket', 'ประจำ', '', '', '', '', '', 'x', '', '09:30', '12:00'],
      ['เอฟ', '', 'f@gmail.com', 'ไม่มีโปรเจกนี้', 'ประจำ', '', '', '', '', '', 'x', '', '09:30', '12:00'],
    ])
    const r = await admin.json('POST', '/api/import/preview', new FormPayload(file))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(false)
    const byRow = (n: number) => r.body.problems.filter((p: { row: number }) => p.row === n)
    expect(byRow(2)).toEqual([]) // ช่องอีเมลว่างไม่ใช่ปัญหาแล้ว กรอกทีหลังได้
    expect(byRow(3).map((p: { column: string }) => p.column).sort()).toEqual(['อีเมล', 'เวลาเข้ารอบ 1'].sort())
    expect(byRow(3).find((p: { column: string }) => p.column === 'เวลาเข้ารอบ 1').fix).toContain('09:30')
    expect(byRow(4)[0].message).toBe('ไม่ได้ติ๊กวันไหนเลย')
    expect(byRow(5)[0].fix).toBe('สลับให้เวลาออกอยู่หลังเวลาเข้า')
    expect(byRow(6)[0].message).toContain('ทับกับรอบ 1')
    expect(byRow(7)[0].message).toContain('ซ้ำกับแถวที่ 6')
    // ปัญหาที่ต้องใช้ฐานข้อมูลจะถูกตรวจเมื่อไฟล์ผ่านรูปแบบแล้ว
    const commit = await admin.json('POST', '/api/import/commit')
    expect(commit.status).toBe(400)
  })

  it('ตรวจกับข้อมูลในระบบ: อีเมลซ้ำกับคนอื่นที่ชื่อไม่ตรง และโปรเจกที่ไม่มี', async () => {
    const file = await xlsx([
      HEAD,
      ['ปลอม', '', 'ton@gmail.com', 'LU-Phuket', 'ประจำ', '', '', '', '', '', 'x', '', '09:30', '12:00'],
      ['เอฟ', '', 'f@gmail.com', 'ไม่มีโปรเจกนี้', 'ประจำ', '', '', '', '', '', 'x', '', '09:30', '12:00'],
    ])
    const r = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(r.ok).toBe(false)
    expect(r.problems[0].message).toContain('อีเมลนี้เป็นของ "ต้น"')
    expect(r.problems[1].message).toContain('ไม่พบโปรเจก')
  })

  it('ไฟล์ถูกต้อง: หน้าสรุปก่อนยืนยัน แล้วบันทึก คู่ที่ไม่อยู่ในไฟล์ไม่ถูกแตะ', async () => {
    const time = new Date(Date.UTC(1899, 11, 30, 9, 30)) // เซลล์เวลาแบบ Excel
    const file = await xlsx([
      HEAD,
      ['มิว', 8, { text: 'Mew@Gmail.com', hyperlink: 'mailto:Mew@Gmail.com' }, 'LU-Phuket', 'นักศึกษา', '✓', '', '✓', '', '', '', '', time, '12:00', '16:30', '19:00', 'มาสองรอบ'],
      ['ต้น', '', 'ton@gmail.com', 'LU-Phuket', 'ประจำ', '', '', '', '', '', 'x', '', '09:30', '12:00'],
      ['ยูริ', 'Gen 7', 'yuri7@gmail.com', 'LU-Phuket', 'นักศึกษา', '', '', '', '', '✓', '', '', '09:30', '12:00'],
      [],
    ])
    const p = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(p.ok).toBe(true)
    expect(p.newEmployees).toEqual([{ nickname: 'มิว (Gen 8)', email: 'mew@gmail.com', projectName: 'LU-Phuket' }])
    expect(p.newAssignments).toEqual([{ nickname: 'ต้น', projectName: 'LU-Phuket' }])
    expect(p.changedShifts).toEqual([
      { nickname: 'ยูริ (Gen 7)', projectName: 'LU-Phuket', before: 'ศ 09:30–12:00 + 17:00–20:00', after: 'ศ 09:30–12:00' },
    ])

    const c = (await admin.json('POST', '/api/import/commit')).body
    expect(c).toMatchObject({ applied: 3 })

    const mew = (await admin.json('GET', '/api/employees')).body.find((e: { email: string }) => e.email === 'mew@gmail.com')
    expect(mew).toMatchObject({ nickname: 'มิว', gen: 'Gen 8', type: 'student' })
    const sch = (await admin.json('GET', `/api/employees/${mew.id}/schedule`)).body
    expect(sch.assignments[0].shifts).toHaveLength(4)
    // ต้นยังอยู่ TurnPRO เพราะเวลาไม่ทับกับกะวันเสาร์ของ LU-Phuket
    const ton = (await admin.json('GET', `/api/employees/${ids.ton}/schedule`)).body
    expect(ton.assignments.map((a: { projectName: string }) => a.projectName)).toEqual(['LU-Phuket', 'TurnPRO'])

    // อัปไฟล์เดิมซ้ำ → ไม่มีอะไรเปลี่ยน
    const again = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(again).toMatchObject({ ok: true, newEmployees: [], newAssignments: [], changedShifts: [], unchangedCount: 3 })
  })

  it('เว้นช่องอีเมลว่างได้: สร้างคนโดยไม่มีอีเมล แล้วอัปไฟล์เดิมซ้ำไม่สร้างคนซ้ำ', async () => {
    const file = await xlsx([
      HEAD,
      ['ปอ', 9, '', 'LU-Phuket', 'นักศึกษา', '', '✓', '', '', '', '', '', '09:30', '12:00'],
    ])
    const p = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(p.ok).toBe(true)
    expect(p.newEmployees).toEqual([{ nickname: 'ปอ (Gen 9)', email: null, projectName: 'LU-Phuket' }])
    expect((await admin.json('POST', '/api/import/commit')).body).toMatchObject({ applied: 1 })

    const por = (await admin.json('GET', '/api/employees')).body.find((e: { nickname: string }) => e.nickname === 'ปอ')
    expect(por).toMatchObject({ gen: 'Gen 9', email: null, type: 'student' })
    ids.por = por.id

    // ไฟล์เดิมซ้ำ → จับคู่ด้วย ชื่อเล่น + Gen ได้ ไม่สร้างคนใหม่
    const again = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(again).toMatchObject({ ok: true, newEmployees: [], newAssignments: [], changedShifts: [], unchangedCount: 1 })
  })

  it('กรอกอีเมลให้ทีหลังแล้วอัปไฟล์เดิม (ที่ยังเว้นว่าง) ซ้ำ ยังจับคู่คนเดิมได้', async () => {
    expect((await admin.json('PATCH', `/api/employees/${ids.por}`, { email: 'Por@Gmail.com' })).body.email).toBe('por@gmail.com')
    const file = await xlsx([
      HEAD,
      ['ปอ', 9, '', 'LU-Phuket', 'นักศึกษา', '', '✓', '', '', '', '', '', '09:30', '12:00'],
    ])
    const p = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(p).toMatchObject({ ok: true, newEmployees: [], unchangedCount: 1 })
  })

  it('ในไฟล์เดียวกัน ชื่อซ้ำกันแต่แถวหนึ่งกรอกอีเมล อีกแถวไม่กรอก → ต้องทัก', async () => {
    const file = await xlsx([
      HEAD,
      ['ซัน', 'Gen 9', 'sun@gmail.com', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '09:30', '12:00'],
      ['ซัน', 'Gen 9', '', 'TurnPRO', 'นักศึกษา', '', '', '✓', '', '', '', '', '13:00', '15:00'],
    ])
    const r = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatchObject({ row: 3, column: 'อีเมล' })
    expect(r.problems[0].message).toContain('ซ้ำกับแถวที่ 2')
  })

  it('มีคนชื่อ+Gen ซ้ำกันในระบบ แถวที่ไม่กรอกอีเมลจะระบุตัวไม่ได้ → ต้องทัก', async () => {
    await admin.json('POST', '/api/employees', { nickname: 'กาย', gen: 'Gen 9', email: 'kai1@gmail.com', type: 'student' })
    await admin.json('POST', '/api/employees', { nickname: 'กาย', gen: 'Gen 9', email: 'kai2@gmail.com', type: 'student' })
    const file = await xlsx([
      HEAD,
      ['กาย', 9, '', 'LU-Phuket', 'นักศึกษา', '✓', '', '', '', '', '', '', '09:30', '12:00'],
    ])
    const r = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatchObject({ row: 2, column: 'ชื่อเล่น' })
    expect(r.problems[0].message).toContain('มากกว่าหนึ่งคน')
  })

  it('สร้างโปรเจกต์ใหม่ผ่านชีตโปรเจก: แสดงใน preview และสร้างลงระบบจริงเมื่อ commit', async () => {
    const file = await multiSheetXlsx([
      {
        name: 'ตาราง',
        rows: [
          HEAD,
          ['บอส', 'Gen 9', 'boss@gmail.com', 'AI-Bot', 'นักศึกษา', '✓', '✓', '', '', '', '', '', '10:00', '19:00'],
        ],
      },
      {
        name: 'โปรเจก',
        rows: [
          ['ชื่อโปรเจก', 'เวลาเริ่มเริ่มต้น', 'เวลาเลิกเริ่มต้น', 'หมายเหตุ'],
          ['AI-Bot', '10:00', '19:00', 'โปรเจกต์ใหม่'],
        ],
      },
      {
        name: 'วิธีกรอก',
        rows: [['คู่มือ']],
      },
    ])

    const p = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(p.ok).toBe(true)
    expect(p.newProjects).toEqual([{ name: 'AI-Bot', memberCount: 1, defaultStart: '10:00', defaultEnd: '19:00' }])
    expect(p.newEmployees).toEqual([{ nickname: 'บอส (Gen 9)', email: 'boss@gmail.com', projectName: 'AI-Bot' }])

    const c = (await admin.json('POST', '/api/import/commit')).body
    expect(c.createdProjects).toBe(1)
    expect(c.applied).toBe(1)

    // ตรวจสอบว่าโปรเจกต์ AI-Bot มีอยู่ในระบบจริง
    const projects = (await admin.json('GET', '/api/projects')).body
    const aibot = projects.find((x: { name: string }) => x.name === 'AI-Bot')
    expect(aibot).toBeDefined()
    expect(aibot.defaultStart).toBe('10:00')
    expect(aibot.defaultEnd).toBe('19:00')

    // ตรวจสอบว่าพนักงานบอสถูกผูกกับโปรเจกต์ AI-Bot
    const boss = (await admin.json('GET', '/api/employees')).body.find((e: { email: string }) => e.email === 'boss@gmail.com')
    expect(boss).toBeDefined()
    const sch = (await admin.json('GET', `/api/employees/${boss.id}/schedule`)).body
    expect(sch.assignments[0].projectName).toBe('AI-Bot')
  })

  it('ชื่อโปรเจกต์ในชีตตารางที่ไม่ได้ประกาศในชีตโปรเจกและไม่มีในระบบ -> แจ้ง error', async () => {
    const file = await multiSheetXlsx([
      {
        name: 'ตาราง',
        rows: [
          HEAD,
          ['มาร์ค', 'Gen 9', 'mark@gmail.com', 'Undeclared-Project', 'นักศึกษา', '✓', '', '', '', '', '', '', '09:30', '12:00'],
        ],
      },
      {
        name: 'โปรเจก',
        rows: [
          ['ชื่อโปรเจก', 'เวลาเริ่มเริ่มต้น', 'เวลาเลิกเริ่มต้น', 'หมายเหตุ'],
          ['TurnPRO', '09:00', '18:00', ''],
        ],
      },
    ])

    const r = (await admin.json('POST', '/api/import/preview', new FormPayload(file))).body
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0].column).toBe('โปรเจก')
    expect(r.problems[0].message).toContain('ไม่พบโปรเจก')
    expect(r.problems[0].fix).toContain('ไปเพิ่มชื่อโปรเจก')
  })

  it('ดาวน์โหลดไฟล์ตัวอย่างได้ และไฟล์ตัวอย่างผ่านการตรวจรูปแบบพร้อมมีชีตโปรเจกต์และ dropdown', async () => {
    const r = await admin.get('/api/import/template')
    expect(r.statusCode).toBe(200)
    const { parseWorkbook } = await import('../src/services/import.js')
    const parsed = await parseWorkbook(r.rawPayload)
    expect(parsed.problems).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.declaredProjects.length).toBeGreaterThanOrEqual(2)

    // ตรวจสอบชีตในไฟล์ตัวอย่าง
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(r.rawPayload)
    expect(wb.worksheets.map((s) => s.name)).toEqual(['ตาราง', 'โปรเจก', 'วิธีกรอก'])
    const ws = wb.getWorksheet('ตาราง')!
    expect(ws.getCell('D2').dataValidation?.type).toBe('list')
    expect(ws.getCell('D2').dataValidation?.formulae).toEqual(["='โปรเจก'!$A$2:$A$200"])
  })
})

describe('ลบพนักงาน', () => {
  it('ซ่อน: หายจากจอและล็อกอินไม่ได้ แต่รายงานเดิมยังอยู่', async () => {
    at('21:10:00')
    await admin.json('DELETE', `/api/employees/${ids.yuri}`)
    const list = (await admin.json('GET', '/api/employees')).body
    expect(list.find((e: { id: string }) => e.id === ids.yuri)).toBeUndefined()
    const rep = (await admin.json('GET', `/api/report/${ids.yuri}?month=2026-09`)).body
    expect(rep.totals.present).toBe(1)
    const y = new Client()
    await y.login('yuri7@gmail.com')
    const t = await tokenAt('21:11:00')
    expect((await y.json('GET', `/api/checkin?token=${t}`)).body.kind).toBe('not_registered')
  })

  it('ลบถาวรต้องพิมพ์ชื่อให้ตรง', async () => {
    expect((await admin.json('DELETE', `/api/employees/${ids.yuri}/purge`, { confirmName: 'ผิด' })).status).toBe(400)
    expect((await admin.json('DELETE', `/api/employees/${ids.yuri}/purge`, { confirmName: 'ยูริ' })).status).toBe(200)
    expect((await admin.json('GET', `/api/report/${ids.yuri}?month=2026-09`)).status).toBe(404)
  })
})

describe('วันหยุดและตั้งค่า', () => {
  it('วันหยุดไม่นับ และสร้างรหัสหน้าจอใหม่แล้วลิงก์เดิมใช้ไม่ได้', async () => {
    await admin.json('POST', '/api/holidays', { date: '2026-09-14', name: 'วันหยุดทดสอบ' })
    const mon = (await admin.json('GET', '/api/admin/day?date=2026-09-14')).body
    expect(mon).toMatchObject({ holiday: 'วันหยุดทดสอบ', rows: [] })

    const s = (await admin.json('POST', '/api/settings/display-key')).body
    expect(s.displayKey).not.toBe(displayKey)
    expect(s.displayUrl).toBe(`${ORIGIN}/display/${s.displayKey}`)
    expect((await new Client().get(`/api/board/${displayKey}`)).statusCode).toBe(404)
  })
})
