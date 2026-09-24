// ทดสอบตรรกะล้วนที่พลาดไม่ได้: เกณฑ์สาย การเลือกกะ QR token และเวลา

import { describe, expect, it } from 'vitest'
import { issueQrToken, verifyQrToken } from '../src/lib/qr.js'
import { applyAssignment, describeSchedule, reconcile, validateEntries, type PlanShift } from '../src/lib/schedule.js'
import { selectShift, type SelShift } from '../src/lib/selection.js'
import { computeStatus, isLate } from '../src/lib/status.js'
import { haversineMeters, validateCheckinLocation } from '../src/lib/location.js'
import { addDays, localParts, monthDays, weekdayOf, zoned } from '../src/lib/time.js'

describe('เวลาไทย', () => {
  it('แปลงเวลาไทยเป็น UTC ถูก (UTC+7)', () => {
    expect(zoned('2026-09-11', '09:00').toISOString()).toBe('2026-09-11T02:00:00.000Z')
    expect(zoned('2026-09-11', '00:30').toISOString()).toBe('2026-09-10T17:30:00.000Z')
  })
  it('localParts คืนวันที่และเวลาไทย', () => {
    expect(localParts(new Date('2026-09-10T17:30:05Z'))).toEqual({ date: '2026-09-11', weekday: 5, time: '00:30:05' })
  })
  it('weekday 1 = จันทร์ 7 = อาทิตย์', () => {
    expect(weekdayOf('2026-09-07')).toBe(1)
    expect(weekdayOf('2026-09-13')).toBe(7)
  })
  it('addDays และ monthDays', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(monthDays('2028-02')).toHaveLength(29)
  })
})

describe('เกณฑ์สาย (spec หัวข้อ 7)', () => {
  const at = (t: string) => new Date(`2026-09-11T${t}+07:00`)
  it('09:00:59.999 ยังเป็นปกติ', () => {
    expect(isLate(at('09:00:59.999'), '2026-09-11', '09:00')).toBe(false)
  })
  it('09:01:00.000 เป็นสาย', () => {
    expect(isLate(at('09:01:00.000'), '2026-09-11', '09:00')).toBe(true)
  })
  it('มาก่อนเวลามากๆ ก็ปกติ', () => {
    expect(isLate(at('06:00:00'), '2026-09-11', '09:00')).toBe(false)
  })
  it('ใช้จำนวนนาทีผ่อนผันจาก Settings', () => {
    expect(isLate(at('09:10:59.999'), '2026-09-11', '09:00', 10)).toBe(false)
    expect(isLate(at('09:11:00.000'), '2026-09-11', '09:00', 10)).toBe(true)
  })

  const base = { date: '2026-09-11', startTime: '09:00', endTime: '18:00', holiday: false, override: null }
  it('ลำดับการตัดสิน: วันหยุด > override > สแกน > เวลา', () => {
    expect(computeStatus({ ...base, holiday: true, override: 'leave', scannedAt: null, now: at('20:00:00') })).toBeNull()
    expect(computeStatus({ ...base, override: 'leave', scannedAt: at('08:00:00'), now: at('20:00:00') })).toBe('leave')
    expect(computeStatus({ ...base, override: 'present', scannedAt: null, now: at('20:00:00') })).toBe('ontime')
    expect(computeStatus({ ...base, scannedAt: at('09:00:30'), now: at('10:00:00') })).toBe('ontime')
    expect(computeStatus({ ...base, scannedAt: at('09:01:00'), now: at('10:00:00') })).toBe('late')
  })
  it('ไม่สแกน: ก่อนสิ้นสุดกะ = ยังไม่มา, ตั้งแต่สิ้นสุดกะ = ขาด', () => {
    expect(computeStatus({ ...base, scannedAt: null, now: at('17:59:59') })).toBe('pending')
    expect(computeStatus({ ...base, scannedAt: null, now: at('18:00:00') })).toBe('absent')
  })
  it('ลาเต็มวันเป็นลา และลาครึ่งเช้าใช้ 13:00 เป็นเวลาเริ่ม', () => {
    expect(computeStatus({ ...base, leavePortion: 'full_day', scannedAt: null, now: at('20:00:00') })).toBe('leave')
    expect(computeStatus({ ...base, leavePortion: 'morning', scannedAt: null, now: at('12:59:59') })).toBe('leave')
    expect(computeStatus({ ...base, leavePortion: 'morning', scannedAt: at('13:01:00'), now: at('14:00:00') })).toBe('late')
  })
})

