// ชิ้นส่วนสำหรับกรอกและแสดงตารางกะ

import { useEffect, useState } from 'react'
import { WEEKDAYS, minutesOf } from '../lib/format'
import type { ShiftEntry } from '../lib/types'
import { Button, Input, Select, cx } from './ui'

/**
 * แบบฟอร์มรูปแบบเดียวกับไฟล์ Excel: ติ๊กวัน + เวลารอบ 1 + รอบ 2 (ไม่บังคับ)
 * ใช้ตอนเพิ่มคนเข้าโปรเจก ระบบกรอกเวลาเริ่มต้นของโปรเจกให้ล่วงหน้า แก้ก่อนบันทึกได้
 */
export function QuickShiftForm({
  defaultStart,
  defaultEnd,
  onChange,
}: {
  defaultStart: string
  defaultEnd: string
  onChange: (entries: ShiftEntry[] | null, error: string | null) => void
}) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [r1, setR1] = useState<[string, string]>([defaultStart, defaultEnd])
  const [useR2, setUseR2] = useState(false)
  const [r2, setR2] = useState<[string, string]>(['17:00', '20:00'])

  const emit = (d = days, a = r1, two = useR2, b = r2) => {
    let err: string | null = null
    if (d.length === 0) err = 'ติ๊กอย่างน้อยหนึ่งวัน'
    else if (!a[0] || !a[1] || minutesOf(a[1]) <= minutesOf(a[0])) err = 'เวลาออกรอบ 1 ต้องอยู่หลังเวลาเข้า'
    else if (two && (!b[0] || !b[1] || minutesOf(b[1]) <= minutesOf(b[0]))) err = 'เวลาออกรอบ 2 ต้องอยู่หลังเวลาเข้า'
    else if (two && minutesOf(b[0]) < minutesOf(a[1])) err = `รอบ 2 ต้องเริ่มตั้งแต่ ${a[1]} เป็นต้นไป`
    if (err) return onChange(null, err)
    onChange(
      [...d]
        .sort()
        .flatMap((w) => [{ weekday: w, startTime: a[0], endTime: a[1] }, ...(two ? [{ weekday: w, startTime: b[0], endTime: b[1] }] : [])]),
      null,
    )
  }

  // ส่งค่าเริ่มต้นให้ฟอร์มแม่ตั้งแต่เปิด
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => emit(), [])

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">วันที่มา</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w) => {
            const on = days.includes(w.n)
            return (
              <button
                key={w.n}
                type="button"
                aria-pressed={on}
                title={w.long}
                onClick={() => {
                  const next = on ? days.filter((x) => x !== w.n) : [...days, w.n]
                  setDays(next)
                  emit(next)
                }}
                className={cx('size-11 rounded-lg border text-[15px] font-medium transition-colors', on ? 'border-ink bg-ink text-chalk' : 'border-rule-strong bg-surface text-text-dim hover:bg-sunken')}
              >
                {w.short}
              </button>
            )
          })}
        </div>
      </fieldset>
      <TimePair label="รอบ 1" value={r1} onChange={(v) => { setR1(v); emit(days, v) }} />
      <label className="flex items-center gap-2.5 text-[15px]">
        <input type="checkbox" className="size-4.5 accent-ink" checked={useR2} onChange={(e) => { setUseR2(e.target.checked); emit(days, r1, e.target.checked) }} />
        มาวันละสองรอบ (เช่น กลับมาอีกครั้งหลังเลิกเรียน)
      </label>
      {useR2 && <TimePair label="รอบ 2" value={r2} onChange={(v) => { setR2(v); emit(days, r1, true, v) }} />}
    </div>
  )
}

function TimePair({ label, value, onChange }: { label: string; value: [string, string]; onChange: (v: [string, string]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-sm font-medium">{label}</span>
      <Input type="time" aria-label={`${label} เวลาเข้า`} value={value[0]} onChange={(e) => onChange([e.target.value, value[1]])} className="w-32" />
      <span className="text-text-dim">ถึง</span>
      <Input type="time" aria-label={`${label} เวลาออก`} value={value[1]} onChange={(e) => onChange([value[0], e.target.value])} className="w-32" />
    </div>
  )
}

/** แก้กะทีละแถว ใช้ได้กับตารางที่แต่ละวันเวลาไม่เท่ากัน และเพิ่มกะที่สองของวันได้ */
export function ShiftRowsEditor({ value, onChange }: { value: ShiftEntry[]; onChange: (v: ShiftEntry[]) => void }) {
  const set = (i: number, patch: Partial<ShiftEntry>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div>
      {value.length === 0 && <p className="py-2 text-sm text-text-dim">ไม่มีกะ (บันทึกแบบนี้ = เอาออกจากโปรเจก)</p>}
      <ul className="space-y-2">
        {value.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="วัน" value={s.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })} className="w-32">
              {WEEKDAYS.map((w) => (
                <option key={w.n} value={w.n}>
                  {w.long}
                </option>
              ))}
            </Select>
            <Input type="time" aria-label="เวลาเข้า" value={s.startTime} onChange={(e) => set(i, { startTime: e.target.value })} className="w-32" />
            <span className="text-text-dim">ถึง</span>
            <Input type="time" aria-label="เวลาออก" value={s.endTime} onChange={(e) => set(i, { endTime: e.target.value })} className="w-32" />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="ลบกะนี้">
              ลบ
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 -ml-3"
        onClick={() => {
          const last = value[value.length - 1]
          onChange([...value, last ? { ...last } : { weekday: 1, startTime: '09:00', endTime: '18:00' }])
        }}
      >
        + เพิ่มกะ
      </Button>
    </div>
  )
}

/** ตารางสัปดาห์แบบย่อ ดูทีเดียวรู้ว่ามาวันไหน กี่รอบ */
export function WeekGrid({ items }: { items: (ShiftEntry & { label?: string })[] }) {
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-rule text-center">
      {WEEKDAYS.map((w) => {
        const list = items.filter((s) => s.weekday === w.n).sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime))
        return (
          <div key={w.n} className={cx('min-w-0 border-rule not-last:border-r', w.n >= 6 && 'bg-sunken/50')}>
            <div className="border-b border-rule py-1.5 text-[13px] font-medium text-text-dim">{w.short}</div>
            <div className="flex min-h-14 flex-col gap-1 p-1">
              {list.map((s, i) => (
                <div key={i} className="rounded bg-ink/[0.06] px-0.5 py-1 leading-tight" title={s.label}>
                  <span className="tnum block text-[12px] font-medium">{s.startTime}</span>
                  <span className="tnum block text-[11px] text-text-dim">{s.endTime}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** ตรวจกะที่แก้แบบรายแถวก่อนส่ง */
export function checkRows(rows: ShiftEntry[]): string | null {
  for (const s of rows) {
    if (!s.startTime || !s.endTime) return 'กรอกเวลาให้ครบทุกแถว'
    if (minutesOf(s.endTime) <= minutesOf(s.startTime)) return `วัน${WEEKDAYS[s.weekday - 1].long} เวลาออกต้องอยู่หลังเวลาเข้า`
  }
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (a.weekday === b.weekday && minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime))
        return `วัน${WEEKDAYS[a.weekday - 1].long} มีกะที่เวลาทับกัน`
    }
  return null
}
