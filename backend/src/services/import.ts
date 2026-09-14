// นำเข้าตารางจาก Excel (spec หัวข้อ 10)
//
// - กุญแจของแถวคือ คน + โปรเจก หนึ่งแถว = เขียนทับกะทั้งหมดของคู่นั้น
//   ระบุตัวคนด้วยอีเมล ถ้าช่องอีเมลว่าง (กรอกทีหลังได้) ใช้ ชื่อเล่น + Gen แทน
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

/** กุญแจชื่อ ใช้ตอนไม่มีอีเมล ชื่อเล่นซ้ำกันได้จึงต้องมี Gen กำกับ */
const nameKey = (e: { nickname: string; gen: string | null }) => `ชื่อ:${norm(e.nickname)}|${norm(e.gen ?? '')}`

/** กุญแจระบุตัวคน ใช้อีเมลก่อน ถ้าไม่มีอีเมลใช้ ชื่อเล่น + Gen */
const personKey = (e: { email: string | null; nickname: string; gen: string | null }) => e.email ?? nameKey(e)

/** แถวที่อ่านจากไฟล์และผ่านการตรวจรูปแบบแล้ว */
export interface ImportRow {
  row: number
  nickname: string
  gen: string | null
  /** null = ช่องอีเมลในไฟล์ว่างไว้ */
  email: string | null
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

export interface DeclaredProject {
  row: number
  name: string
  defaultStart: string | null
  defaultEnd: string | null
}

// ---------------------------------------------------------------------------
// ขั้นที่ 1: อ่านไฟล์และตรวจรูปแบบของแต่ละแถว (ไม่ต้องใช้ฐานข้อมูล)
// ---------------------------------------------------------------------------

export async function parseWorkbook(buf: Buffer): Promise<{
  rows: ImportRow[]
  problems: ImportProblem[]
  declaredProjects: DeclaredProject[]
}> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    throw badRequest('อ่านไฟล์ไม่ได้ ต้องเป็นไฟล์ Excel (.xlsx) ถ้าเป็น .xls หรือ .csv ให้เปิดแล้วบันทึกเป็น .xlsx ก่อน')
  }
  const wsSchedule = wb.worksheets.find((s) => ['ตาราง', 'schedule', 'employees', 'พนักงาน'].includes(norm(s.name))) ?? wb.worksheets[0]
  if (!wsSchedule) throw badRequest('ไฟล์นี้ไม่มีตาราง')

  const wsProjects = wb.worksheets.find((s) => ['โปรเจก', 'โปรเจกต์', 'โปรเจค', 'projects', 'project'].includes(norm(s.name)))

  const problems: ImportProblem[] = []
  const declaredProjects: DeclaredProject[] = []

  // 1. อ่านชีต 'โปรเจก' (ถ้ามี)
  if (wsProjects) {
    let nameCol = 1
    let startCol = 2
    let endCol = 3
    const pHeaders = wsProjects.getRow(1)
    pHeaders.eachCell({ includeEmpty: false }, (cell, c) => {
      const h = norm(text(scalar(cell.value)))
      if (['ชื่อโปรเจก', 'ชื่อโปรเจกต์', 'ชื่อโปรเจค', 'โปรเจก', 'โปรเจกต์', 'โปรเจค', 'name', 'project'].some((n) => norm(n) === h)) nameCol = c
      else if (['เวลาเริ่มเริ่มต้น', 'เวลาเริ่ม', 'defaultstart', 'start'].some((n) => norm(n) === h)) startCol = c
      else if (['เวลาเลิกเริ่มต้น', 'เวลาออกเริ่มต้น', 'เวลาเลิก', 'defaultend', 'end'].some((n) => norm(n) === h)) endCol = c
    })

    const seenProj = new Map<string, number>()
    wsProjects.eachRow({ includeEmpty: false }, (r, rowNumber) => {
      if (rowNumber === 1) return
      const rawName = text(scalar(r.getCell(nameCol).value))
      if (!rawName) return

      const prevRow = seenProj.get(norm(rawName))
      if (prevRow) {
        problems.push({
          row: rowNumber,
          column: 'ชีตโปรเจก: ชื่อโปรเจก',
          message: `ชื่อโปรเจก "${rawName}" ซ้ำกับแถวที่ ${prevRow}`,
          fix: 'ลบแถวที่ซ้ำออก หรือเปลี่ยนชื่อโปรเจก',
        })
        return
      }
      seenProj.set(norm(rawName), rowNumber)

      const rawStart = scalar(r.getCell(startCol).value)
      const rawEnd = scalar(r.getCell(endCol).value)
      const startTime = readTime(rawStart)
      const endTime = readTime(rawEnd)

      if (startTime && !startTime.ok) {
        problems.push({
          row: rowNumber,
          column: 'ชีตโปรเจก: เวลาเริ่ม',
          message: `เวลาเริ่ม "${startTime.raw}" ผิดรูปแบบ`,
          fix: startTime.suggestion ? `แก้เป็น ${startTime.suggestion}` : 'ใช้รูปแบบ HH:MM เช่น 09:00',
        })
      }
      if (endTime && !endTime.ok) {
        problems.push({
          row: rowNumber,
          column: 'ชีตโปรเจก: เวลาเลิก',
          message: `เวลาเลิก "${endTime.raw}" ผิดรูปแบบ`,
          fix: endTime.suggestion ? `แก้เป็น ${endTime.suggestion}` : 'ใช้รูปแบบ HH:MM เช่น 18:00',
        })
      }

      declaredProjects.push({
        row: rowNumber,
        name: rawName.trim(),
        defaultStart: startTime?.ok ? startTime.value : null,
        defaultEnd: endTime?.ok ? endTime.value : null,
      })
    })
  }

  // 2. อ่านชีต 'ตาราง' (หัวตารางอยู่แถวแรกแถวเดียว)
  const col = new Map<Field, number>()
  wsSchedule.getRow(1).eachCell({ includeEmpty: false }, (cell, c) => {
    const h = norm(text(scalar(cell.value)))
    for (const [f, names] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (!col.has(f) && names.some((n) => norm(n) === h)) col.set(f, c)
    }
  })
  const missing = REQUIRED.filter((f) => !col.has(f))
  if (missing.length) {
    return {
      rows: [],
      problems: [
        ...problems,
        ...missing.map((f) => ({
          row: 1,
          column: COLUMN_LABEL[f],
          message: `ไม่พบคอลัมน์ "${COLUMN_LABEL[f]}" ในแถวแรก`,
          fix: 'ใช้ไฟล์ตัวอย่างจากปุ่ม "ดาวน์โหลดไฟล์ตัวอย่าง" หัวตารางต้องอยู่แถวแรกแถวเดียว',
        })),
      ],
      declaredProjects,
    }
  }

  const rows: ImportRow[] = []
  const crossCheck: ImportRow[] = []

  wsSchedule.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return
    const get = (f: Field): Scalar => (col.has(f) ? scalar(r.getCell(col.get(f)!).value) : null)
    // ข้ามแถวที่ว่างทั้งแถว (มักเป็นแถวที่เคยมีการจัดรูปแบบไว้)
    const anyValue = (Object.keys(ALIASES) as Field[]).some((f) => text(get(f)) !== '' && get(f) !== false)
    if (!anyValue) return

    const add = (f: Field | string, message: string, fix: string) =>
      problems.push({ row: rowNumber, column: (COLUMN_LABEL as Record<string, string>)[f] ?? f, message, fix })
    const nickname = text(get('nickname'))
    const before = problems.length

    if (!nickname) add('nickname', 'ช่องชื่อเล่นว่าง', 'กรอกชื่อเล่น')

    // ช่องอีเมลว่างได้ ระบบจะระบุตัวคนด้วยชื่อเล่น + Gen แทน แล้วค่อยมากรอกอีเมลทีหลังในหน้าพนักงาน
    const email = text(get('email')).toLowerCase().replace(/^mailto:/, '') || null
    if (email && !EMAIL_RE.test(email)) add('email', `อีเมล "${email}" ผิดรูปแบบ`, 'แก้ให้อยู่ในรูป name@example.com')

    const projectName = text(get('project'))
    if (!projectName) add('project', 'ช่องโปรเจกว่าง', 'เลือกโปรเจกจาก Dropdown หรือเพิ่มชื่อโปรเจกในชีต "โปรเจก" ก่อน')

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
    // ต้องมีกุญแจระบุตัวคนใช้ได้ก่อน คืออีเมลที่ถูกรูปแบบ หรือชื่อเล่น
    if ((email ? EMAIL_RE.test(email) : !!nickname) && projectName) crossCheck.push(parsed)
    if (valid) rows.push(parsed)
  })

  // ตรวจข้ามแถวภายในไฟล์เดียวกัน
  const seenPair = new Map<string, ImportRow>()
  const byPerson = new Map<string, ImportRow[]>()
  const withEmailByName = new Map<string, ImportRow>()
  for (const r of crossCheck) if (r.email && !withEmailByName.has(nameKey(r))) withEmailByName.set(nameKey(r), r)
  for (const r of crossCheck) {
    const key = personKey(r)
    const pair = `${key}|${norm(r.projectName)}`
    const first = seenPair.get(pair)
    if (first) {
      problems.push({
        row: r.row,
        column: r.email ? 'อีเมล + โปรเจก' : 'ชื่อเล่น + โปรเจก',
        message: `ซ้ำกับแถวที่ ${first.row} (${r.email ?? displayName(r)}, ${r.projectName})`,
        fix: 'รวมสองแถวเป็นแถวเดียว ถ้ามาสองรอบต่อวันให้ใช้ช่องรอบ 2',
      })
    } else seenPair.set(pair, r)

    const same = byPerson.get(key) ?? []
    // แถวที่ไม่มีอีเมลถูกระบุตัวด้วยชื่อ จึงไม่มีทางชื่อไม่ตรงกันเอง เช็กนี้จึงใช้กับแถวที่มีอีเมลเท่านั้น
    const other = r.email ? same.find((x) => x.nickname !== r.nickname) : undefined
    if (other)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `อีเมลนี้ซ้ำกับแถวที่ ${other.row} ซึ่งชื่อ "${other.nickname}" ไม่ตรงกับ "${r.nickname}"`,
        fix: 'ตรวจว่าเป็นคนเดียวกันหรือไม่ ถ้าใช่ให้แก้ชื่อให้ตรงกัน ถ้าไม่ใช่ให้แก้อีเมล',
      })
    // แถวที่ไม่กรอกอีเมลกับแถวที่กรอก จะกลายเป็นคนละคนถึงจะชื่อเดียวกัน กันพลาดไว้ก่อน
    const twin = r.email ? undefined : withEmailByName.get(nameKey(r))
    if (twin)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `แถวนี้ไม่ได้กรอกอีเมล แต่ชื่อ "${displayName(r)}" ซ้ำกับแถวที่ ${twin.row} ที่กรอกอีเมลไว้`,
        fix: 'ถ้าเป็นคนเดียวกันให้กรอกอีเมลให้เหมือนกันทั้งสองแถว ถ้าคนละคนให้แก้ชื่อเล่นหรือ Gen ให้ต่างกัน',
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
    byPerson.set(key, [...same, r])
  }

  if (rows.length === 0 && problems.length === 0)
    problems.push({ row: 2, column: '-', message: 'ไฟล์นี้ไม่มีข้อมูล', fix: 'กรอกข้อมูลตั้งแต่แถวที่ 2 ลงไป' })

  problems.sort((a, b) => a.row - b.row)
  return { rows, problems, declaredProjects }
}

