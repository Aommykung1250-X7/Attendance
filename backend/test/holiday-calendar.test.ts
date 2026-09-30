import { describe, expect, it } from 'vitest'
import { parseHolidayCalendar } from '../src/services/holiday-calendar.js'

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`

describe('นำเข้าปฏิทินวันหยุด', () => {
  it('อ่านกิจกรรมเต็มวันหลายวันและชื่อที่พับบรรทัด พร้อมข้ามกิจกรรมที่มีเวลา', () => {
    const file = calendar(
      'BEGIN:VEVENT\r\nSUMMARY:วันสงกรานต์\\, หยุด\r\n ต่อเนื่อง\r\nDTSTART;VALUE=DATE:20260413\r\nDTEND;VALUE=DATE:20260416\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nSUMMARY:ประชุม\r\nDTSTART;TZID=Asia/Bangkok:20260414T090000\r\nEND:VEVENT\r\n',
    )
    expect(parseHolidayCalendar(file, 2026)).toEqual({
      rows: [
        { date: '2026-04-13', name: 'วันสงกรานต์, หยุดต่อเนื่อง' },
        { date: '2026-04-14', name: 'วันสงกรานต์, หยุดต่อเนื่อง' },
        { date: '2026-04-15', name: 'วันสงกรานต์, หยุดต่อเนื่อง' },
      ],
      skipped: 1,
    })
  })

  it('ขยายวันหยุดรายปี และเคารพวันยกเว้น', () => {
    const file = calendar(
      'BEGIN:VEVENT\r\nSUMMARY:วันปีใหม่\r\nDTSTART;VALUE=DATE:20250101\r\nDTEND;VALUE=DATE:20250102\r\nRRULE:FREQ=YEARLY;COUNT=3\r\nEXDATE;VALUE=DATE:20270101\r\nEND:VEVENT\r\n',
    )
    expect(parseHolidayCalendar(file, 2026).rows).toEqual([{ date: '2026-01-01', name: 'วันปีใหม่' }])
    expect(parseHolidayCalendar(file, 2027).rows).toEqual([])
    expect(parseHolidayCalendar(file, 2028).rows).toEqual([])
  })

  it('ปฏิเสธไฟล์ที่ไม่ใช่ปฏิทิน', () => {
    expect(() => parseHolidayCalendar('hello', 2026)).toThrow('ไฟล์ต้องเป็นปฏิทิน .ics ที่ถูกต้อง')
  })
})
