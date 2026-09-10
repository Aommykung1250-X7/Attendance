// บันทึกประจำวัน (spec 9.6) — หน้าที่พี่แอดมินจะใช้บ่อยที่สุด
// เปิดมาเห็นทันทีว่าใครมาแล้ว ใครยังไม่มา กดลา กดเช็กชื่อแทน กดแจ้งกลับก่อนแทน และแก้ย้อนหลังได้

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { addDays, displayName, nowHHMM, stamp, todayISO } from '../../lib/format'
import { type AdminAction, type AuditEntry, type DayLog, type DayLogRow, type OverrideStatus, type ShiftStatus } from '../../lib/types'
import { StatusPill } from '../../components/StatusPill'
import { Button, Dialog, Empty, ErrorNote, Input, Loading, PageHeader, Textarea, Toast, cx } from '../../components/ui'

type Filter = 'all' | 'arrived' | ShiftStatus

export default function Today() {
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? todayISO()
  const [log, setLog] = useState<DayLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<DayLogRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .day(date)
      .then((l) => {
        setLog(l)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [date])

  useEffect(() => {
    setLog(null)
    load()
  }, [load])

  // วันนี้: ดึงใหม่ทุก 30 วินาทีเพื่อให้เห็นคนที่เพิ่งสแกน (หยุดตอนเปิดหน้าต่างจัดการอยู่)
  useEffect(() => {
    if (!log?.isToday || open) return
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [log?.isToday, open, load])

  const setDate = (d: string) => setParams(d === todayISO() ? {} : { date: d })

  const rows = useMemo(() => {
    if (!log) return []
    const q = search.trim().toLowerCase()
    return log.rows.filter((r) => {
      if (q && !`${r.nickname} ${r.gen ?? ''} ${r.projectName}`.toLowerCase().includes(q)) return false
      if (filter === 'all') return true
      if (filter === 'arrived') return r.status === 'ontime' || r.status === 'late'
      return r.status === filter
    })
  }, [log, filter, search])

  const groups = useMemo(() => {
    const m = new Map<string, DayLogRow[]>()
    for (const r of rows) m.set(r.startTime, [...(m.get(r.startTime) ?? []), r])
    return [...m.entries()]
  }, [rows])

  const onSaved = (row: DayLogRow, message: string) => {
    setLog((l) => (l ? { ...l, rows: l.rows.map((r) => (r.shiftId === row.shiftId ? row : r)) } : l))
    setOpen(null)
    setToast(message)
    load()
  }

  return (
    <>
      <PageHeader
        title="บันทึกประจำวัน"
        sub={log ? `${log.dateLabel}${log.isToday ? ' · วันนี้' : ''}` : ' '}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" aria-label="วันก่อนหน้า" onClick={() => setDate(addDays(date, -1))}>
              ‹
            </Button>
            <Input type="date" value={date} max={addDays(todayISO(), 60)} onChange={(e) => e.target.value && setDate(e.target.value)} className="min-h-9 w-[10.5rem] text-sm" />
            <Button size="sm" variant="secondary" aria-label="วันถัดไป" onClick={() => setDate(addDays(date, 1))}>
              ›
            </Button>
            {date !== todayISO() && (
              <Button size="sm" variant="primary" onClick={() => setDate(todayISO())}>
                วันนี้
              </Button>
            )}
          </div>
        }
      />

      {error && <ErrorNote message={error} onRetry={load} />}
      {!log && !error && <Loading />}

      {log && log.holiday && (
        <div className="rounded-xl border border-rule bg-surface">
          <Empty title={`วันหยุด: ${log.holiday}`} body="วันนี้ไม่นับการเช็กชื่อของใคร ถ้าไม่ใช่วันหยุด ลบได้ที่หน้าตั้งค่า" />
        </div>
      )}

      {log && !log.holiday && (
        <>
          {!log.isToday && date < todayISO() && (
            <p className="mb-4 rounded-lg bg-late-bg px-4 py-2.5 text-[15px] text-late">กำลังดูวันที่ผ่านมาแล้ว การแก้ในหน้านี้คือการแก้ย้อนหลัง และจะถูกบันทึกว่าใครแก้</p>
          )}
          <Summary log={log} filter={filter} setFilter={setFilter} />

          <div className="mt-6 mb-3 flex flex-wrap items-center gap-3">
            <Input placeholder="ค้นหาชื่อหรือโปรเจก" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-10 max-w-xs text-sm" />
            {filter !== 'all' && (
              <button className="text-sm text-text-dim underline underline-offset-4" onClick={() => setFilter('all')}>
                แสดงทั้งหมด
              </button>
            )}
          </div>

          {log.rows.length === 0 ? (
            <div className="rounded-xl border border-rule bg-surface">
              <Empty title="วันนี้ไม่มีใครมีตารางงาน" body="เพิ่มคนเข้าโปรเจกหรือนำเข้าตารางจาก Excel เพื่อให้มีรายชื่อในหน้านี้" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-text-dim">ไม่มีรายชื่อที่ตรงกับตัวกรอง</p>
          ) : (
            <div className="space-y-6">
              {groups.map(([start, list]) => (
                <section key={start} className="overflow-hidden rounded-xl border border-rule bg-surface">
                  <header className="flex items-baseline gap-3 border-b border-rule bg-sunken/60 px-4 py-2.5">
                    <h2 className="display tnum text-[17px] font-semibold">เข้า {start}</h2>
                    <span className="text-sm text-text-dim">{list.length} คน</span>
                  </header>
                  <ul className="divide-y divide-rule">
                    {list.map((r) => (
                      <Row key={r.shiftId} row={r} onOpen={() => setOpen(r)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {open && log && <ActionDialog row={open} date={log.date} isToday={log.isToday} onClose={() => setOpen(null)} onSaved={onSaved} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}

function Summary({ log, filter, setFilter }: { log: DayLog; filter: Filter; setFilter: (f: Filter) => void }) {
  const s = log.summary
  const cells: { key: Filter; label: string; n: number; tone?: string }[] = [
    { key: 'all', label: 'ต้องมา', n: s.expected },
    { key: 'arrived', label: 'มาแล้ว', n: s.arrived, tone: 'text-ontime' },
    { key: 'late', label: 'สาย', n: s.late, tone: 'text-late' },
    { key: 'pending', label: 'ยังไม่มา', n: s.pending, tone: 'text-pending' },
    { key: 'leave', label: 'ลา', n: s.leave, tone: 'text-leave' },
    { key: 'absent', label: 'ขาด', n: s.absent, tone: 'text-absent' },
  ]
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-6">
      {cells.map((c) => (
        <button
          key={c.key}
          onClick={() => setFilter(filter === c.key ? 'all' : c.key)}
          aria-pressed={filter === c.key}
          className={cx('bg-surface px-4 py-3.5 text-left transition-colors hover:bg-sunken', filter === c.key && c.key !== 'all' && 'bg-sunken shadow-[inset_0_-2px_0_var(--color-ink)]')}
        >
          <span className={cx('display tnum block text-[28px] leading-none font-semibold', c.n > 0 && c.tone)}>{c.n}</span>
          <span className="mt-1.5 block text-[13px] text-text-dim">{c.label}</span>
        </button>
      ))}
    </div>
  )
}

function Row({ row: r, onOpen }: { row: DayLogRow; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-sunken/70 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_6.5rem]">
        <span className="min-w-0">
          <span className="text-[16px] font-medium">{r.nickname}</span>
          {r.gen && <span className="ml-2 text-sm text-text-dim">{r.gen}</span>}
          <span className="mt-0.5 block truncate text-[13px] text-text-dim sm:hidden">
            {r.projectName} · {r.startTime}–{r.endTime}
          </span>
        </span>
        <span className="hidden min-w-0 truncate text-sm text-text-dim sm:block">
          {r.projectName} · <span className="tnum">{r.startTime}–{r.endTime}</span>
        </span>
        <span className="tnum col-start-1 row-start-2 text-sm sm:col-start-auto sm:row-start-auto">
          {r.scannedAt ? (
            <>
              {r.scannedAt.slice(0, 5)}
              {r.recordedBy === 'admin' && <span className="ml-1.5 text-[12px] text-text-dim">แอดมินกด</span>}
            </>
          ) : (
            <span className="text-text-dim">—</span>
          )}
          {r.earlyLeaveAt && <span className="ml-2 text-[12px] text-late">กลับ {r.earlyLeaveAt.slice(0, 5)}</span>}
        </span>
        <span className="row-span-2 flex flex-col items-end gap-1 sm:row-span-1">
          <StatusPill status={r.status} />
          {(r.overridden || r.historyCount > 0) && <span className="text-[11px] text-text-dim">{r.overridden ? 'แก้โดยแอดมิน' : `แก้ ${r.historyCount} ครั้ง`}</span>}
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// หน้าต่างจัดการรายกะ
// ---------------------------------------------------------------------------

const STATUS_CHOICES: { value: OverrideStatus; label: string; match: ShiftStatus }[] = [
  { value: 'present', label: 'ปกติ', match: 'ontime' },
  { value: 'late', label: 'สาย', match: 'late' },
  { value: 'leave', label: 'ลา', match: 'leave' },
  { value: 'absent', label: 'ขาด', match: 'absent' },
]

function ActionDialog({
  row,
  date,
  isToday,
  onClose,
  onSaved,
}: {
  row: DayLogRow
  date: string
  isToday: boolean
  onClose: () => void
  onSaved: (row: DayLogRow, message: string) => void
}) {
  // ค่าเริ่มต้นคือเวลาปัจจุบัน (วันนี้) หรือเวลาเริ่มกะ (วันที่ผ่านมา) แอดมินแก้เป็นเวลาที่มาถึงจริงได้
  const [checkinTime, setCheckinTime] = useState(isToday ? nowHHMM() : row.startTime)
  const [leaveTime, setLeaveTime] = useState(isToday ? nowHHMM() : row.endTime)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AuditEntry[] | null>(null)
  const name = displayName(row)

  useEffect(() => {
    api.history(row.shiftId, date).then(setHistory).catch(() => setHistory([]))
  }, [row.shiftId, date])

  async function act(action: AdminAction, message: string) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.adminAction(row.shiftId, date, { ...action, note: note.trim() || undefined } as AdminAction)
      onSaved(updated, message)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const arrived = !!row.scannedAt
  return (
    <Dialog open onClose={onClose} wide title={
      <>
        {name}
        <span className="mt-0.5 block text-sm font-normal text-text-dim">
          {row.projectName} · กะ {row.startTime}–{row.endTime}
        </span>
      </>
    }>
      {/* สถานะตอนนี้ */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-sunken px-4 py-3 text-[15px]">
        <StatusPill status={row.status} />
        <span>
          เข้า{' '}
          <span className="tnum font-medium">{row.scannedAt ?? '—'}</span>
          {row.recordedBy === 'admin' && <span className="ml-1 text-text-dim">(แอดมินกดแทน)</span>}
          {row.recordedBy === 'self' && <span className="ml-1 text-text-dim">(สแกนเอง)</span>}
        </span>
        {row.earlyLeaveAt && (
          <span className="text-late">
            กลับก่อน <span className="tnum font-medium">{row.earlyLeaveAt}</span>
          </span>
        )}
        {row.overridden && <span className="text-text-dim">สถานะถูกแก้โดยแอดมิน{row.adminNote ? `: ${row.adminNote}` : ''}</span>}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="note">
          หมายเหตุ <span className="font-normal text-text-dim">(ไม่บังคับ บันทึกไว้กับทุกการกด)</span>
        </label>
        <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โทรมาแจ้งลา / ลืมมือถือ" className="mt-1.5 min-h-16" />
      </div>

      <div className="mt-5 space-y-4">
        {!arrived && (
          <ActionLine label="เช็กชื่อแทน" hint="สำหรับคนที่ลืมมือถือหรือแบตหมด ใส่เวลาที่มาถึงจริง">
            <Input type="time" value={checkinTime} onChange={(e) => setCheckinTime(e.target.value)} className="w-32" />
            <Button variant="primary" disabled={busy || !checkinTime} onClick={() => act({ action: 'checkin', time: checkinTime }, `บันทึกว่า ${name} มาเวลา ${checkinTime}`)}>
              บันทึกเช็กชื่อ
            </Button>
          </ActionLine>
        )}

        {arrived && !row.earlyLeaveAt && (
          <ActionLine label="แจ้งกลับก่อนเวลาแทน" hint="สถานะหลักไม่เปลี่ยน แต่จะมีธงว่ากลับก่อนเวลา">
            <Input type="time" value={leaveTime} onChange={(e) => setLeaveTime(e.target.value)} className="w-32" />
            <Button disabled={busy || !leaveTime} onClick={() => act({ action: 'early_leave', time: leaveTime }, `บันทึกว่า ${name} กลับก่อนเวลา ${leaveTime}`)}>
              บันทึกกลับก่อน
            </Button>
          </ActionLine>
        )}

        <ActionLine label="แก้สถานะเป็น" hint={date < todayISO() ? 'การแก้ย้อนหลังจะเก็บค่าเดิมไว้ในประวัติ' : 'ใช้ตอนคนโทรมาลา หรือแก้สถานะให้ถูกต้อง'}>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_CHOICES.map((c) => (
              <Button
                key={c.value}
                size="sm"
                variant={row.overridden && row.status === c.match ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => act({ action: 'set_status', status: c.value }, `แก้สถานะ ${name} เป็น ${c.label}`)}
                className="min-w-16"
              >
                {c.label}
              </Button>
            ))}
          </div>
        </ActionLine>

        {(row.overridden || row.earlyLeaveAt || row.recordedBy === 'admin') && (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            {row.overridden && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: 'clear_status' }, `ล้างสถานะที่แก้ของ ${name}`)}>
                ล้างสถานะที่แก้ (กลับไปใช้ค่าที่คำนวณ)
              </Button>
            )}
            {row.earlyLeaveAt && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: 'clear_early_leave' }, `ล้างการกลับก่อนของ ${name}`)}>
                ล้างการแจ้งกลับก่อน
              </Button>
            )}
            {row.recordedBy === 'admin' && (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act({ action: 'undo_checkin' }, `ยกเลิกการเช็กชื่อแทนของ ${name}`)}>
                ยกเลิกการเช็กชื่อที่กดแทน
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-rule pt-4">
        <h3 className="text-sm font-medium">ประวัติการแก้ของกะนี้</h3>
        {!history ? (
          <p className="mt-2 text-sm text-text-dim">กำลังโหลด</p>
        ) : history.length === 0 ? (
          <p className="mt-2 text-sm text-text-dim">ยังไม่มีใครแก้</p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {history.map((h) => (
              <li key={h.id} className="text-sm leading-relaxed">
                <span className="font-medium">{h.label}</span>
                {h.before && h.after && h.before !== h.after && (
                  <span className="text-text-dim">
                    {' '}
                    · {h.before} → {h.after}
                  </span>
                )}
                {h.note && <span className="block text-text-dim">“{h.note}”</span>}
                <span className="block text-[12px] text-text-dim">
                  {h.adminEmail} · {stamp(h.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  )
}

function ActionLine({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start">
      <div className="pt-2">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-[12px] leading-snug text-text-dim sm:pr-2">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}


