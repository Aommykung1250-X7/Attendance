import { useEffect, useState } from 'react'
import { ErrorNote, Loading, cx } from '../components/ui'
import { EmployeeHeader, Icon, Shell } from '../components/EmployeeShell'
import { api } from '../lib/api'
import { addMonths, bangkok, monthLabel, shortDate, shortWeekdayDate, todayISO } from '../lib/format'
import { REQUEST_STATUS, dateLabelOf, typeLabelOf } from '../lib/requestLabels'
import { STATUS_LABEL, type LeaveDuration, type MonthlyReport, type ShiftInstance, type ShiftStatus, type UnifiedRequest } from '../lib/types'

type Overview = Awaited<ReturnType<typeof api.requestOverview>>
type Tab = 'attendance' | 'requests'
const TABS: [Tab, string][] = [['attendance', 'เช็กชื่อ'], ['requests', 'คำขอ']]

const SHIFT_STATUS: Record<ShiftStatus, string> = {
  ontime: 'bg-rq-approved-bg text-rq-approved-ink',
  late: 'bg-rq-pending-bg text-rq-pending-ink',
  absent: 'bg-rq-rejected-bg text-rq-rejected-ink',
  leave: 'bg-leave-bg text-leave-ink',
  offsite: 'bg-arrived-offsite-bg text-arrived-offsite-text',
  pending: 'bg-rq-cancelled-bg text-rq-cancelled-ink',
}