// ---------------------------------------------------------------------------
// ขั้นที่ 2: ตรวจกับข้อมูลในระบบ แล้ววางแผนการเขียน
// ---------------------------------------------------------------------------

interface Resolved {
  problems: ImportProblem[]
  employees: Map<string, EmployeeRow>
  projects: Map<string, ProjectRow | { id: string; name: string; defaultStart: string; defaultEnd: string }>
  newProjects: { name: string; defaultStart: string | null; defaultEnd: string | null }[]
}

async function resolveAgainstDb(tx: Tx, rows: ImportRow[], declaredProjects: DeclaredProject[] = []): Promise<Resolved> {
  const problems: ImportProblem[] = []
  // คนที่ถูกซ่อนก็ต้องเจอด้วย ไม่งั้นการนำเข้าซ้ำจะสร้างคนซ้อนขึ้นมาอีกคน
  const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => e !== null))]
  const nicknames = [...new Set(rows.filter((r) => !r.email).map((r) => r.nickname))]
  const byEmail = emails.length
    ? await tx.select().from(schema.employees).where(inArray(schema.employees.email, emails))
    : []
  const byNickname = nicknames.length
    ? await tx.select().from(schema.employees).where(inArray(schema.employees.nickname, nicknames))
    : []

  const employees = new Map(byEmail.map((e) => [e.email!, e]))
  // แถวที่ไม่มีอีเมลจับคู่ด้วย ชื่อเล่น + Gen จับกับคนที่มีอีเมลในระบบแล้วก็ได้
  // (แอดมินอาจกรอกอีเมลให้ทีหลัง แล้วอัปโหลดไฟล์เดิมที่ยังเว้นว่างอยู่ซ้ำ)
  const candidates = new Map<string, EmployeeRow[]>()
  for (const e of byNickname) candidates.set(nameKey(e), [...(candidates.get(nameKey(e)) ?? []), e])
  const ambiguous = new Set<string>()
  for (const r of rows) {
    if (r.email) continue
    const found = candidates.get(nameKey(r)) ?? []
    if (found.length === 1) employees.set(nameKey(r), found[0])
    else if (found.length > 1) ambiguous.add(nameKey(r))
  }

  const allProjects = await tx.select().from(schema.projects)
  const projects = new Map<string, ProjectRow | { id: string; name: string; defaultStart: string; defaultEnd: string }>(
    allProjects.map((p) => [norm(p.name), p]),
  )
  const known = allProjects.map((p) => p.name).slice(0, 12).join(', ')

  // ตรวจจับโปรเจกต์ใหม่ที่ประกาศไว้ในชีตโปรเจก
  const newProjects: { name: string; defaultStart: string | null; defaultEnd: string | null }[] = []
  for (const dp of declaredProjects) {
    const key = norm(dp.name)
    if (!projects.has(key)) {
      const virtual = {
        id: `new:proj:${key}`,
        name: dp.name,
        defaultStart: dp.defaultStart ?? '09:00',
        defaultEnd: dp.defaultEnd ?? '18:00',
      }
      projects.set(key, virtual)
      newProjects.push({ name: dp.name, defaultStart: dp.defaultStart, defaultEnd: dp.defaultEnd })
    }
  }

  for (const r of rows) {
    if (!projects.has(norm(r.projectName)))
      problems.push({
        row: r.row,
        column: 'โปรเจก',
        message: `ไม่พบโปรเจก "${r.projectName}" ในชีตโปรเจก หรือในระบบ`,
        fix: declaredProjects.length > 0
          ? `ไปเพิ่มชื่อโปรเจก "${r.projectName}" ในชีต "โปรเจก" ก่อน แล้วเลือกจาก Dropdown ในชีตตาราง`
          : allProjects.length
            ? `แก้ชื่อให้ตรงกับที่มี (${known}) หรือเพิ่มชื่อโปรเจกในชีต "โปรเจก"`
            : 'เพิ่มชื่อโปรเจกในชีต "โปรเจก" แล้วอัปโหลดใหม่',
      })
    if (!r.email && ambiguous.has(nameKey(r))) {
      problems.push({
        row: r.row,
        column: 'ชื่อเล่น',
        message: `มีพนักงานชื่อ "${displayName(r)}" มากกว่าหนึ่งคนในระบบ แถวนี้ไม่ได้กรอกอีเมลจึงบอกไม่ได้ว่าเป็นคนไหน`,
        fix: 'กรอกอีเมลในไฟล์เพื่อระบุตัวคน หรือแก้ Gen ให้ต่างกัน',
      })
      continue
    }
    const e = employees.get(personKey(r))
    if (!e) continue
    if (!e.isActive)
      problems.push({
        row: r.row,
        column: r.email ? 'อีเมล' : 'ชื่อเล่น',
        message: r.email
          ? `อีเมลนี้เป็นของ ${displayName(e)} ซึ่งถูกซ่อนไว้`
          : `ชื่อนี้ตรงกับ ${displayName(e)} ซึ่งถูกซ่อนไว้`,
        fix: 'กู้คืนคนนี้ในหน้าพนักงานก่อน แล้วอัปโหลดใหม่',
      })
    else if (r.email && e.nickname !== r.nickname)
      problems.push({
        row: r.row,
        column: 'อีเมล',
        message: `อีเมลนี้เป็นของ "${e.nickname}" ในระบบ แต่แถวนี้เขียนว่า "${r.nickname}"`,
        fix: 'ตรวจว่าเป็นคนเดียวกันหรือไม่ ถ้าใช่ให้แก้ชื่อในไฟล์ให้ตรงกับในระบบ ถ้าไม่ใช่ให้แก้อีเมล',
      })
  }
  problems.sort((a, b) => a.row - b.row)
  return { problems, employees, projects, newProjects }
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

