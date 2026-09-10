// นำเข้าตารางจาก Excel (spec หัวข้อ 10)
//
// - กุญแจของแถวคือ อีเมล + โปรเจก หนึ่งแถว = เขียนทับกะทั้งหมดของคู่นั้น
// - คู่ที่ไม่อยู่ในไฟล์ไม่ถูกแตะต้อง การนำเข้าไม่ลบใครทั้งสิ้น
// - เจอปัญหาแม้แถวเดียวให้หยุดทั้งไฟล์ แต่ต้องตรวจครบทุกแถวแล้วรายงานทีเดียว
// - preview กับ commit เป็นคนละ request ผลการ parse เก็บใน session ฝั่งเซิร์ฟเวอร์ ไม่เชื่อข้อมูลที่ client ส่งกลับมา

import ExcelJS from 'exceljs'
import { inArray, sql } from 'drizzle-orm'
import type { ImportPreview, ImportProblem, ShiftEntry } from '../contract.js'
import { db, schema, type Tx } from '../db/index.js'
import type { EmployeeRow, ProjectRow } from '../db/schema.js'
import { badRequest, conflict, EMAIL_RE } from '../lib/http.js'
import { displayName } from '../lib/mappers.js'
import { applyAssignment, describeSchedule, loadCurrentShifts, overlaps, reconcile, type PlanShift } from '../lib/schedule.js'
import { localParts, minutesOf } from '../lib/time.js'
import { audit } from './audit.js'

// ---------------------------------------------------------------------------
// รูปแบบไฟล์
// ---------------------------------------------------------------------------

const DAY_COLUMNS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'] as const

export const TEMPLATE_HEADERS = [
  'ชื่อเล่น',
  'Gen',
  'อีเมล',
  'โปรเจก',
  'ประเภท',
  ...DAY_COLUMNS,
  'เวลาเข้ารอบ 1',
  'เวลาออกรอบ 1',
  'เวลาเข้ารอบ 2',
  'เวลาออกรอบ 2',
  'หมายเหตุ',
]

type Field = 'nickname' | 'gen' | 'email' | 'project' | 'type' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'in1' | 'out1' | 'in2' | 'out2'

const ALIASES: Record<Field, string[]> = {
  nickname: ['ชื่อเล่น', 'ชื่อ', 'nickname', 'name'],
  gen: ['gen', 'รุ่น'],
  email: ['อีเมล', 'อีเมล์', 'email', 'e-mail', 'gmail'],
  project: ['โปรเจก', 'โปรเจกต์', 'โปรเจค', 'project'],
  type: ['ประเภท', 'type'],
  d1: ['จ', 'จันทร์', 'mon'],
  d2: ['อ', 'อังคาร', 'tue'],
  d3: ['พ', 'พุธ', 'wed'],
  d4: ['พฤ', 'พฤหัส', 'พฤหัสบดี', 'thu'],
  d5: ['ศ', 'ศุกร์', 'fri'],
  d6: ['ส', 'เสาร์', 'sat'],
  d7: ['อา', 'อาทิตย์', 'sun'],
  in1: ['เวลาเข้ารอบ1'],
  out1: ['เวลาออกรอบ1'],
  in2: ['เวลาเข้ารอบ2'],
  out2: ['เวลาออกรอบ2'],
}
const REQUIRED: Field[] = ['nickname', 'email', 'project', 'type', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'in1', 'out1']
const COLUMN_LABEL: Record<Field, string> = {
  nickname: 'ชื่อเล่น',
  gen: 'Gen',
  email: 'อีเมล',
  project: 'โปรเจก',
  type: 'ประเภท',
  d1: 'จ',
  d2: 'อ',
  d3: 'พ',
  d4: 'พฤ',
  d5: 'ศ',
  d6: 'ส',
  d7: 'อา',
  in1: 'เวลาเข้ารอบ 1',
  out1: 'เวลาออกรอบ 1',
  in2: 'เวลาเข้ารอบ 2',
  out2: 'เวลาออกรอบ 2',
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** แถวที่อ่านจากไฟล์และผ่านการตรวจรูปแบบแล้ว */
export interface ImportRow {
  row: number
  nickname: string
  gen: string | null
  email: string
  projectName: string
  type: 'staff' | 'student'
  entries: ShiftEntry[]
}

type Scalar = string | number | boolean | Date | null

function scalar(v: ExcelJS.CellValue): Scalar {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return scalar(v.result as ExcelJS.CellValue)
    // อีเมลใน Excel มักถูกแปลงเป็นลิงก์อัตโนมัติ
    if ('text' in v) return scalar(v.text as ExcelJS.CellValue)
    if ('error' in v) return null
  }
  return String(v)
}