export default function HistoryPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('attendance')

  useEffect(() => {
    api.requestOverview().then(setOverview).catch((e) => setError(e.message))
  }, [])

  if (!overview) return (
    <Shell>
      {error ? <ErrorNote message={error} /> : <Loading />}
    </Shell>
  )

  return (
    <Shell header={<EmployeeHeader title="ประวัติ" employee={overview.employee} />}>
      <div role="group" aria-label="เลือกประวัติ" className="mt-6 inline-flex gap-1 rounded-full border border-rq-line bg-rq-card p-1">
        {TABS.map(([key, label]) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(key)}
              className={cx(
                'inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium transition-colors',
                active ? 'bg-rq-ink text-white' : 'text-rq-ink-2 hover:bg-rq-chip',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'attendance' ? <AttendanceHistory /> : <RequestHistory requests={overview.requests} />}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// ประวัติเช็กชื่อรายเดือน
// ---------------------------------------------------------------------------

function AttendanceHistory() {
  const thisMonth = todayISO().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReport(null)
    setError(null)
    api.myReport(month).then((r) => alive && setReport(r)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [month])

  const days = report ? [...report.days].reverse() : []

  return (
    <section aria-labelledby="attendance-title" className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="attendance-title" className="font-display text-xl font-semibold text-rq-ink">{monthLabel(month)}</h2>
        <div className="flex gap-1.5">
          <MonthButton label="เดือนก่อน" icon="left" onClick={() => setMonth(addMonths(month, -1))} />
          <MonthButton label="เดือนถัดไป" icon="right" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))} />
        </div>
      </div>

      {error ? (
        <div className="mt-4"><ErrorNote message={error} /></div>
      ) : !report ? (
        <div className="mt-4"><Loading /></div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="มาทำงาน" value={report.totals.present} unit="วัน" />
            <Stat label="สาย" value={report.totals.late} unit="ครั้ง" />
            <Stat label="ลา" value={report.totals.leave} unit="ครั้ง" />
            <Stat label="ขาด" value={report.totals.absent} unit="ครั้ง" />
          </dl>

          {days.length === 0 ? (
            <Empty title="ยังไม่มีข้อมูลเช็กชื่อในเดือนนี้" body="วันที่มีตารางงานจะแสดงที่นี่" />
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {days.map((day) => (
                <article key={day.date} className="rounded-[18px] border border-rq-line bg-rq-card p-5 sm:p-6">
                  <p className="font-semibold text-rq-ink">{day.date === todayISO() ? `วันนี้ · ${shortWeekdayDate(day.date)}` : shortWeekdayDate(day.date)}</p>
                  <ul className="mt-3 grid gap-3">
                    {day.entries.map((entry) => <ShiftRow key={entry.shiftId} entry={entry} />)}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

const LEAVE_PORTION: Record<LeaveDuration, string> = { full_day: 'เต็มวัน', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }

const hhmm =(t: string | null) => (t ? t.slice(0, 5) : null)

function ShiftRow({ entry }: { entry: ShiftInstance }) {
  const inAt = hhmm(entry.scannedAt)
  const outAt = hhmm(entry.checkedOutAt)
  const early = hhmm(entry.earlyLeaveAt)
  return (
    <li className="flex items-start justify-between gap-3 border-t border-rq-line pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-rq-ink-2">{entry.projectName} · {entry.startTime}–{entry.endTime}</p>
        <p className="mt-0.5 text-sm text-rq-dim">
          {inAt ? `เข้า ${inAt}` : entry.status === 'leave' ? `ลา${LEAVE_PORTION[entry.leavePortion ?? 'full_day']}` : entry.status === 'pending' ? 'ยังไม่ได้เช็กชื่อ' : 'ไม่ได้เช็กชื่อเข้า'}
          {outAt && ` · ออก ${outAt}`}
          {early && ` · แจ้งกลับก่อน ${early}`}
        </p>
      </div>
      <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', SHIFT_STATUS[entry.status])}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {STATUS_LABEL[entry.status]}
      </span>
    </li>
  )
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-2xl border border-rq-line bg-rq-card px-4 py-3">
      <dt className="text-sm text-rq-dim">{label}</dt>
      <dd className="mt-0.5 font-display text-2xl font-semibold text-rq-ink tabular-nums">
        {value} <span className="text-sm font-normal text-rq-meta">{unit}</span>
      </dd>
    </div>
  )
}

function MonthButton({ label, icon, disabled, onClick }: { label: string; icon: 'left' | 'right'; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-rq-line bg-rq-card text-rq-ink-2 transition-colors hover:border-rq-line-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rq-line"
    >
      <Icon name="chevronRight" className={cx('size-5', icon === 'left' && 'rotate-180')} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// ประวัติคำขอ
// ---------------------------------------------------------------------------

function RequestHistory({ requests }: { requests: UnifiedRequest[] }) {
  return (
    <section aria-labelledby="request-history-title" className="mt-6">
      <h2 id="request-history-title" className="font-display text-xl font-semibold text-rq-ink">คำขอทั้งหมด</h2>
      {requests.length === 0 ? (
        <Empty title="ยังไม่มีคำขอ" body="คำขอที่ยื่นแล้วจะแสดงที่นี่" />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3">
          {requests.map((request) => {
            const status = REQUEST_STATUS[request.status]
            const detail = request.kind === 'leave' ? request.reason : request.taskDescription
            return (
              <article key={`${request.kind}-${request.id}`} className="rounded-[18px] border border-rq-line bg-rq-card p-5 sm:p-6">
                <div className="flex items-start gap-3 sm:gap-4">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-rq-icon-bg text-rq-accent sm:size-11">
                    <Icon name={request.kind === 'leave' ? 'calendar' : 'pin'} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="pt-0.5 font-semibold text-rq-ink">{dateLabelOf(request)}</p>
                      <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', status.className)}>
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-rq-ink-2">{typeLabelOf(request)}</p>
                    {detail && <p className="mt-1.5 text-sm leading-relaxed break-words text-rq-dim">{detail}</p>}
                    <p className="mt-2 text-xs text-rq-meta">ยื่นเมื่อ {shortDate(bangkok(new Date(request.createdAt)).date)}</p>
                    {request.status === 'rejected' && request.rejectReason && (
                      <p className="mt-3 rounded-xl bg-rq-note-bg px-3 py-2 text-sm leading-relaxed text-rq-rejected-ink">หัวหน้าแจ้ง: {request.rejectReason}</p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 flex flex-col items-center rounded-[18px] border border-dashed border-rq-line px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-rq-chip text-rq-dim"><Icon name="inbox" className="size-6" /></span>
      <p className="mt-3 font-medium text-rq-ink">{title}</p>
      <p className="mt-1 text-sm text-rq-dim">{body}</p>
    </div>
  )
}