describe('พื้นที่เช็กอิน', () => {
  const settings = {
    officeLatitude: 18.800523577253724,
    officeLongitude: 98.95073601100776,
    checkinRadiusMeters: 200,
    maxLocationAccuracyMeters: 100,
  }
  it('พิกัดสำนักงานมีระยะเป็นศูนย์และผ่าน', () => {
    expect(haversineMeters(settings.officeLatitude, settings.officeLongitude, settings.officeLatitude, settings.officeLongitude)).toBe(0)
    expect(validateCheckinLocation({ latitude: settings.officeLatitude, longitude: settings.officeLongitude, accuracy: 100 }, settings).distance).toBe(0)
  })
  it('ปฏิเสธ accuracy เกินกำหนดและพิกัดนอก 200 เมตร', () => {
    expect(() => validateCheckinLocation({ latitude: settings.officeLatitude, longitude: settings.officeLongitude, accuracy: 100.1 }, settings)).toThrow()
    expect(() => validateCheckinLocation({ latitude: settings.officeLatitude + 0.003, longitude: settings.officeLongitude, accuracy: 10 }, settings)).toThrow()
  })
})

describe('การเลือกกะ (spec หัวข้อ 8)', () => {
  const s = (id: string, start: string, end: string, extra: Partial<SelShift> = {}): SelShift => ({
    shiftId: id,
    startTime: start,
    endTime: end,
    attended: false,
    earlyLeft: false,
    override: null,
    ...extra,
  })
  const morning = s('m', '09:30', '12:00')
  const evening = s('e', '17:00', '20:00')

  it('ไม่มีกะ', () => expect(selectShift([], '09:00:00')).toEqual({ kind: 'no_shift_today' }))
  it('สแกนก่อนเวลากะเกิน 30 นาที → too_early_for_shift', () =>
    expect(selectShift([morning, evening], '06:00:00')).toEqual({
      kind: 'too_early_for_shift',
      shiftId: 'm',
      startTime: '09:30',
      availableFrom: '09:00',
    }))
  it('สแกนภายใน 30 นาทีก่อนเริ่มกะ → ready', () =>
    expect(selectShift([morning, evening], '09:05:00')).toEqual({ kind: 'ready', shiftId: 'm' }))
  it('สแกนซ้ำก่อนหรือตรงเวลาเริ่มกะ → ready (isUpdate)', () =>
    expect(selectShift([{ ...morning, attended: true }, evening], '09:25:00')).toEqual({
      kind: 'ready',
      shiftId: 'm',
      isUpdate: true,
    }))
  it('เช็กเข้าแล้วสแกนซ้ำระหว่างกะ (หลังเริ่มกะ) → หน้าแจ้งกลับก่อน พร้อมนาทีที่เหลือ', () =>
    expect(selectShift([{ ...morning, attended: true }, evening], '11:00:00')).toEqual({
      kind: 'early_leave',
      shiftId: 'm',
      minutesRemaining: 60,
    }))
  it('สแกนสามครั้งรวดตอนเช้าเพื่อปิดทั้งวันไม่ได้: กะก่อนหน้ายังไม่จบ → too_early', () => {
    const r = selectShift([{ ...morning, attended: true, earlyLeft: true }, evening], '10:00:00')
    expect(r).toEqual({ kind: 'too_early', previousEndTime: '12:00' })
  })
  it('กลับมารอบเย็นหลังกะเช้าเช็กออกแล้ว → เช็กเข้ากะเย็นได้', () => {
    expect(selectShift([{ ...morning, attended: true, checkedOut: true }, evening], '16:50:00')).toEqual({
      kind: 'ready',
      shiftId: 'e',
    })
  })
  it('ขาดกะเช้า มาตอนเย็น → ข้ามกะเช้าที่จบแล้ว ไปเช็กกะเย็น', () =>
    expect(selectShift([morning, evening], '16:55:00')).toEqual({ kind: 'ready', shiftId: 'e' }))
  it('ทุกกะจัดการแล้ว → all_done', () =>
    expect(
      selectShift(
        [
          { ...morning, attended: true, checkedOut: true },
          { ...evening, attended: true, earlyLeft: true },
        ],
        '19:00:00',
      ),
    ).toEqual({
      kind: 'all_done',
    }))
  it('แอดมินกดลาไว้ → ไม่ต้องเช็กกะนั้น', () =>
    expect(selectShift([{ ...morning, override: 'leave' }], '09:00:00')).toEqual({ kind: 'all_done' }))

  const workShift = s('w', '09:00', '18:00', { attended: true })
  it('สแกนตอน 17:59:59 (ก่อน 18:00) → หน้าขอออกก่อนเวลา (early_leave)', () => {
    expect(selectShift([workShift], '17:59:59')).toEqual({
      kind: 'early_leave',
      shiftId: 'w',
      minutesRemaining: 1,
    })
  })
  it('สแกนตอน 18:00:00 (ตรงเวลาออก) → หน้า check-out ออกงาน (ready_checkout)', () => {
    expect(selectShift([workShift], '18:00:00')).toEqual({
      kind: 'ready_checkout',
      shiftId: 'w',
    })
  })
  it('สแกนตอน 18:00:01 (หลังเวลาออก) → หน้า check-out ออกงาน (ready_checkout)', () => {
    expect(selectShift([workShift], '18:00:01')).toEqual({
      kind: 'ready_checkout',
      shiftId: 'w',
    })
  })
  it('เช็กชื่อออกงานแล้ว สแกนอีกครั้ง → all_done', () => {
    expect(selectShift([{ ...workShift, checkedOut: true }], '18:05:00')).toEqual({
      kind: 'all_done',
    })
  })

  it('แอดมินแก้สถานะเป็นปกติ (present) → สแกนเวลาออกงานได้ (ready_checkout)', () => {
    const presentShift = s('w', '09:00', '18:00', { attended: true, override: 'present' })
    expect(selectShift([presentShift], '18:00:00')).toEqual({
      kind: 'ready_checkout',
      shiftId: 'w',
    })
  })

  it('แอดมินแก้สถานะเป็นสาย (late) → สแกนเวลาออกงานได้ (ready_checkout)', () => {
    const lateShift = s('w', '09:00', '18:00', { attended: true, override: 'late' })
    expect(selectShift([lateShift], '18:00:00')).toEqual({
      kind: 'ready_checkout',
      shiftId: 'w',
    })
  })

  it('แอดมินแก้สถานะเป็นนอกสถานที่ (offsite) → สแกนเวลาออกงานได้ (ready_checkout)', () => {
    const offsiteShift = s('w', '09:00', '18:00', { attended: true, override: 'offsite' })
    expect(selectShift([offsiteShift], '18:00:00')).toEqual({
      kind: 'ready_checkout',
      shiftId: 'w',
    })
  })
})