const text = (v: Scalar) => (v === null ? '' : v instanceof Date ? v.toISOString() : String(v).trim())

const FALSY = new Set(['', '0', 'false', 'no', 'n', '-', 'ไม่', 'ไม่มี'])
function ticked(v: Scalar): boolean {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return !FALSY.has(text(v).toLowerCase())
}

const pad = (n: number) => String(n).padStart(2, '0')

/** อ่านเวลา คืน { ok, value } หรือ { ok:false, raw, suggestion } */
function readTime(v: Scalar): { ok: true; value: string } | { ok: false; raw: string; suggestion: string | null } | null {
  if (v === null || text(v) === '') return null
  // Excel เก็บเวลาเป็นเศษส่วนของวัน exceljs แปลงให้เป็น Date ที่อิงวันที่ 1899-12-30 UTC
  if (v instanceof Date) {
    const secs = v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds() + v.getUTCMilliseconds() / 1000
    const mins = Math.round(secs / 60) % 1440
    return { ok: true, value: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` }
  }
  if (typeof v === 'number') {
    if (v >= 0 && v < 1) {
      const mins = Math.round(v * 1440) % 1440
      return { ok: true, value: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` }
    }
    return { ok: false, raw: String(v), suggestion: suggestTime(String(v)) }
  }
  const s = text(v)
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (m && +m[1] < 24 && +m[2] < 60) return { ok: true, value: `${pad(+m[1])}:${m[2]}` }
  return { ok: false, raw: s, suggestion: suggestTime(s) }
}

function suggestTime(s: string): string | null {
  const m = /^(\d{1,2})[.,:\s](\d{1,2})$/.exec(s.trim())
  if (!m) return /^\d{1,2}$/.test(s.trim()) && +s < 24 ? `${pad(+s)}:00` : null
  const h = +m[1]
  const mm = m[2].length === 1 ? +m[2] * 10 : +m[2]
  return h < 24 && mm < 60 ? `${pad(h)}:${pad(mm)}` : null
}

function readType(s: string): 'staff' | 'student' | null {
  const t = norm(s)
  if (['ประจำ', 'พนักงานประจำ', 'staff', 'fulltime', 'full-time'].includes(t)) return 'staff'
  if (['นักศึกษา', 'พาร์ทไทม์', 'พาร์ตไทม์', 'พาร์ทไทม', 'parttime', 'part-time', 'student', 'intern', 'ฝึกงาน'].includes(t))
    return 'student'
  return null
}

function readGen(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  return /^\d+$/.test(t) ? `Gen ${t}` : t
}

// ---------------------------------------------------------------------------
// ขั้นที่ 1: อ่านไฟล์และตรวจรูปแบบของแต่ละแถว (ไม่ต้องใช้ฐานข้อมูล)
// ---------------------------------------------------------------------------