export async function previewImport(
  rows: ImportRow[],
  problems: ImportProblem[],
  declaredProjects: DeclaredProject[] = [],
): Promise<ImportPreview> {
  const empty: ImportPreview = { ok: false, problems, newProjects: [], newEmployees: [], newAssignments: [], changedShifts: [] }
  if (problems.length) return empty

  const resolved = await resolveAgainstDb(db, rows, declaredProjects)
  if (resolved.problems.length) return { ...empty, problems: resolved.problems }

  const idFor = (r: ImportRow) => resolved.employees.get(personKey(r))?.id ?? `new:${personKey(r)}`
  const existingIds = [...resolved.employees.values()].map((e) => e.id)
  const current: PlanShift[] = await loadCurrentShifts(db, existingIds)
  const { next } = plan(rows, resolved, current, idFor)

  const projectName = new Map([...resolved.projects.values()].map((p) => [p.id, p.name]))
  const newEmployees = new Map<string, ImportPreview['newEmployees'][number]>()
  const newAssignments: ImportPreview['newAssignments'] = []
  const changedShifts: ImportPreview['changedShifts'] = []
  let unchangedCount = 0

  // เปรียบเทียบก่อน-หลังรายคู่ (คน, โปรเจก) รวมถึงคู่ของโปรเจกอื่นที่ถูกแทนที่เพราะเวลาทับกัน
  const pairs = new Set<string>()
  for (const s of [...current, ...next]) pairs.add(`${s.employeeId}|${s.projectId}`)
  const rowPairs = new Set(rows.map((r) => `${idFor(r)}|${resolved.projects.get(norm(r.projectName))!.id}`))

  for (const r of rows) {
    if (resolved.employees.has(personKey(r))) continue
    const prev = newEmployees.get(personKey(r))
    newEmployees.set(personKey(r), {
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

  const newProjectsList = resolved.newProjects.map((np) => {
    const assignedRows = rows.filter((r) => norm(r.projectName) === norm(np.name))
    const uniqueMembers = new Set(assignedRows.map((r) => personKey(r))).size
    return {
      name: np.name,
      memberCount: uniqueMembers,
      defaultStart: np.defaultStart,
      defaultEnd: np.defaultEnd,
    }
  })

  return {
    ok: true,
    problems: [],
    newProjects: newProjectsList,
    newEmployees: [...newEmployees.values()],
    newAssignments,
    changedShifts,
    unchangedCount,
  }
}

export async function commitImport(adminEmail: string, rows: ImportRow[], declaredProjects: DeclaredProject[] = []) {
  return db.transaction(async (tx) => {
    // กันการนำเข้าสองไฟล์พร้อมกัน
    await tx.execute(sql`select pg_advisory_xact_lock(4801)`)
    const resolved = await resolveAgainstDb(tx, rows, declaredProjects)
    if (resolved.problems.length)
      throw conflict('ข้อมูลในระบบเปลี่ยนไประหว่างที่ดูหน้าสรุป กรุณาอัปโหลดไฟล์ใหม่อีกครั้ง', { problems: resolved.problems })

    // สร้างโปรเจกต์ใหม่ก่อน (ถ้ามี)
    const createdProjects: ProjectRow[] = []
    for (const np of resolved.newProjects) {
      const [p] = await tx
        .insert(schema.projects)
        .values({
          name: np.name,
          defaultStart: np.defaultStart ?? '09:00',
          defaultEnd: np.defaultEnd ?? '18:00',
        })
        .returning()
      resolved.projects.set(norm(np.name), p)
      createdProjects.push(p)
    }

    // สร้างคนใหม่ (หนึ่งอีเมลหนึ่งคน ใช้ข้อมูลจากแถวแรกที่เจอ)
    const created: EmployeeRow[] = []
    for (const r of rows) {
      if (resolved.employees.has(personKey(r))) continue
      const [e] = await tx
        .insert(schema.employees)
        .values({ nickname: r.nickname, gen: r.gen, email: r.email, type: r.type })
        .returning()
      resolved.employees.set(personKey(r), e)
      created.push(e)
    }

    const ids = [...resolved.employees.values()].map((e) => e.id)
    const current = await loadCurrentShifts(tx, ids)
    const { next } = plan(rows, resolved, current, (r) => resolved.employees.get(personKey(r))!.id)
    const res = await reconcile(tx, current, next, localParts(new Date()).date)

    await audit(tx, {
      adminEmail,
      action: 'import',
      after: {
        rows: rows.length,
        createdProjects: createdProjects.map((p) => p.name),
        createdEmployees: created.map((e) => e.email ?? `${displayName(e)} (ยังไม่มีอีเมล)`),
        shiftsAdded: res.added,
        shiftsRemoved: res.removed,
      },
    })
    return { applied: rows.length, createdProjects: createdProjects.length }
  })
}

// ---------------------------------------------------------------------------
// ไฟล์ตัวอย่าง
// ---------------------------------------------------------------------------

export async function templateWorkbook(txOrDb: Tx | typeof db = db): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  // 1. ชีต 'ตาราง'
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
    ws.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['=\'โปรเจก\'!$A$2:$A$200'],
      showErrorMessage: true,
      errorTitle: 'โปรเจก',
      error: 'เลือกโปรเจกจากรายการ หรือไปเพิ่มชื่อในชีต "โปรเจก" ก่อน',
    }
    for (const colLetter of ['M', 'N', 'O', 'P']) {
      ws.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['=\'เวลา\'!$A$2:$A$150'],
        showErrorMessage: true,
        errorTitle: 'เวลา',
        error: 'เลือกเวลาจาก Dropdown หรือพิมพ์ในรูปแบบ HH:MM เช่น 09:00',
      }
    }
  }

  // 2. ชีต 'โปรเจก'
  const wsProjects = wb.addWorksheet('โปรเจก')
  const PROJECT_HEADERS = ['ชื่อโปรเจก', 'เวลาเริ่มเริ่มต้น', 'เวลาเลิกเริ่มต้น', 'หมายเหตุ']
  wsProjects.addRow(PROJECT_HEADERS)
  wsProjects.addRow(['TurnPRO', '09:00', '18:00', 'ตัวอย่าง ลบหรือแก้ไขได้'])
  wsProjects.addRow(['LU-Phuket', '09:30', '19:00', 'ตัวอย่าง ลบหรือแก้ไขได้'])

  const pHeader = wsProjects.getRow(1)
  pHeader.font = { bold: true }
  pHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
  wsProjects.views = [{ state: 'frozen', ySplit: 1 }]
  const pWidths = [20, 16, 16, 30]
  pWidths.forEach((w, i) => (wsProjects.getColumn(i + 1).width = w))
  wsProjects.getColumn(2).numFmt = '@'
  wsProjects.getColumn(3).numFmt = '@'

  for (let r = 2; r <= 200; r++) {
    for (const colLetter of ['B', 'C']) {
      wsProjects.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['=\'เวลา\'!$A$2:$A$150'],
        showErrorMessage: true,
        errorTitle: 'เวลา',
        error: 'เลือกเวลาจาก Dropdown หรือพิมพ์ในรูปแบบ HH:MM เช่น 09:00',
      }
    }
  }

  // 3. ชีต 'เวลา' (รายการเวลาสำหรับ Dropdown)
  const wsTimes = wb.addWorksheet('เวลา')
  wsTimes.addRow(['ตัวเลือกเวลา'])
  const tHeader = wsTimes.getRow(1)
  tHeader.font = { bold: true }
  tHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
  wsTimes.views = [{ state: 'frozen', ySplit: 1 }]
  wsTimes.getColumn(1).width = 16
  wsTimes.getColumn(1).numFmt = '@'

  // สร้างช่วงเวลาทุก 15 นาที ตั้งแต่ 06:00 ถึง 23:45
  for (let h = 6; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, '0')
      const mm = String(m).padStart(2, '0')
      wsTimes.addRow([`${hh}:${mm}`])
    }
  }

  // 4. ชีต 'วิธีกรอก'
  const help = wb.addWorksheet('วิธีกรอก')
  ;[
    '1. ชีต "ตาราง" สำหรับกรอกตารางกะของพนักงาน โดยคอลัมน์ "โปรเจก" และคอลัมน์ "เวลาเข้า/ออก" สามารถเลือกจาก Dropdown ได้',
    '2. การเพิ่มโปรเจกต์ใหม่: ให้ไปพิมพ์ชื่อโปรเจกต์ในชีต "โปรเจก" ก่อน แล้วกลับมาเลือกจาก Dropdown ในชีต "ตาราง" (ระบบจะสร้างโปรเจกต์ใหม่อัตโนมัติเมื่ออัปโหลด)',
    '3. การปรับเปลี่ยนตัวเลือกเวลา: สามารถไปเพิ่มหรือแก้ไขช่วงเวลาในชีต "เวลา" ได้ หรือพิมพ์เวลาเองในรูปแบบ HH:MM เช่น 09:30',
    '4. หนึ่งแถว = หนึ่งคนต่อหนึ่งโปรเจก ถ้าคนเดียวอยู่สองโปรเจกให้กรอกสองแถว',
    '5. อีเมลต้องเป็นบัญชีที่ล็อกอิน Google ได้ (Gmail หรืออีเมลที่ผูกกับบัญชี Google) ไม่งั้นจะเช็กชื่อไม่ได้',
    '6. เว้นช่องอีเมลว่างได้ถ้ายังไม่รู้ นำเข้าตารางไปก่อนแล้วค่อยมากรอกในหน้าพนักงาน แต่คนนั้นจะสแกน QR เช็กชื่อเองไม่ได้จนกว่าจะกรอก (แอดมินกดแทนได้)',
    '7. แถวที่ไม่กรอกอีเมล ระบบจะจับคู่คนด้วย ชื่อเล่น + Gen ถ้าในระบบมีชื่อซ้ำกันหลายคนต้องกรอกอีเมลเพื่อบอกว่าเป็นคนไหน',
    '8. Gen แยกออกจากชื่อ พนักงานประจำเว้นว่างได้',
    '9. ประเภท: ประจำ หรือ นักศึกษา (พาร์ทไทม์ให้ใส่ นักศึกษา)',
    '10. คอลัมน์ จ ถึง อา: ติ๊กวันที่มา ใส่อะไรก็ได้ เช่น ✓ หรือ x ช่องว่าง = ไม่มา',
    '11. เวลาใช้รูปแบบ HH:MM เช่น 09:30 (ห้ามใช้จุด เช่น 9.30)',
    '12. รอบ 2 สำหรับคนที่มาวันละสองรอบ ต้องเริ่มหลังรอบ 1 สิ้นสุด เว้นว่างได้',
    '13. แถวในไฟล์จะเขียนทับกะเดิมของคู่ คน + โปรเจก นั้นทั้งหมด',
    '14. คนที่ไม่มีในไฟล์จะไม่ถูกแตะต้อง การนำเข้าไม่ลบใคร',
    '15. หมายเหตุ: ระบบไม่อ่าน เก็บไว้ให้คนอ่าน',
  ].forEach((line) => help.addRow([line]))
  help.getColumn(1).width = 120

  return Buffer.from(await wb.xlsx.writeBuffer())
}
