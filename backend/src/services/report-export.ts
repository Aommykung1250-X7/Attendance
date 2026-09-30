import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { Employee, ShiftInstance, ShiftStatus } from '../contract.js'
import { loadRange } from '../lib/day.js'
import { localParts, monthDays } from '../lib/time.js'
import { listEmployees } from './people.js'

const STATUS_ORDER: ShiftStatus[] = ['ontime', 'late', 'absent', 'leave', 'offsite', 'pending']
const LABEL: Record<ShiftStatus, string> = {
  ontime: 'ปกติ', late: 'สาย', absent: 'ขาด', leave: 'ลา',
  offsite: 'นอกสถานที่', pending: 'ยังไม่มา',
}

type Counts = { expected: number; normal: number; late: number; absent: number; leave: number }
export type ExportPerson = { employee: Employee; cells: string[]; counts: Counts }
export type MonthlyExport = { dates: string[]; people: ExportPerson[] }

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
  dates: string[],
  employees: Employee[],
  byDate: Map<string, { row: ShiftInstance }[]>,
): MonthlyExport {
  const people = employees.map((employee) => {
    const counts: Counts = { expected: 0, normal: 0, late: 0, absent: 0, leave: 0 }
    const cells = dates.map((date) => {
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
  return { dates, people }
}

export async function monthlyExport(month: string, includeInactive: boolean): Promise<MonthlyExport> {
  const now = new Date()
  const dates = exportDates(month, now)
  const employees = await listEmployees(includeInactive)
  const byDate = dates.length
    ? (await loadRange(dates[0], dates[dates.length - 1], { now, includeHidden: true })).byDate
    : new Map<string, { row: ShiftInstance }[]>()
  return buildMonthlyExport(dates, employees, byDate)
}

const safeText = (value: string) => /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
const nameOf = (person: Employee) => safeText(person.gen ? `${person.nickname} (${person.gen})` : person.nickname)
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

export function exportTables(report: MonthlyExport): { daily: (string | number)[][]; summary: (string | number)[][] } {
  return {
    daily: [
      ['ชื่อ', ...report.dates.map(shortDate)],
      ...report.people.map(({ employee, cells }) => [nameOf(employee), ...cells]),
    ],
    summary: [
      ['ชื่อ', 'ต้องเข้าทั้งหมด (วัน)', 'เข้าปกติ/นอกสถานที่ (วัน)', 'สาย (วัน)', 'ขาด (วัน)', 'ลา (วัน)'],
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