export async function parseWorkbook(buf: Buffer): Promise<{ rows: ImportRow[]; problems: ImportProblem[] }> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    throw badRequest('อ่านไฟล์ไม่ได้ ต้องเป็นไฟล์ Excel (.xlsx) ถ้าเป็น .xls หรือ .csv ให้เปิดแล้วบันทึกเป็น .xlsx ก่อน')
  }
  const ws = wb.worksheets[0]
  if (!ws) throw badRequest('ไฟล์นี้ไม่มีตาราง')

  // หัวตารางอยู่แถวแรกแถวเดียว
  const col = new Map<Field, number>()
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, c) => {
    const h = norm(text(scalar(cell.value)))
    for (const [f, names] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (!col.has(f) && names.some((n) => norm(n) === h)) col.set(f, c)
    }
  })
  const missing = REQUIRED.filter((f) => !col.has(f))
  if (missing.length) {
    return {
      rows: [],
      problems: missing.map((f) => ({
        row: 1,
        column: COLUMN_LABEL[f],
        message: `ไม่พบคอลัมน์ "${COLUMN_LABEL[f]}" ในแถวแรก`,
        fix: 'ใช้ไฟล์ตัวอย่างจากปุ่ม "ดาวน์โหลดไฟล์ตัวอย่าง" หัวตารางต้องอยู่แถวแรกแถวเดียว',
      })),
    }
  }

  const problems: ImportProblem[] = []
  const rows: ImportRow[] = []
  const crossCheck: ImportRow[] = []

  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return
    const get = (f: Field): Scalar => (col.has(f) ? scalar(r.getCell(col.get(f)!).value) : null)
    // ข้ามแถวที่ว่างทั้งแถว (มักเป็นแถวที่เคยมีการจัดรูปแบบไว้)
    const anyValue = (Object.keys(ALIASES) as Field[]).some((f) => text(get(f)) !== '' && get(f) !== false)
    if (!anyValue) return

    const add = (f: Field | string, message: string, fix: string) =>
      problems.push({ row: rowNumber, column: (COLUMN_LABEL as Record<string, string>)[f] ?? f, message, fix })
    const nickname = text(get('nickname'))
    const who = nickname ? `"${nickname}"` : 'คนในแถวนี้'
    const before = problems.length

    if (!nickname) add('nickname', 'ช่องชื่อเล่นว่าง', 'กรอกชื่อเล่น')

    const email = text(get('email')).toLowerCase().replace(/^mailto:/, '')
    if (!email) add('email', 'ช่องอีเมลว่าง', `กรอกอีเมลบัญชี Google ของ ${who}`)
    else if (!EMAIL_RE.test(email)) add('email', `อีเมล "${email}" ผิดรูปแบบ`, 'แก้ให้อยู่ในรูป name@example.com')

    const projectName = text(get('project'))
    if (!projectName) add('project', 'ช่องโปรเจกว่าง', 'กรอกชื่อโปรเจกให้ตรงกับที่มีในระบบ')

    const typeText = text(get('type'))
    const type = readType(typeText)
    if (!type)
      add('type', typeText ? `ประเภท "${typeText}" ไม่รู้จัก` : 'ช่องประเภทว่าง', 'ใส่ "ประจำ" หรือ "นักศึกษา" (พาร์ทไทม์ให้ใส่ นักศึกษา)')

    const days: number[] = []
    ;(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'] as const).forEach((f, i) => ticked(get(f)) && days.push(i + 1))
    if (days.length === 0) add('จ–อา', 'ไม่ได้ติ๊กวันไหนเลย', 'ติ๊กอย่างน้อยหนึ่งวันในคอลัมน์ จ ถึง อา')

    const times: Partial<Record<'in1' | 'out1' | 'in2' | 'out2', string>> = {}
    for (const f of ['in1', 'out1', 'in2', 'out2'] as const) {
      const t = readTime(get(f))
      if (t === null) continue
      if (t.ok) times[f] = t.value
      else
        add(
          f,
          `เวลา "${t.raw}" ผิดรูปแบบ`,
          t.suggestion ? `แก้เป็น ${t.suggestion} (รูปแบบ HH:MM ใช้ : คั่น)` : 'ใช้รูปแบบ HH:MM เช่น 09:30',
        )
    }
    const hasErr = (f: string) => problems.slice(before).some((p) => p.column === COLUMN_LABEL[f as Field])
    if (!times.in1 && !hasErr('in1')) add('in1', 'ช่องเวลาเข้ารอบ 1 ว่าง', 'กรอกเวลาเข้า เช่น 09:00')
    if (!times.out1 && !hasErr('out1')) add('out1', 'ช่องเวลาออกรอบ 1 ว่าง', 'กรอกเวลาออก เช่น 18:00')
    if (times.in1 && times.out1 && minutesOf(times.out1) <= minutesOf(times.in1))
      add('out1', `เวลาออก (${times.out1}) มาก่อนหรือเท่ากับเวลาเข้า (${times.in1})`, 'สลับให้เวลาออกอยู่หลังเวลาเข้า')

    const r2filled = [get('in2'), get('out2')].map((v) => text(v) !== '')
    if (r2filled[0] !== r2filled[1] && !hasErr('in2') && !hasErr('out2'))
      add(r2filled[0] ? 'out2' : 'in2', 'กรอกเวลารอบ 2 ไม่ครบ', 'กรอกทั้งเวลาเข้าและเวลาออกของรอบ 2 หรือเว้นว่างทั้งคู่')
    if (times.in2 && times.out2) {
      if (minutesOf(times.out2) <= minutesOf(times.in2))
        add('out2', `เวลาออก (${times.out2}) มาก่อนหรือเท่ากับเวลาเข้า (${times.in2})`, 'สลับให้เวลาออกอยู่หลังเวลาเข้า')
      else if (times.out1 && times.in1 && minutesOf(times.in2) < minutesOf(times.out1))
        add(
          'in2',
          minutesOf(times.out2) > minutesOf(times.in1)
            ? `รอบ 2 (${times.in2}–${times.out2}) ทับกับรอบ 1 (${times.in1}–${times.out1})`
            : `รอบ 2 (${times.in2}) อยู่ก่อนรอบ 1 (${times.in1})`,
          `ให้รอบ 2 เริ่มตั้งแต่ ${times.out1} เป็นต้นไป`,
        )
    }

    const valid = problems.length === before
    const entries: ShiftEntry[] = []
    if (valid)
      for (const d of days) {
        entries.push({ weekday: d, startTime: times.in1!, endTime: times.out1! })
        if (times.in2 && times.out2) entries.push({ weekday: d, startTime: times.in2, endTime: times.out2 })
      }
    const parsed: ImportRow = { row: rowNumber, nickname, gen: readGen(text(get('gen'))), email, projectName, type: type!, entries }
    // แถวที่มีปัญหาก็ยังเอาไปตรวจข้ามแถว (ซ้ำ/อีเมลชน) เพื่อรายงานให้ครบในรอบเดียว
    if (email && EMAIL_RE.test(email) && projectName) crossCheck.push(parsed)
    if (valid) rows.push(parsed)
  })

  // ตรวจข้ามแถวภายในไฟล์เดียวกัน
  const seenPair = new Map<string, ImportRow>()
  const byEmail = new Map<string, ImportRow[]>()
  for (const r of crossCheck) {
    const pair = `${r.email}|${norm(r.projectName)}`
    const first = seenPair.get(pair)
    if (first) {
      problems.push({
        row: r.row,
        column: 'อีเมล + โปรเจก',
        message: `ซ้ำกับแถวที่ ${first.row} (${r.email}, ${r.projectName})`,
        fix: 'รวมสองแถวเป็นแถวเดียว ถ้ามาสองรอบต่อวันให้ใช้ช่องรอบ 2',
      })
    } else seenPair.set(pair, r)

    const same = byEmail.get(r.email) ?? []
    const other = same.find((x) => x.nickname !== r.nickname)
    if (other)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `อีเมลนี้ซ้ำกับแถวที่ ${other.row} ซึ่งชื่อ "${other.nickname}" ไม่ตรงกับ "${r.nickname}"`,
        fix: 'ตรวจว่าเป็นคนเดียวกันหรือไม่ ถ้าใช่ให้แก้ชื่อให้ตรงกัน ถ้าไม่ใช่ให้แก้อีเมล',
      })
    // คนเดียวกันอยู่สองโปรเจกในเวลาที่ทับกันไม่ได้
    for (const x of same) {
      if (norm(x.projectName) === norm(r.projectName)) continue
      const clash = r.entries.find((e) => x.entries.some((y) => overlaps(e, y)))
      if (clash) {
        problems.push({
          row: r.row,
          column: 'เวลาเข้ารอบ 1',
          message: `เวลาทับกับแถวที่ ${x.row} (${x.projectName}) ของคนเดียวกัน`,
          fix: 'คนเดียวอยู่สองโปรเจกพร้อมกันไม่ได้ แก้เวลาให้ไม่ทับกัน',
        })
        break
      }
    }
    byEmail.set(r.email, [...same, r])
  }

  if (rows.length === 0 && problems.length === 0)
    problems.push({ row: 2, column: '-', message: 'ไฟล์นี้ไม่มีข้อมูล', fix: 'กรอกข้อมูลตั้งแต่แถวที่ 2 ลงไป' })

  problems.sort((a, b) => a.row - b.row)
  return { rows, problems }
}

