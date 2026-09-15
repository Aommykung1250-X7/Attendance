// ข้อมูลจำลองสำหรับดูหน้าตาโดยไม่ต้องมี backend (VITE_USE_MOCK=true)
// ชื่อเล่นเป็นตัวอย่าง อีเมลสมมติทั้งหมด อย่าใส่อีเมลจริงของทีมลงไฟล์นี้

import type { Api } from './api'
import { ApiError } from './api'
import { addDays, bangkok, describeShifts, minutesOf, todayISO } from './format'
import type {
  AdminAction,
  AuditEntry,
  CheckInView,
  DayLog,
  DayLogRow,
  Employee,
  Holiday,
  ImportPreview,
  KioskBoard,
  MonthlyReport,
  Project,
  Shift,
  ShiftEntry,
  ShiftStatus,
} from './types'

const wait = <T>(v: T, ms = 180) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms))
let seq = 100
const nextId = (p: string) => `${p}${++seq}`

const projects: Project[] = [
  { id: 'p1', name: 'TurnPRO', defaultStart: '09:00', defaultEnd: '18:00' },
  { id: 'p2', name: 'LU-Phuket', defaultStart: '09:30', defaultEnd: '12:00' },
  { id: 'p3', name: 'Mobile App', defaultStart: '13:00', defaultEnd: '17:00' },
]

const employees: Employee[] = [
  ['e1', 'ต้น', null, 'staff', 'Developer'],
  ['e2', 'แนน', null, 'staff', 'Designer'],
  ['e3', 'บีม', null, 'staff', 'PM'],
  ['e4', 'โอ๊ต', null, 'staff', 'QA'],
  ['e5', 'ยูริ', 'Gen 7', 'student', ''],
  ['e6', 'ยูริ', 'Gen 8', 'student', ''],
  ['e7', 'มิว', 'Gen 8', 'student', ''],
  ['e8', 'ฟ้า', 'Gen 7', 'student', ''],
  ['e9', 'กาย', 'Gen 8', 'student', ''],
].map(([id, nickname, gen, type, position], i) => ({
  id: id!,
  nickname: nickname!,
  gen,
  // สองคนสุดท้ายนำเข้ามาโดยยังไม่กรอกอีเมล ไว้ดูป้าย "ยังไม่มีอีเมล"
  email: i >= 7 ? null : `demo${i + 1}@example.com`,
  type: type as Employee['type'],
  position: position ?? '',
  isActive: true,
}))

const wk = (days: number[], s: string, e: string) => days.map((weekday) => ({ weekday, startTime: s, endTime: e }))
let shifts: Shift[] = []
function setShifts(employeeId: string, projectId: string, entries: ShiftEntry[]) {
  shifts = shifts.filter((s) => !(s.employeeId === employeeId && s.projectId === projectId))
  shifts.push(...entries.map((x) => ({ ...x, id: nextId('s'), employeeId, projectId })))
}
setShifts('e1', 'p1', wk([1, 2, 3, 4, 5], '09:00', '18:00'))
setShifts('e2', 'p1', wk([1, 2, 3, 4, 5], '09:30', '18:00'))
setShifts('e3', 'p1', wk([1, 2, 3, 4, 5], '09:30', '17:30'))
setShifts('e4', 'p1', wk([1, 2, 3, 4, 5], '09:00', '18:00'))
setShifts('e5', 'p2', [...wk([1, 2, 3, 4, 5, 6, 7], '09:30', '12:00'), ...wk([1, 2, 3, 4, 5, 6, 7], '16:30', '19:00')])
setShifts('e6', 'p2', wk([1, 2, 3, 4, 5, 6, 7], '09:30', '12:00'))
setShifts('e7', 'p3', wk([1, 2, 3, 4, 5, 6, 7], '13:00', '17:00'))
setShifts('e8', 'p3', wk([1, 3, 5, 6, 7], '13:00', '17:00'))
setShifts('e9', 'p2', wk([2, 4, 6, 7], '09:30', '12:00'))

