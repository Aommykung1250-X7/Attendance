// รายงานรายเดือนรายบุคคล (spec 9.7)
// ออกแบบให้เปิดคุยกับเจ้าตัว แสดงทีละคนเสมอ และกดดูได้ว่าวันไหนบ้าง ไม่มีกราฟ ไม่มีเปอร์เซ็นต์

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { addMonths, displayName, monthLabel, todayISO } from '../../lib/format'
import type { Employee, MonthlyReport, ShiftInstance } from '../../lib/types'
import { StatusPill } from '../../components/StatusPill'
import { Button, Card, Checkbox, Empty, ErrorNote, Field, Loading, PageHeader, Select, cx } from '../../components/ui'

type Focus = 'all' | 'late' | 'leave' | 'absent' | 'earlyLeave' | 'present'

const match = (e: ShiftInstance, f: Focus) =>
  f === 'all' ||
  (f === 'present' && (e.status === 'ontime' || e.status === 'late')) ||
  (f === 'earlyLeave' && !!e.earlyLeaveAt) ||
  e.status === f

export default function Report() {
  const [params, setParams] = useSearchParams()
  const employeeId = params.get('employee') ?? ''
  const month = params.get('month') ?? todayISO().slice(0, 7)
  const [people, setPeople] = useState<Employee[] | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus>('all')
  const [openDay, setOpenDay] = useState<string | null>(null)

  const set = (patch: Record<string, string>) => setParams({ ...(employeeId ? { employee: employeeId } : {}), month, ...patch })

  useEffect(() => {
    api.employees(showHidden).then(setPeople).catch((e) => setError(e.message))
  }, [showHidden])

  useEffect(() => {
    setFocus('all')
    setOpenDay(null)
    if (!employeeId) return setReport(null)
    setReport(null)
    api
      .report(employeeId, month)
      .then((r) => {
        setReport(r)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [employeeId, month])

  const days = useMemo(() => (report?.days ?? []).filter((d) => d.entries.some((e) => match(e, focus))), [report, focus])
  const thisMonth = todayISO().slice(0, 7)

  return (
    <>
      <PageHeader title="รายงานรายเดือน" sub="แสดงทีละคน เพื่อเปิดดูพร้อมเจ้าตัวได้โดยไม่เห็นข้อมูลของคนอื่น" />

      <Card className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-60 flex-1">
          <Field label="พนักงาน">
            {(id) => (
              <Select id={id} value={employeeId} onChange={(e) => set({ employee: e.target.value })}>
                <option value="">เลือกคน</option>
                {(['staff', 'student'] as const).map((t) => (
                  <optgroup key={t} label={t === 'staff' ? 'ประจำ' : 'นักศึกษา'}>
                    {(people ?? [])
                      .filter((p) => p.type === t)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayName(p)}
                          {!p.isActive ? ' (ถูกซ่อน)' : ''}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">เดือน</p>
          <div className="flex items-center gap-1.5">
            <Button aria-label="เดือนก่อนหน้า" onClick={() => set({ month: addMonths(month, -1) })}>
              ‹
            </Button>
            <span className="min-w-36 text-center text-[15px] font-medium">{monthLabel(month)}</span>
            <Button aria-label="เดือนถัดไป" disabled={month >= thisMonth} onClick={() => set({ month: addMonths(month, 1) })}>
              ›
            </Button>
          </div>
        </div>
        <Checkbox label="รวมคนที่ถูกซ่อน" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="text-sm" />
      </Card>

      {error && <ErrorNote message={error} />}
      {!employeeId && !error && (
        <Card>
          <Empty title="เลือกคนที่จะดูรายงาน" body="เลือกทีละคนจากรายการด้านบน" />
        </Card>
      )}
      {employeeId && !report && !error && <Loading />}

      {report && (
        <>
          <div className="mb-2 flex items-baseline gap-3">
            <h2 className="display text-2xl font-semibold">{displayName(report.employee)}</h2>
            <span className="text-[15px] text-text-dim">{monthLabel(report.month)}</span>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-5">
            <Total label="มาทำงาน" focus="present" current={focus} setFocus={setFocus}>
              {report.totals.present}
              <span className="text-lg font-medium text-text-dim"> / {report.totals.workdays} วัน</span>
            </Total>
            <Total label="สาย" unit="ครั้ง" tone="text-late" focus="late" current={focus} setFocus={setFocus} n={report.totals.late} />
            <Total label="ลา" unit="ครั้ง" tone="text-leave" focus="leave" current={focus} setFocus={setFocus} n={report.totals.leave} />
            <Total label="ขาด" unit="ครั้ง" tone="text-absent" focus="absent" current={focus} setFocus={setFocus} n={report.totals.absent} />
            <Total label="กลับก่อนเวลา" unit="ครั้ง" tone="text-late" focus="earlyLeave" current={focus} setFocus={setFocus} n={report.totals.earlyLeave} />
          </div>
          <p className="mt-2 text-[13px] text-text-dim">กดที่ตัวเลขเพื่อดูว่าเป็นวันไหนบ้าง</p>

          <Card className="mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <h3 className="font-medium">{focus === 'all' ? 'รายละเอียดรายวัน' : `เฉพาะวันที่${FOCUS_LABEL[focus]} (${days.length} วัน)`}</h3>
              {focus !== 'all' && (
                <button className="text-sm text-text-dim underline underline-offset-4" onClick={() => setFocus('all')}>
                  ดูทุกวัน
                </button>
              )}
            </div>
            {days.length === 0 ? (
              <Empty title={report.days.length === 0 ? 'เดือนนี้ไม่มีกะของคนนี้' : 'ไม่มีวันที่ตรงกับตัวกรอง'} />
            ) : (
              <ul className="divide-y divide-rule">
                {days.map((d) => (
                  <DayRow key={d.date} day={d} focus={focus} open={openDay === d.date} onToggle={() => setOpenDay(openDay === d.date ? null : d.date)} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}

const FOCUS_LABEL: Record<Focus, string> = { all: '', present: 'มา', late: 'สาย', leave: 'ลา', absent: 'ขาด', earlyLeave: 'กลับก่อนเวลา' }

function Total({
  label,
  unit,
  n,
  tone,
  focus,
  current,
  setFocus,
  children,
}: {
  label: string
  unit?: string
  n?: number
  tone?: string
  focus: Focus
  current: Focus
  setFocus: (f: Focus) => void
  children?: React.ReactNode
}) {
  const active = current === focus
  return (
    <button
      onClick={() => setFocus(active ? 'all' : focus)}
      aria-pressed={active}
      className={cx('bg-surface px-5 py-4 text-left transition-colors hover:bg-sunken', active && 'bg-sunken shadow-[inset_0_-2px_0_var(--color-ink)]')}
    >
      <span className={cx('display tnum block text-[32px] leading-none font-semibold', n !== undefined && n > 0 && tone)}>
        {children ?? (
          <>
            {n}
            <span className="text-lg font-medium text-text-dim"> {unit}</span>
          </>
        )}
      </span>
      <span className="mt-2 block text-sm text-text-dim">{label}</span>
    </button>
  )
}

function DayRow({ day, focus, open, onToggle }: { day: MonthlyReport['days'][number]; focus: Focus; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 text-left hover:bg-sunken/60">
        <span className="text-[15px] font-medium">{day.dateLabel}</span>
        <span className="flex min-w-0 flex-wrap gap-x-5 gap-y-1">
          {day.entries.map((e) => (
            <span key={e.shiftId} className={cx('tnum text-sm', focus !== 'all' && !match(e, focus) && 'opacity-40')}>
              <span className="text-text-dim">{e.startTime}</span> {e.scannedAt ? `เข้า ${e.scannedAt.slice(0, 5)}` : '—'}
              {e.earlyLeaveAt && <span className="ml-1.5 text-late">กลับ {e.earlyLeaveAt.slice(0, 5)}</span>}
            </span>
          ))}
        </span>
        <span className="flex gap-1.5">
          {day.entries.map((e) => (
            <StatusPill key={e.shiftId} status={e.status} className={cx(focus !== 'all' && !match(e, focus) && 'opacity-40')} />
          ))}
        </span>
      </button>
      {open && (
        <div className="bg-sunken/50 px-5 pt-1 pb-4">
          <table className="w-full text-left text-sm">
            <thead className="text-[12px] text-text-dim">
              <tr>
                <th className="py-2 pr-3 font-medium">กะ</th>
                <th className="py-2 pr-3 font-medium">โปรเจก</th>
                <th className="py-2 pr-3 font-medium">เวลาเข้า</th>
                <th className="py-2 pr-3 font-medium">กลับก่อน</th>
                <th className="py-2 pr-3 font-medium">สถานะ</th>
                <th className="py-2 font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {day.entries.map((e) => (
                <tr key={e.shiftId} className="border-t border-rule align-top">
                  <td className="tnum py-2 pr-3">
                    {e.startTime}–{e.endTime}
                  </td>
                  <td className="py-2 pr-3">{e.projectName}</td>
                  <td className="tnum py-2 pr-3">
                    {e.scannedAt ?? '—'}
                    {e.recordedBy && <span className="block text-[12px] text-text-dim">{e.recordedBy === 'self' ? 'สแกนเอง' : 'แอดมินกดแทน'}</span>}
                  </td>
                  <td className="tnum py-2 pr-3">{e.earlyLeaveAt ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="py-2 text-text-dim">{e.adminNote ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  )
}