// ---------------------------------------------------------------------------
// ขั้นที่ 2: ตรวจกับข้อมูลในระบบ แล้ววางแผนการเขียน
// ---------------------------------------------------------------------------

interface Resolved {
  problems: ImportProblem[]
  employees: Map<string, EmployeeRow>
  projects: Map<string, ProjectRow>
}

async function resolveAgainstDb(tx: Tx, rows: ImportRow[]): Promise<Resolved> {
  const problems: ImportProblem[] = []
  const emails = [...new Set(rows.map((r) => r.email))]
  const existing = emails.length
    ? await tx.select().from(schema.employees).where(inArray(schema.employees.email, emails))
    : []
  const employees = new Map(existing.map((e) => [e.email, e]))
  const allProjects = await tx.select().from(schema.projects)
  const projects = new Map(allProjects.map((p) => [norm(p.name), p]))
  const known = allProjects.map((p) => p.name).slice(0, 12).join(', ')

  for (const r of rows) {
    if (!projects.has(norm(r.projectName)))
      problems.push({
        row: r.row,
        column: 'โปรเจก',
        message: `ไม่พบโปรเจก "${r.projectName}" ในระบบ`,
        fix: allProjects.length
          ? `แก้ชื่อให้ตรงกับที่มี (${known}) หรือสร้างโปรเจกนี้ในหน้าโปรเจกก่อน`
          : 'สร้างโปรเจกในหน้าโปรเจกก่อน แล้วอัปโหลดใหม่',
      })
    const e = employees.get(r.email)
    if (!e) continue
    if (!e.isActive)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `อีเมลนี้เป็นของ ${displayName(e)} ซึ่งถูกซ่อนไว้`,
        fix: 'กู้คืนคนนี้ในหน้าพนักงานก่อน แล้วอัปโหลดใหม่',
      })
    else if (e.nickname !== r.nickname)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `อีเมลนี้เป็นของ "${e.nickname}" ในระบบ แต่แถวนี้เขียนว่า "${r.nickname}"`,
        fix: 'ตรวจว่าเป็นคนเดียวกันหรือไม่ ถ้าใช่ให้แก้ชื่อในไฟล์ให้ตรงกับในระบบ ถ้าไม่ใช่ให้แก้อีเมล',
      })
  }
  problems.sort((a, b) => a.row - b.row)
  return { problems, employees, projects }
}