describe('QR token', () => {
  const secret = 'x'.repeat(32)
  it('ใช้ได้เฉพาะในช่วงปัจจุบัน และหมดอายุทันทีเมื่อเปลี่ยนรอบ', () => {
    const t0 = 1_800_000_000_000
    const { token } = issueQrToken(secret, 'key', 30, t0)
    expect(verifyQrToken(secret, 'key', 30, token, t0)).toBe(true)
    expect(verifyQrToken(secret, 'key', 30, token, t0 + 29_000)).toBe(true)
    expect(verifyQrToken(secret, 'key', 30, token, t0 + 30_000)).toBe(false)
  })
  it('สร้างรหัสหน้าจอใหม่แล้ว token เก่าใช้ไม่ได้', () => {
    const { token } = issueQrToken(secret, 'old', 30, 1_800_000_000_000)
    expect(verifyQrToken(secret, 'new', 30, token, 1_800_000_000_000)).toBe(false)
  })
  it('ปลอม token ไม่ได้', () => {
    expect(verifyQrToken(secret, 'key', 30, 'abc.AAAAAAAAAAAAAAAAAAAAAA', Date.now())).toBe(false)
    expect(verifyQrToken(secret, 'key', 30, 'demo', Date.now())).toBe(false)
  })
})

describe('การเขียนตารางกะ', () => {
  const cur: PlanShift[] = [
    { id: 'a', employeeId: 'e1', projectId: 'p1', weekday: 1, startTime: '09:00', endTime: '18:00' },
    { id: 'b', employeeId: 'e1', projectId: 'p1', weekday: 2, startTime: '09:00', endTime: '18:00' },
    { id: 'c', employeeId: 'e2', projectId: 'p1', weekday: 1, startTime: '09:00', endTime: '18:00' },
  ]
  it('หนึ่งแถว = เขียนทับกะทั้งหมดของคู่นั้น และเก็บ id ของกะที่ไม่เปลี่ยน', () => {
    const { next } = applyAssignment(cur, 'e1', 'p1', [{ weekday: 1, startTime: '09:00', endTime: '18:00' }])
    expect(next.filter((s) => s.employeeId === 'e1').map((s) => s.id)).toEqual(['a'])
    expect(next.find((s) => s.id === 'c')).toBeTruthy() // คนอื่นไม่ถูกแตะ
  })
  it('ใครเขียนทีหลังชนะ: กะโปรเจกอื่นที่เวลาทับจะถูกแทนที่', () => {
    const { next, replaced } = applyAssignment(cur, 'e1', 'p2', [{ weekday: 1, startTime: '13:00', endTime: '17:00' }])
    expect(replaced.map((r) => r.id)).toEqual(['a'])
    expect(next.filter((s) => s.employeeId === 'e1').map((s) => s.id ?? 'new')).toEqual(['b', 'new'])
  })
  it('ตรวจกะที่ทับกันเองและเวลาผิด', () => {
    expect(validateEntries([{ weekday: 1, startTime: '09:00', endTime: '08:00' }])).toHaveLength(1)
    expect(
      validateEntries([
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '14:00' },
      ]),
    ).toHaveLength(1)
    expect(
      validateEntries([
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '12:00', endTime: '14:00' },
      ]),
    ).toHaveLength(0)
  })
  it('สรุปตารางเป็นข้อความ', () => {
    const wk = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startTime: '09:00', endTime: '18:00' }))
    expect(describeSchedule(wk)).toBe('จ–ศ 09:00–18:00')
    expect(
      describeSchedule([
        { weekday: 1, startTime: '09:30', endTime: '12:00' },
        { weekday: 1, startTime: '17:00', endTime: '20:00' },
        { weekday: 3, startTime: '09:30', endTime: '12:00' },
        { weekday: 3, startTime: '17:00', endTime: '20:00' },
      ]),
    ).toBe('จ, พ 09:30–12:00 + 17:00–20:00')
  })

  const reconcileTx = (usedToday: boolean, inserted: Record<string, unknown>[]) => ({
    execute: async () => ({ rows: [{ shift_id: 'old', today: usedToday }] }),
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async (rows: Record<string, unknown>[]) => { inserted.push(...rows) } }),
  })

  it('แก้กะที่ยังไม่ได้ใช้วันนี้มีผลวันนี้', async () => {
    const inserted: Record<string, unknown>[] = []
    const before: PlanShift[] = [{ id: 'old', employeeId: 'e1', projectId: 'p1', weekday: 1, startTime: '09:30', endTime: '18:00' }]
    const after: PlanShift[] = [{ employeeId: 'e1', projectId: 'p1', weekday: 1, startTime: '09:30', endTime: '17:30' }]
    const result = await reconcile(reconcileTx(false, inserted) as never, before, after, '2026-09-21')
    expect(result).toMatchObject({ effectiveFrom: '2026-09-21', deferredBecauseTodayUsed: false })
    expect(inserted[0]?.validFrom).toBe('2026-09-21')
  })

  it('แก้กะหลังเช็กชื่อแล้วให้กะใหม่เริ่มวันถัดไป', async () => {
    const inserted: Record<string, unknown>[] = []
    const before: PlanShift[] = [{ id: 'old', employeeId: 'e1', projectId: 'p1', weekday: 1, startTime: '09:30', endTime: '18:00' }]
    const after: PlanShift[] = [{ employeeId: 'e1', projectId: 'p1', weekday: 1, startTime: '09:30', endTime: '17:30' }]
    const result = await reconcile(reconcileTx(true, inserted) as never, before, after, '2026-09-21')
    expect(result).toMatchObject({ effectiveFrom: '2026-09-22', deferredBecauseTodayUsed: true })
    expect(inserted[0]?.validFrom).toBe('2026-09-22')
  })
})

describe('สัญญากับ frontend', () => {
  it('src/contract.ts ตรงกับ frontend/src/lib/types.ts (ถ้าไม่ตรงให้รัน pnpm sync-types)', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    const front = new URL('../../frontend/src/lib/types.ts', import.meta.url)
    if (!existsSync(front)) return
    const back = readFileSync(new URL('../src/contract.ts', import.meta.url), 'utf8')
    expect(back.endsWith(readFileSync(front, 'utf8'))).toBe(true)
  })
})
