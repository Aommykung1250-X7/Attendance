import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { Employee, ShiftInstance, ShiftStatus } from '../contract.js'
import { loadRange } from '../lib/day.js'
import { localParts, monthDays, weekdayOf } from '../lib/time.js'
import { listEmployees } from './people.js'

const STATUS_ORDER: ShiftStatus[] = ['ontime', 'late', 'absent', 'leave', 'offsite', 'pending']
const LABEL: Record<ShiftStatus, string> = {
  ontime: 'ปกติ', late: 'สาย', absent: 'ขาด', leave: 'ลา',
  offsite: 'นอกสถานที่', pending: 'ยังไม่มา',
}

type Counts = { expected: number; normal: number; late: number; absent: number; leave: number }
export type ExportPerson = { employee: Employee; cells: string[]; counts: Counts }
export type MonthlyExport = { month: string; dates: string[]; holidays: Map<string, string>; people: ExportPerson[] }

/** หนึ่งวันนับได้หลายประเภท แต่แต่ละประเภทนับไม่เกินหนึ่งครั้งต่อคน */
export function dayStatuses(entries: Pick<ShiftInstance, 'status' | 'leavePortion'>[]): ShiftStatus[] {
  const statuses = new Set(entries.map((entry) => entry.status))
  if (entries.some((entry) => entry.leavePortion)) statuses.add('leave')
  return STATUS_ORDER.filter((status) => statuses.has(status))
}

export function exportDates(month: string, now = new Date()): string[] {
  const today = localParts(now).date
  return monthDays(month).filter((date) => date <= today)
}

export function buildMonthlyExport(
  month: string,
  dates: string[],
  employees: Employee[],
  byDate: Map<string, { row: ShiftInstance }[]>,
  holidays = new Map<string, string>(),
): MonthlyExport {
  const people = employees.map((employee) => {
    const counts: Counts = { expected: 0, normal: 0, late: 0, absent: 0, leave: 0 }
    const cells = dates.map((date) => {
      const holiday = holidays.get(date)
      if (holiday) return `วันหยุด: ${holiday}`
      const entries = (byDate.get(date) ?? []).filter(({ row }) => row.employeeId === employee.id).map(({ row }) => row)
      if (!entries.length) return ''
      counts.expected++
      const statuses = dayStatuses(entries)
      if (statuses.includes('ontime') || statuses.includes('offsite')) counts.normal++
      if (statuses.includes('late')) counts.late++
      if (statuses.includes('absent')) counts.absent++
      if (statuses.includes('leave')) counts.leave++
      return statuses.map((status) => LABEL[status]).join(' / ')
    })
    return { employee, cells, counts }
  })
  return { month, dates, holidays, people }
}

export async function monthlyExport(month: string, includeInactive: boolean): Promise<MonthlyExport> {
  const now = new Date()
  const dates = exportDates(month, now)
  const employees = await listEmployees(includeInactive)
  const range = dates.length
    ? await loadRange(dates[0], dates[dates.length - 1], { now, includeHidden: true })
    : { byDate: new Map<string, { row: ShiftInstance }[]>(), holidays: new Map<string, string>() }
  return buildMonthlyExport(month, dates, employees, range.byDate, range.holidays)
}

const safeText = (value: string) => /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
const nameOf = (person: Employee) => safeText(person.gen ? `${person.nickname} (${person.gen})` : person.nickname)
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const monthName = (month: string) => new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`))

function dateHeader(date: string, holidays: Map<string, string>): string {
  const weekday = weekdayOf(date)
  const weekend = weekday === 6 ? 'เสาร์ ' : weekday === 7 ? 'อาทิตย์ ' : ''
  const holiday = holidays.get(date)
  return `${weekend}${shortDate(date)}${holiday ? ` (${safeText(holiday)})` : ''}`
}

export function exportTables(report: MonthlyExport): { daily: (string | number)[][]; summary: (string | number)[][] } {
  return {
    daily: [
      [`ชื่อ (${monthName(report.month)})`, ...report.dates.map((date) => dateHeader(date, report.holidays))],
      ...report.people.map(({ employee, cells }) => [nameOf(employee), ...cells]),
    ],
    summary: [
      [`ชื่อ (${monthName(report.month)})`, 'ต้องเข้าทั้งหมด (วัน)', 'เข้าปกติ/นอกสถานที่ (วัน)', 'สาย (วัน)', 'ขาด (วัน)', 'ลา (วัน)'],
      ...report.people.map(({ employee, counts }) => [nameOf(employee), counts.expected, counts.normal, counts.late, counts.absent, counts.leave]),
    ],
  }
}

export async function exportExcel(report: MonthlyExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const tables = exportTables(report)
  for (const [name, rows] of [['รายวัน', tables.daily], ['สรุป', tables.summary]] as const) {
    const sheet = workbook.addWorksheet(name)
    rows.forEach((row) => sheet.addRow(row))
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
    sheet.getRow(1).font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF295C73' } }
    sheet.getColumn(1).width = 25
    for (let column = 2; column <= rows[0].length; column++) sheet.getColumn(column).width = name === 'รายวัน' ? 18 : 21
    if (name === 'รายวัน') {
      report.dates.forEach((date, index) => {
        const column = sheet.getColumn(index + 2)
        const holiday = report.holidays.has(date)
        const weekend = weekdayOf(date) >= 6
        if (holiday || weekend) {
          if (holiday) column.width = 28
          column.eachCell({ includeEmpty: true }, (cell) => {
            const argb = Number(cell.row) === 1
              ? holiday ? 'FF946200' : 'FF536477'
              : holiday ? 'FFFFE9BE' : 'FFF0F2F5'
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
          })
        }
      })
    }
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.font = { name: 'Arial' }
      row.alignment = { vertical: 'middle', wrapText: true }
    })
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length, column: rows[0].length } }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function csv(rows: (string | number)[][]): string {
  return '\ufeff' + rows.map((row) => row.map((cell) => {
    const value = String(cell)
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  }).join(',')).join('\r\n') + '\r\n'
}

export async function exportCsvZip(report: MonthlyExport): Promise<Buffer> {
  const tables = exportTables(report)
  const zip = new JSZip()
  zip.file('daily.csv', csv(tables.daily))
  zip.file('summary.csv', csv(tables.summary))
  return zip.generateAsync({ type: 'nodebuffer' })
}