function plan(rows: ImportRow[], resolved: Resolved, current: PlanShift[], idFor: (r: ImportRow) => string) {
  let next = current
  const replacedPairs: PlanShift[] = []
  for (const r of rows) {
    const projectId = resolved.projects.get(norm(r.projectName))!.id
    const res = applyAssignment(next, idFor(r), projectId, r.entries)
    next = res.next
    replacedPairs.push(...res.replaced)
  }
  return { next, replacedPairs }
}

export async function previewImport(rows: ImportRow[], problems: ImportProblem[]): Promise<ImportPreview> {
  const empty: ImportPreview = { ok: false, problems, newEmployees: [], newAssignments: [], changedShifts: [] }
  if (problems.length) return empty

  const resolved = await resolveAgainstDb(db, rows)
  if (resolved.problems.length) return { ...empty, problems: resolved.problems }

  const idFor = (r: ImportRow) => resolved.employees.get(r.email)?.id ?? `new:${r.email}`
  const existingIds = [...resolved.employees.values()].map((e) => e.id)
  const current: PlanShift[] = await loadCurrentShifts(db, existingIds)
  const { next } = plan(rows, resolved, current, idFor)

  const projectName = new Map([...resolved.projects.values()].map((p) => [p.id, p.name]))
  const newEmployees = new Map<string, { nickname: string; email: string; projectName: string }>()
  const newAssignments: ImportPreview['newAssignments'] = []
  const changedShifts: ImportPreview['changedShifts'] = []
  let unchangedCount = 0

  // เปรียบเทียบก่อน-หลังรายคู่ (คน, โปรเจก) รวมถึงคู่ของโปรเจกอื่นที่ถูกแทนที่เพราะเวลาทับกัน
  const pairs = new Set<string>()
  for (const s of [...current, ...next]) pairs.add(`${s.employeeId}|${s.projectId}`)
  const rowPairs = new Set(rows.map((r) => `${idFor(r)}|${resolved.projects.get(norm(r.projectName))!.id}`))

  for (const r of rows) {
    if (resolved.employees.has(r.email)) continue
    const prev = newEmployees.get(r.email)
    newEmployees.set(r.email, {
      nickname: displayName(r),
      email: r.email,
      projectName: prev ? `${prev.projectName}, ${r.projectName}` : r.projectName,
    })
  }

  const empById = new Map([...resolved.employees.values()].map((e) => [e.id, e]))
  for (const key of pairs) {
    const [empId, projId] = key.split('|')
    const e = empById.get(empId)
    if (!e) continue // คนใหม่ แสดงในรายการคนใหม่แล้ว
    const before = current.filter((s) => s.employeeId === empId && s.projectId === projId)
    const after = next.filter((s) => s.employeeId === empId && s.projectId === projId)
    const same = before.length === after.length && after.every((s) => s.id && before.some((b) => b.id === s.id))
    if (same) {
      if (rowPairs.has(key)) unchangedCount++
      continue
    }
    if (before.length === 0) newAssignments.push({ nickname: displayName(e), projectName: projectName.get(projId)! })
    else
      changedShifts.push({
        nickname: displayName(e),
        projectName: projectName.get(projId)!,
        before: describeSchedule(before),
        after: after.length ? describeSchedule(after) : 'เอาออก (เวลาทับกับโปรเจกใหม่)',
      })
  }

  return {
    ok: true,
    problems: [],
    newEmployees: [...newEmployees.values()],
    newAssignments,
    changedShifts,
    unchangedCount,
  }
}