const holidays: Holiday[] = [{ date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' }]
const settings = { displayKey: 'demo', displayUrl: `${location.origin}/display/demo`, qrTokenTtl: 30 }

interface State {
  scannedAt: string | null
  earlyLeaveAt: string | null
  checkedOutAt: string | null
  recordedBy: 'self' | 'admin' | null
  checkedOutBy?: 'self' | 'admin' | null
  override: ShiftStatus | null
  note: string | null
  history: AuditEntry[]
}
const state = new Map<string, State>()

const weekdayOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

/** วันที่ผ่านมาแล้วสุ่มแบบคงที่ วันนี้ขึ้นกับเวลาปัจจุบัน */
function stateFor(shift: Shift, date: string): State {
  const key = `${shift.id}|${date}`
  const got = state.get(key)
  if (got) return got
  const today = todayISO()
  const now = bangkok()
  const nowMin = minutesOf(`${now.hh}:${now.mm}`)
  const start = minutesOf(shift.startTime)
  const h = hash(key) % 100
  let s: State = { scannedAt: null, earlyLeaveAt: null, checkedOutAt: null, recordedBy: null, override: null, note: null, history: [] }
  const pastOrStarted = date < today || (date === today && nowMin > start - 20)
  if (pastOrStarted && h < 88) {
    const offset = h < 70 ? -(h % 25) - 1 : (h % 14) + 1
    const m = Math.max(0, start + offset)
    if (date < today || m <= nowMin) {
      s = { ...s, scannedAt: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`, recordedBy: 'self' }
      if (h % 23 === 0 && date < today) {
        const e = minutesOf(shift.endTime) - 60
        s.earlyLeaveAt = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}:00`
      }
    }
  } else if (date < today && h >= 94) {
    s = { ...s, override: 'leave', note: 'โทรมาแจ้งลา' }
  }
  if (date < today || date === today) state.set(key, s)
  return s
}

function statusOf(shift: Shift, date: string, s: State): ShiftStatus {
  if (s.override) return s.override
  if (s.scannedAt) return minutesOf(s.scannedAt.slice(0, 5)) >= minutesOf(shift.startTime) + 1 ? 'late' : 'ontime'
  const today = todayISO()
  if (date > today) return 'pending'
  if (date < today) return 'absent'
  const b = bangkok()
  return minutesOf(`${b.hh}:${b.mm}`) < minutesOf(shift.endTime) ? 'pending' : 'absent'
}

function rowsFor(date: string, employeeId?: string): DayLogRow[] {
  if (holidays.some((h) => h.date === date)) return []
  const wd = weekdayOf(date)
  return shifts
    .filter((s) => s.weekday === wd && (!employeeId || s.employeeId === employeeId))
    .map((s) => {
      const e = employees.find((x) => x.id === s.employeeId)!
      if (!e.isActive) return null
      const st = stateFor(s, date)
      return {
        shiftId: s.id,
        employeeId: e.id,
        nickname: e.nickname,
        gen: e.gen,
        projectName: projects.find((p) => p.id === s.projectId)!.name,
        startTime: s.startTime,
        endTime: s.endTime,
        scannedAt: st.scannedAt,
        earlyLeaveAt: st.earlyLeaveAt,
        checkedOutAt: st.checkedOutAt,
        status: statusOf(s, date, st),
        recordedBy: st.recordedBy,
        checkedOutBy: st.checkedOutBy ?? null,
        adminNote: st.override ? st.note : null,
        overridden: !!st.override,
        historyCount: st.history.length,
      } satisfies DayLogRow
    })
    .filter((x): x is DayLogRow => !!x)
    .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime) || a.nickname.localeCompare(b.nickname, 'th'))
}

function summary(rows: DayLogRow[]): KioskBoard['summary'] {
  const c = (st: ShiftStatus) => rows.filter((r) => r.status === st).length
  return { expected: rows.length, arrived: c('ontime') + c('late'), late: c('late'), pending: c('pending'), leave: c('leave'), absent: c('absent') }
}

const thaiFull = (date: string) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

// ---- หน้าเช็กชื่อ: เติม &demo=0..9 เพื่อดูแต่ละสถานะ ----
function demoView(n: number): CheckInView {
  const shift = rowsFor(todayISO()).find((r) => r.nickname === 'ต้น') ?? rowsFor('2026-09-14')[0]
  const s = { ...shift, scannedAt: '08:59:50' }
  const views: CheckInView[] = [
    { kind: 'ready', nickname: 'ต้น', shift: s, scannedAt: '08:59:50' },
    { kind: 'done', nickname: 'ต้น', shift: s, status: 'ontime' },
    { kind: 'done', nickname: 'ต้น', shift: { ...s, scannedAt: '09:04:12' }, status: 'late' },
    { kind: 'early_leave', nickname: 'ต้น', shift: s, minutesRemaining: 538 },
    { kind: 'early_leave_done', nickname: 'ต้น', shift: { ...s, earlyLeaveAt: '15:02:00' } },
    { kind: 'too_early', nickname: 'ยูริ', previousEndTime: '12:00' },
    { kind: 'no_shift_today', nickname: 'ต้น' },
    { kind: 'all_done', nickname: 'ต้น' },
    { kind: 'not_registered', email: 'someone.else@gmail.com' },
    { kind: 'expired' },
    { kind: 'ready_checkout', nickname: 'ต้น', shift: s, scannedAt: '18:00:01' },
    { kind: 'checkout_done', nickname: 'ต้น', shift: { ...s, checkedOutAt: '18:00:01' } },
  ]
  return views[n] ?? views[0]
}
const demoParam = () => Number(new URLSearchParams(location.search).get('demo') ?? '0')

