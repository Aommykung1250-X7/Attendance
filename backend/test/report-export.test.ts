import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { Employee, ShiftInstance } from '../src/contract.js'
import { buildMonthlyExport, dayStatuses, exportCsvZip, exportDates, exportExcel, exportTables } from '../src/services/report-export.js'

const employee = (id: string, nickname: string): Employee => ({
  id, nickname, gen: null, email: null, type: 'staff', position: '', isActive: true,
})
const entry = (employeeId: string, status: ShiftInstance['status'], leavePortion: ShiftInstance['leavePortion'] = null) =>
  ({ employeeId, status, leavePortion }) as ShiftInstance

describe('ส่งออกรายงานรายเดือน', () => {
  it('เดือนปัจจุบันจบที่วันนี้ และเดือนเก่าแสดงครบเดือน', () => {
    const now = new Date('2026-09-11T03:00:00Z')
    expect(exportDates('2026-09', now)).toHaveLength(11)
    expect(exportDates('2026-08', now)).toHaveLength(31)
    expect(exportDates('2026-10', now)).toEqual([])
  })

  it('วันเดียวหลายกะและลาครึ่งวันนับแต่ละประเภทเพียงวันละครั้ง', () => {
    expect(dayStatuses([entry('1', 'late'), entry('1', 'late', 'afternoon')])).toEqual(['late', 'leave'])
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03']
    const byDate = new Map([
      [dates[0], [{ row: entry('1', 'late') }, { row: entry('1', 'late', 'afternoon') }]],
      [dates[1], [{ row: entry('1', 'offsite') }, { row: entry('2', 'pending') }]],
      [dates[2], [{ row: entry('1', 'absent') }, { row: entry('2', 'ontime') }]],
    ])
    const report = buildMonthlyExport('2026-09', dates, [employee('1', 'ต้น'), employee('2', 'แนน')], byDate)
    expect(report.people[0].cells).toEqual(['สาย / ลา', 'นอกสถานที่', 'ขาด'])
    expect(report.people[0].counts).toEqual({ expected: 3, normal: 1, late: 1, absent: 1, leave: 1 })
    expect(report.people[1].cells).toEqual(['', 'ยังไม่มา', 'ปกติ'])
    expect(report.people[1].counts).toEqual({ expected: 2, normal: 1, late: 0, absent: 0, leave: 0 })
    expect(exportTables(report).daily[0]).toEqual(['ชื่อ (กันยายน 2569)', '01/09', '02/09', '03/09'])
  })

  it('แสดงชื่อวันเสาร์อาทิตย์และวันหยุดพิเศษ โดยนับเสาร์อาทิตย์เฉพาะวันที่มีกะ', () => {
    const dates = ['2026-09-05', '2026-09-06', '2026-09-07']
    const report = buildMonthlyExport('2026-09', dates, [employee('1', 'ต้น'), employee('2', 'แนน')], new Map([
      [dates[0], [{ row: entry('1', 'ontime') }]],
      [dates[1], [{ row: entry('2', 'late') }]],
    ]), new Map([[dates[2], 'วันหยุดพิเศษ']]))
    expect(exportTables(report).daily[0]).toEqual([
      'ชื่อ (กันยายน 2569)', 'เสาร์ 05/09', 'อาทิตย์ 06/09', '07/09 (วันหยุดพิเศษ)',
    ])
    expect(report.people[0].cells).toEqual(['ปกติ', '', 'วันหยุด: วันหยุดพิเศษ'])
    expect(report.people[0].counts.expected).toBe(1)
    expect(report.people[1].cells).toEqual(['', 'สาย', 'วันหยุด: วันหยุดพิเศษ'])
    expect(report.people[1].counts.expected).toBe(1)
  })

  it('Excel มีสองชีต และ ZIP มี CSV สองไฟล์พร้อมหัวตาราง', async () => {
    const report = buildMonthlyExport('2026-09', ['2026-09-01'], [employee('1', 'ต้น')], new Map([
      ['2026-09-01', [{ row: entry('1', 'ontime') }]],
    ]))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportExcel(report) as unknown as Parameters<typeof workbook.xlsx.load>[0])
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['รายวัน', 'สรุป'])
    expect(workbook.getWorksheet('สรุป')!.getRow(2).values).toEqual([, 'ต้น', 1, 1, 0, 0, 0])

    const zip = await JSZip.loadAsync(await exportCsvZip(report))
    expect(Object.keys(zip.files).sort()).toEqual(['daily.csv', 'summary.csv'])
    expect(await zip.file('daily.csv')!.async('string')).toContain('ชื่อ (กันยายน 2569),01/09\r\nต้น,ปกติ')
    expect(await zip.file('summary.csv')!.async('string')).toContain('ต้น,1,1,0,0,0')
  })
})