export async function commitImport(adminEmail: string, rows: ImportRow[]) {
  return db.transaction(async (tx) => {
    // กันการนำเข้าสองไฟล์พร้อมกัน
    await tx.execute(sql`select pg_advisory_xact_lock(4801)`)
    const resolved = await resolveAgainstDb(tx, rows)
    if (resolved.problems.length)
      throw conflict('ข้อมูลในระบบเปลี่ยนไประหว่างที่ดูหน้าสรุป กรุณาอัปโหลดไฟล์ใหม่อีกครั้ง', { problems: resolved.problems })

    // สร้างคนใหม่ (หนึ่งอีเมลหนึ่งคน ใช้ข้อมูลจากแถวแรกที่เจอ)
    const created: EmployeeRow[] = []
    for (const r of rows) {
      if (resolved.employees.has(r.email)) continue
      const [e] = await tx
        .insert(schema.employees)
        .values({ nickname: r.nickname, gen: r.gen, email: r.email, type: r.type })
        .returning()
      resolved.employees.set(r.email, e)
      created.push(e)
    }

    const ids = [...resolved.employees.values()].map((e) => e.id)
    const current = await loadCurrentShifts(tx, ids)
    const { next } = plan(rows, resolved, current, (r) => resolved.employees.get(r.email)!.id)
    const res = await reconcile(tx, current, next, localParts(new Date()).date)

    await audit(tx, {
      adminEmail,
      action: 'import',
      after: { rows: rows.length, createdEmployees: created.map((e) => e.email), shiftsAdded: res.added, shiftsRemoved: res.removed },
    })
    return { applied: rows.length }
  })
}