function applySchedule(employeeId: string, projectId: string, entries: ShiftEntry[]) {
  const overl = (a: ShiftEntry, b: ShiftEntry) =>
    a.weekday === b.weekday && minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime)
  const replaced = shifts.filter((s) => s.employeeId === employeeId && s.projectId !== projectId && entries.some((e) => overl(s, e)))
  shifts = shifts.filter((s) => !replaced.includes(s))
  setShifts(employeeId, projectId, entries)
  return {
    schedule: scheduleOf(employeeId),
    replaced: replaced.map((r) => ({ projectName: projects.find((p) => p.id === r.projectId)!.name, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime })),
  }
}

function scheduleOf(id: string) {
  const employee = employees.find((e) => e.id === id)
  if (!employee) throw new ApiError(404, 'ไม่พบพนักงานคนนี้')
  const mine = shifts.filter((s) => s.employeeId === id)
  const assignments = projects
    .filter((p) => mine.some((s) => s.projectId === p.id))
    .map((p) => ({ projectId: p.id, projectName: p.name, shifts: mine.filter((s) => s.projectId === p.id).sort((a, b) => a.weekday - b.weekday || minutesOf(a.startTime) - minutesOf(b.startTime)) }))
  return { employee, assignments }
}

export const mockApi: Api = {
  board: async () => {
    const date = todayISO()
    const rows = rowsFor(date)
    const b = bangkok()
    const now = minutesOf(`${b.hh}:${b.mm}`)
    const starts = [...new Set(rows.map((r) => r.startTime))].sort()
    const ongoing = starts.filter((s) => minutesOf(s) <= now && rows.some((r) => r.startTime === s && minutesOf(r.endTime) > now))
    const next = starts.find((s) => minutesOf(s) > now)
    const strip = ({ overridden: _o, historyCount: _h, ...r }: DayLogRow) => r
    const groups = [
      ...ongoing.map((s) => ({ startTime: s, label: `เข้า ${s}`, rows: rows.filter((r) => r.startTime === s && minutesOf(r.endTime) > now).map(strip) })),
      ...(next ? [{ startTime: next, label: `ถัดไป ${next}`, rows: rows.filter((r) => r.startTime === next).map(strip) }] : []),
    ]
    return wait<KioskBoard>({
      serverTime: new Date().toISOString(),
      dateLabel: thaiFull(date),
      qrToken: `demo-${Math.floor(Date.now() / 30000)}`,
      tokenExpiresIn: settings.qrTokenTtl,
      summary: summary(rows),
      groups,
      today: rows.map(strip),
    })
  },

  checkInView: async () => wait(demoView(demoParam()), 400),
  confirmCheckIn: async () => wait(demoView(1), 500),
  confirmEarlyLeave: async () => wait(demoView(4), 500),
  confirmCheckOut: async () => wait(demoView(11), 500),

  me: async () => wait({ email: 'admin@example.com', name: 'แอดมิน (จำลอง)', isAdmin: true, employee: null }),
  logout: async () => wait({ ok: true as const }),

  day: async (date = todayISO()) => {
    const rows = rowsFor(date)
    return wait<DayLog>({
      date,
      dateLabel: thaiFull(date),
      isToday: date === todayISO(),
      holiday: holidays.find((h) => h.date === date)?.name ?? null,
      summary: summary(rows),
      rows,
    })
  },
  adminAction: async (shiftId: string, date: string, a: AdminAction) => {
    const shift = shifts.find((s) => s.id === shiftId)!
    const st = stateFor(shift, date)
    const before = statusOf(shift, date, st)
    const label: Record<AdminAction['action'], string> = {
      checkin: 'เช็กชื่อแทน',
      undo_checkin: 'ยกเลิกการเช็กชื่อที่กดแทน',
      checkout: 'บันทึกเวลาออกแทน',
      clear_checkout: 'ล้างเวลาออกงาน',
      early_leave: 'แจ้งกลับก่อนแทน',
      clear_early_leave: 'ล้างการแจ้งกลับก่อนเวลา',
      set_status: 'แก้สถานะ',
      clear_status: 'ล้างสถานะที่แก้ไว้',
    }
    if (a.action === 'checkin') Object.assign(st, { scannedAt: `${a.time}:00`, recordedBy: 'admin', override: null })
    if (a.action === 'undo_checkin') {
      if (st.recordedBy === 'self') throw new ApiError(400, 'การเช็กชื่อนี้พนักงานสแกนเอง ลบไม่ได้')
      Object.assign(st, { scannedAt: null, recordedBy: null })
    }
    if (a.action === 'checkout') Object.assign(st, { checkedOutAt: `${a.time}:00`, checkedOutBy: 'admin' })
    if (a.action === 'clear_checkout') Object.assign(st, { checkedOutAt: null, checkedOutBy: null })
    if (a.action === 'early_leave') st.earlyLeaveAt = `${a.time}:00`
    if (a.action === 'clear_early_leave') st.earlyLeaveAt = null
    if (a.action === 'set_status') Object.assign(st, { override: a.status === 'present' ? 'ontime' : a.status, note: a.note || null })
    if (a.action === 'clear_status') Object.assign(st, { override: null, note: null })
    const after = statusOf(shift, date, st)
    st.history.push({
      id: nextId('h'),
      adminEmail: 'admin@example.com',
      label: label[a.action],
      before,
      after,
      note: a.note ?? '',
      createdAt: new Date().toISOString(),
    })
    return wait(rowsFor(date).find((r) => r.shiftId === shiftId)!)
  },
  history: async (shiftId: string, date: string) => {
    const shift = shifts.find((s) => s.id === shiftId)!
    return wait(stateFor(shift, date).history)
  },

  employees: async (includeInactive = false) => wait(employees.filter((e) => includeInactive || e.isActive)),
  createEmployee: async (e) => {
    const email = e.email?.toLowerCase() ?? null
    if (email && employees.some((x) => x.email === email)) throw new ApiError(409, 'อีเมลนี้มีอยู่แล้ว')
    const n: Employee = { ...e, email, id: nextId('e'), isActive: true }
    employees.push(n)
    return wait(n)
  },
  updateEmployee: async (id, patch) => {
    const e = employees.find((x) => x.id === id)!
    Object.assign(e, patch)
    return wait(e)
  },
  hideEmployee: async (id) => {
    const e = employees.find((x) => x.id === id)!
    e.isActive = false
    shifts = shifts.filter((s) => s.employeeId !== id)
    return wait(e)
  },
  restoreEmployee: async (id) => {
    const e = employees.find((x) => x.id === id)!
    e.isActive = true
    return wait(e)
  },
  purgeEmployee: async (id, confirmName) => {
    const i = employees.findIndex((x) => x.id === id)
    if (employees[i].nickname !== confirmName) throw new ApiError(400, `พิมพ์ชื่อ "${employees[i].nickname}" ให้ตรงเพื่อยืนยัน`)
    employees.splice(i, 1)
    return wait({ ok: true as const })
  },
  schedule: async (id) => wait(scheduleOf(id)),
  writeSchedule: async (employeeId, projectId, entries) => wait(applySchedule(employeeId, projectId, entries)),

  projects: async () =>
    wait(projects.map((p) => ({ ...p, memberCount: new Set(shifts.filter((s) => s.projectId === p.id).map((s) => s.employeeId)).size }))),
  project: async (id) => {
    const project = projects.find((p) => p.id === id)
    if (!project) throw new ApiError(404, 'ไม่พบโปรเจกนี้')
    const ids = [...new Set(shifts.filter((s) => s.projectId === id).map((s) => s.employeeId))]
    return wait({
      project,
      members: ids.map((eid) => ({ employee: employees.find((e) => e.id === eid)!, shifts: shifts.filter((s) => s.projectId === id && s.employeeId === eid) })),
    })
  },
  createProject: async (p) => {
    const n = { ...p, id: nextId('p') }
    projects.push(n)
    return wait(n)
  },
  updateProject: async (id, patch) => {
    const p = projects.find((x) => x.id === id)!
    Object.assign(p, patch)
    return wait(p)
  },
  deleteProject: async (id) => {
    if (shifts.some((s) => s.projectId === id)) throw new ApiError(409, 'โปรเจกนี้เคยมีกะแล้ว ลบไม่ได้')
    projects.splice(projects.findIndex((p) => p.id === id), 1)
    return wait({ ok: true as const })
  },
  assign: async (projectId, employeeId, entries) => wait(applySchedule(employeeId, projectId, entries)),

  report: async (employeeId, month) => {
    const employee = employees.find((e) => e.id === employeeId)!
    const today = todayISO()
    const days: MonthlyReport['days'] = []
    for (let d = `${month}-01`; d.startsWith(month) && d <= today; d = addDays(d, 1)) {
      const entries = rowsFor(d, employeeId)
      if (entries.length)
        days.push({
          date: d,
          dateLabel: new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)),
          entries,
        })
    }
    const all = days.flatMap((d) => d.entries)
    return wait({
      employee,
      month,
      totals: {
        workdays: days.filter((d) => d.entries.some((e) => e.status !== 'pending')).length,
        present: days.filter((d) => d.entries.some((e) => e.status === 'ontime' || e.status === 'late')).length,
        late: all.filter((e) => e.status === 'late').length,
        leave: all.filter((e) => e.status === 'leave').length,
        absent: all.filter((e) => e.status === 'absent').length,
        earlyLeave: all.filter((e) => e.earlyLeaveAt).length,
      },
      days,
    })
  },

  importPreview: async (file) => {
    if (/error/i.test(file.name))
      return wait<ImportPreview>(
        {
          ok: false,
          problems: [
            { row: 4, column: 'อีเมล', message: 'ช่องอีเมลว่าง', fix: 'กรอกอีเมลบัญชี Google ของ "พอใจ"' },
            { row: 9, column: 'อีเมล', message: 'ช่องอีเมลว่าง', fix: 'กรอกอีเมลบัญชี Google ของ "บอม"' },
            { row: 12, column: 'เวลาเข้ารอบ 1', message: 'เวลา "9.30" ผิดรูปแบบ', fix: 'แก้เป็น 09:30 (รูปแบบ HH:MM ใช้ : คั่น)' },
            { row: 15, column: 'จ–อา', message: 'ไม่ได้ติ๊กวันไหนเลย', fix: 'ติ๊กอย่างน้อยหนึ่งวันในคอลัมน์ จ ถึง อา' },
            { row: 18, column: 'อีเมล + โปรเจก', message: 'ซ้ำกับแถวที่ 17 (mew@example.com, LU-Phuket)', fix: 'รวมสองแถวเป็นแถวเดียว ถ้ามาสองรอบต่อวันให้ใช้ช่องรอบ 2' },
          ],
          newProjects: [],
          newEmployees: [],
          newAssignments: [],
          changedShifts: [],
        },
        700,
      )
    return wait<ImportPreview>(
      {
        ok: true,
        problems: [],
        newProjects: [
          { name: 'Mobile App', memberCount: 1, defaultStart: '09:00', defaultEnd: '18:00' },
        ],
        newEmployees: [
          { nickname: 'ปอ (Gen 9)', email: 'por@example.com', projectName: 'LU-Phuket' },
          { nickname: 'จูน (Gen 9)', email: null, projectName: 'Mobile App' },
        ],
        newAssignments: [{ nickname: 'มิว (Gen 8)', projectName: 'LU-Phuket' }],
        changedShifts: [
          { nickname: 'ยูริ (Gen 7)', projectName: 'LU-Phuket', before: describeShifts(wk([1, 2, 3, 4, 5], '09:30', '12:00')), after: describeShifts(wk([1, 3], '09:30', '12:00')) },
        ],
        unchangedCount: 14,
      },
      700,
    )
  },
  importCommit: async () => wait({ applied: 18 }, 600),
  importCancel: async () => wait({ ok: true as const }),
  templateUrl: '#',

  settings: async () => wait(settings),
  updateSettings: async (s) => {
    settings.qrTokenTtl = s.qrTokenTtl
    return wait(settings)
  },
  rotateDisplayKey: async () => {
    settings.displayKey = Math.random().toString(36).slice(2, 14)
    settings.displayUrl = `${location.origin}/display/${settings.displayKey}`
    return wait(settings)
  },
  resetAttendance: async () => wait({ ok: true as const, deletedAttendance: 24, deletedOverrides: 5 }, 500),
  holidays: async (year) => wait(holidays.filter((h) => !year || h.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date))),
  addHoliday: async (h) => {
    holidays.push(h)
    return wait(h)
  },
  removeHoliday: async (date) => {
    holidays.splice(holidays.findIndex((h) => h.date === date), 1)
    return wait({ ok: true as const })
  },
}