// ---------------------------------------------------------------------------
// ไฟล์ตัวอย่าง
// ---------------------------------------------------------------------------

export async function templateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('ตาราง')
  ws.addRow(TEMPLATE_HEADERS)
  ws.addRow(['ต้น', '', 'ton.example@gmail.com', 'TurnPRO', 'ประจำ', '✓', '✓', '✓', '✓', '✓', '', '', '09:00', '18:00', '', '', 'ตัวอย่าง ลบก่อนอัปโหลด'])
  ws.addRow(['มิว', 'Gen 8', 'mew.example@gmail.com', 'LU-Phuket', 'นักศึกษา', '✓', '', '✓', '', '', '', '', '09:30', '12:00', '16:30', '19:00', 'ตัวอย่าง มาสองรอบ'])
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const widths = [12, 9, 30, 16, 12, 5, 5, 5, 5, 5, 5, 5, 13, 13, 13, 13, 30]
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  // คอลัมน์เวลาเป็นข้อความ Excel จะได้ไม่แปลง 09:30 เป็นอย่างอื่น
  for (const c of [13, 14, 15, 16]) ws.getColumn(c).numFmt = '@'
  for (let r = 2; r <= 300; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"ประจำ,นักศึกษา"'],
      showErrorMessage: true,
      errorTitle: 'ประเภท',
      error: 'เลือก ประจำ หรือ นักศึกษา',
    }
  }

  const help = wb.addWorksheet('วิธีกรอก')
  ;[
    'หนึ่งแถว = หนึ่งคนต่อหนึ่งโปรเจก ถ้าคนเดียวอยู่สองโปรเจกให้กรอกสองแถว',
    'อีเมลต้องเป็นบัญชีที่ล็อกอิน Google ได้ (Gmail หรืออีเมลที่ผูกกับบัญชี Google) ไม่งั้นจะเช็กชื่อไม่ได้',
    'Gen แยกออกจากชื่อ พนักงานประจำเว้นว่างได้',
    'ประเภท: ประจำ หรือ นักศึกษา (พาร์ทไทม์ให้ใส่ นักศึกษา)',
    'คอลัมน์ จ ถึง อา: ติ๊กวันที่มา ใส่อะไรก็ได้ เช่น ✓ หรือ x ช่องว่าง = ไม่มา',
    'เวลาใช้รูปแบบ HH:MM เช่น 09:30 (ห้ามใช้จุด เช่น 9.30)',
    'รอบ 2 สำหรับคนที่มาวันละสองรอบ ต้องเริ่มหลังรอบ 1 สิ้นสุด เว้นว่างได้',
    'แถวในไฟล์จะเขียนทับกะเดิมของคู่ อีเมล + โปรเจก นั้นทั้งหมด',
    'คนที่ไม่มีในไฟล์จะไม่ถูกแตะต้อง การนำเข้าไม่ลบใคร',
    'หมายเหตุ: ระบบไม่อ่าน เก็บไว้ให้คนอ่าน',
  ].forEach((line) => help.addRow([line]))
  help.getColumn(1).width = 110

  return Buffer.from(await wb.xlsx.writeBuffer())
}
