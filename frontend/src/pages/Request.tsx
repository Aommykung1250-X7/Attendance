import { useEffect, useId, useRef, useState } from 'react'
import { Button, ErrorNote, Input, Loading, cx } from '../components/ui'
import { EmployeeHeader, Icon, Shell, type IconName } from '../components/EmployeeShell'
import { useNotify } from '../components/notify'
import { api } from '../lib/api'
import { bangkok, shortDate } from '../lib/format'
import { REQUEST_STATUS, dateLabelOf, typeLabelOf } from '../lib/requestLabels'
import type { LeaveDuration, LeaveRequest, LeaveType, ShiftInstance, UnifiedRequest } from '../lib/types'

type Overview = Awaited<ReturnType<typeof api.requestOverview>>

const today = () => {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

type Filter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'
const FILTERS: [Filter, string][] = [['all', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ไม่อนุมัติ'], ['cancelled', 'ยกเลิกแล้ว']]

const isActive = (r: UnifiedRequest) => r.status === 'pending' || r.status === 'approved'

/** กะของวันนี้ที่ยังไม่มีคำขอลาหรือทำงานนอกสถานที่ค้างอยู่ (backend จะปฏิเสธกะที่ทับอยู่แล้ว) */
function openShifts(shifts: ShiftInstance[], requests: UnifiedRequest[], date: string) {
  return shifts.filter((s) => !requests.some((r) => isActive(r) && (r.kind === 'offsite'
    ? r.shiftId === s.shiftId && r.date === date
    : r.days?.some((d) => d.shiftId === s.shiftId && d.date === date))))
}

export default function RequestPage() {
  const notify = useNotify()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'leave' | 'offsite' | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [cancelTarget, setCancelTarget] = useState<UnifiedRequest | null>(null)

  const load = () => api.requestOverview().then(setData).catch((e) => setError(e.message))
  useEffect(() => void load(), [])

  if (!data) return (
    <Shell>
      {error ? <ErrorNote message={error} /> : <Loading />}
    </Shell>
  )

  const counts: Record<Filter, number> = {
    all: data.requests.length,
    pending: data.requests.filter((r) => r.status === 'pending').length,
    approved: data.requests.filter((r) => r.status === 'approved').length,
    rejected: data.requests.filter((r) => r.status === 'rejected').length,
    cancelled: data.requests.filter((r) => r.status === 'cancelled').length,
  }
  const visible = filter === 'all' ? data.requests : data.requests.filter((r) => r.status === filter)
  const offsiteShifts = openShifts(data.shifts, data.requests, data.date)
  const offsiteBlocked = data.shifts.length === 0 ? 'วันนี้ไม่มีตารางงาน' : offsiteShifts.length === 0 ? 'ยื่นคำขอของวันนี้ครบทุกกะแล้ว' : null

  return (
    <Shell
      header={<EmployeeHeader title="ยื่นคำขอ" employee={data.employee} />}
    >
      {!mode ? (
        <section aria-label="เลือกประเภทคำขอ" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <ChoiceCard
            icon="calendar"
            title="ยื่นลา"
            body="ลาเต็มวัน ครึ่งเช้า ครึ่งบ่าย หรือเลือกช่วงหลายวัน"
            chips={[]}
            onClick={() => setMode('leave')}
          />
          <ChoiceCard
            icon="pin"
            title="ทำงานนอกสถานที่"
            body="สำหรับวันนี้ พร้อมระบุสถานที่และแนบรูปถ่ายหลักฐาน"
            chips={['เฉพาะวันนี้', 'ต้องแนบรูป']}
            blocked={offsiteBlocked}
            onClick={() => setMode('offsite')}
          />
        </section>
      ) : (
        <section className="mt-6 rounded-[18px] border border-rq-line bg-rq-card p-5 sm:p-6">
          <button type="button" onClick={() => setMode(null)} className="min-h-11 text-sm font-medium text-brand">← กลับไปเลือกประเภท</button>
          {mode === 'leave' ? (
            <LeaveForm busy={busy} setBusy={setBusy} onDone={() => { setMode(null); load() }} />
          ) : (
            <OffsiteForm shifts={offsiteShifts} busy={busy} setBusy={setBusy} onDone={() => { setMode(null); load() }} />
          )}
        </section>
      )}

      <section className="mt-8" aria-labelledby="my-requests-title">
        <h2 id="my-requests-title" className="font-display text-xl font-semibold text-rq-ink">คำขอของฉัน</h2>
        <div className="-mx-6 mt-3 overflow-x-auto [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden">
          <div role="group" aria-label="กรองตามสถานะ" className="flex w-max gap-1.5 px-6 pb-1 sm:px-0">
            {FILTERS.map(([key, label]) => {
              const active = filter === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className={cx(
                    'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors',
                    active ? 'border border-rq-ink bg-rq-ink text-white' : 'border border-rq-line bg-rq-card text-rq-ink-2 hover:border-rq-line-hover',
                  )}
                >
                  {label}
                  <span className={cx('tabular-nums', active ? 'text-white/85' : 'text-rq-dim')}>{counts[key]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="mt-3 flex flex-col items-center rounded-[18px] border border-dashed border-rq-line px-6 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-[14px] bg-rq-chip text-rq-dim"><Icon name="inbox" className="size-6" /></span>
            <p className="mt-3 font-medium text-rq-ink">ไม่มีคำขอในหมวดนี้</p>
            <p className="mt-1 text-sm text-rq-dim">คำขอที่ยื่นแล้วจะแสดงที่นี่</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {visible.map((request) => (
              <RequestCard
                key={`${request.kind}-${request.id}`}
                request={request}
                onChanged={load}
                onCancel={() => setCancelTarget(request)}
                onError={(message) => notify.toast(message, { tone: 'error' })}
              />
            ))}
          </div>
        )}
      </section>

      {cancelTarget && (
        <CancelDialog
          request={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={async () => {
            await api.cancelRequest(cancelTarget.kind, cancelTarget.id)
            setCancelTarget(null)
            notify.toast('ยกเลิกคำขอแล้ว')
            load()
          }}
        />
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// การ์ดเลือกประเภทคำขอ
// ---------------------------------------------------------------------------

function ChoiceCard({ icon, title, body, chips, blocked, onClick }: { icon: IconName; title: string; body: string; chips: string[]; blocked?: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!blocked}
      className="group flex w-full min-w-0 items-center gap-3.5 rounded-[18px] border border-rq-line bg-rq-card p-5 text-left transition duration-200 enabled:hover:-translate-y-px enabled:hover:border-rq-line-hover enabled:hover:shadow-[0_6px_18px_-8px_rgba(43,35,32,0.18)] disabled:cursor-not-allowed sm:items-start sm:gap-4 sm:p-6"
    >
      <span aria-hidden className={cx('grid size-12 shrink-0 place-items-center rounded-[14px]', blocked ? 'bg-rq-chip text-rq-meta' : 'bg-rq-icon-bg text-rq-accent')}>
        <Icon name={icon} className="size-6" />
      </span>
      <span className="min-w-0 flex-auto">
        <span className={cx('block font-display text-lg leading-snug font-semibold', blocked ? 'text-rq-dim' : 'text-rq-ink')}>{title}</span>
        <span className="mt-0.5 block truncate text-sm leading-relaxed text-rq-dim sm:mt-1 sm:whitespace-normal">{body}</span>
        {(blocked || chips.length > 0) && (
          <span className="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
            {blocked ? (
              <span className="rounded-full bg-rq-pending-bg px-2.5 py-1 text-xs font-medium text-rq-pending-ink">{blocked}</span>
            ) : chips.map((chip) => (
              <span key={chip} className="rounded-full bg-rq-chip px-2.5 py-1 text-xs font-medium text-rq-ink-2">{chip}</span>
            ))}
          </span>
        )}
      </span>
      {!blocked && <Icon name="chevronRight" className="size-5 shrink-0 self-center text-rq-meta transition-transform group-hover:translate-x-0.5" />}
    </button>
  )
}

function LeaveForm({ busy, setBusy, onDone }: { busy: boolean; setBusy: (x: boolean) => void; onDone: () => void }) {
  const notify = useNotify()
  const minDate = today()
  const [startDate, setStartDate] = useState(minDate)
  const [endDate, setEndDate] = useState(minDate)
  const [duration, setDuration] = useState<LeaveDuration>('full_day')
  const [leaveType, setLeaveType] = useState<LeaveType>('sick')
  const [reason, setReason] = useState('')
  const [pendingDocument, setPendingDocument] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const multiple = endDate !== startDate
  const effectiveDuration = multiple ? 'full_day' : duration

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!startDate || !endDate) return notify.toast('กรุณาเลือกวันเริ่มและวันสิ้นสุด', { tone: 'error' })
    if (startDate < minDate) return notify.toast('ยื่นลาย้อนหลังไม่ได้ เลือกวันนี้หรือวันถัดไป', { tone: 'error' })
    if (endDate < startDate) return notify.toast('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม', { tone: 'error' })
    const trimmedReason = reason.trim()
    if (!trimmedReason) return notify.toast('กรุณาระบุเหตุผล', { tone: 'error' })
    if (leaveType === 'sick' && !file && !pendingDocument)
      return notify.toast('กรุณาแนบใบรับรองแพทย์ หรือเลือกว่าจะนำมาส่งภายหลัง', { tone: 'error' })
    setBusy(true)
    try {
      const values: Record<string, string> = {
        startDate,
        endDate,
        duration: effectiveDuration,
        leaveType,
        reason: trimmedReason,
        medicalCertificatePending: String(leaveType === 'sick' && pendingDocument),
      }
      if (leaveType === 'sick' && file) {
        const form = new FormData()
        Object.entries(values).forEach(([key, value]) => form.append(key, value))
        form.append('file', file)
        await api.submitLeaveRequest(form)
      } else await api.submitLeaveRequest(values)
      notify.toast('ส่งคำขอลาแล้ว รอแอดมินพิจารณา')
      onDone()
    } catch (e) {
      notify.toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <h2 className="display text-2xl font-semibold">ยื่นลา</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">วันเริ่ม<input className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2" type="date" min={minDate} value={startDate} onChange={(e) => { const next = e.target.value; setStartDate(next); if (next) setEndDate((end) => (!end || end < next ? next : end)) }} /></label>
        <label className="text-sm font-medium">วันสิ้นสุด<input className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      </div>
      {!multiple && (
        <RadioRow name="duration" label="ช่วงเวลา" value={duration} setValue={(x) => setDuration(x as LeaveDuration)} options={[['full_day', 'เต็มวัน'], ['morning', 'ครึ่งเช้า'], ['afternoon', 'ครึ่งบ่าย']]} />
      )}
      <RadioRow name="leaveType" label="ประเภทลา" value={leaveType} setValue={(x) => { const next = x as LeaveType; setLeaveType(next); if (next === 'personal') { setFile(null); setPendingDocument(false) } }} options={[['sick', 'ลาป่วย'], ['personal', 'ลากิจ']]} />
      <label className="block text-sm font-medium">เหตุผล<textarea required maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper p-3" /></label>
      {leaveType === 'sick' && (
        <div className="rounded-xl border border-rule p-3">
          <FilePicker label="ใบรับรองแพทย์" hint="รองรับ PDF, JPEG และ PNG" accept=".pdf,.jpg,.jpeg,.png" file={file} onChange={setFile} />
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={pendingDocument} onChange={(e) => setPendingDocument(e.target.checked)} disabled={!!file} /> จะนำใบรับรองแพทย์มาส่งภายหลัง</label>
        </div>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'กำลังส่ง' : 'ส่งคำขอลา'}</Button>
    </form>
  )
}

function RadioRow({ name: group, label, value, setValue, options }: { name: string; label: string; value: string; setValue: (x: string) => void; options: [string, string][] }) {
  return <fieldset><legend className="text-sm font-medium">{label}</legend><div className="mt-2 flex flex-wrap gap-2">{options.map(([v, name]) => <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand/20 ${value === v ? 'border-brand bg-brand/5 text-brand' : 'border-rule'}`}><input className="sr-only" type="radio" name={group} value={v} checked={value === v} onChange={() => setValue(v)} />{name}</label>)}</div></fieldset>
}

function OffsiteForm({ shifts, busy, setBusy, onDone }: { shifts: ShiftInstance[]; busy: boolean; setBusy: (x: boolean) => void; onDone: () => void }) {
  const notify = useNotify()
  const [shiftId, setShiftId] = useState(shifts[0]?.shiftId ?? '')
  const [task, setTask] = useState('')
  const [place, setPlace] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!task.trim()) return notify.toast('กรุณาระบุสิ่งที่จะทำ', { tone: 'error' })
    if (!place.trim()) return notify.toast('กรุณาระบุสถานที่', { tone: 'error' })
    if (!file) return notify.toast('กรุณาแนบรูปถ่าย', { tone: 'error' })
    setBusy(true)
    try {
      const form = new FormData()
      form.append('shiftId', shiftId)
      form.append('taskDescription', task.trim())
      form.append('locationName', place.trim())
      form.append('photo', file)
      await api.submitRequestOffsite(form)
      notify.toast('ส่งคำขอทำงานนอกสถานที่แล้ว')
      onDone()
    } catch (e) {
      notify.toast((e as Error).message, { tone: 'error' })
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <h2 className="display text-2xl font-semibold">ขอทำงานนอกสถานที่</h2>
      {shifts.length === 0 ? <ErrorNote message="วันนี้ไม่มีตารางงาน" /> : <>
        <label className="block text-sm font-medium">กะ<select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2">{shifts.map((s) => <option key={s.shiftId} value={s.shiftId}>{s.projectName} {s.startTime}–{s.endTime}</option>)}</select></label>
        <label className="block text-sm font-medium">สิ่งที่จะทำ<textarea required rows={3} value={task} onChange={(e) => setTask(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper p-3" /></label>
        <label className="block text-sm font-medium">สถานที่<Input required value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1" /></label>
        <FilePicker label="รูปถ่ายหลักฐาน" hint="รองรับ JPEG, PNG และ WebP" accept=".jpg,.jpeg,.png,.webp" file={file} onChange={setFile} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'กำลังส่ง' : 'ส่งคำขอ'}</Button>
      </>}
    </form>
  )
}

// ตรงกับ limits.fileSize ของ @fastify/multipart ใน backend/src/app.ts
const MAX_FILE_BYTES = 5 * 1024 * 1024

function FilePicker({ label, hint, accept, file, onChange }: { label: string; hint: string; accept: string; file: File | null; onChange: (file: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const next = input.files?.[0] ?? null
    // ล้างค่า เพื่อให้เลือกไฟล์เดิมซ้ำได้หลังลบหรือถูกปฏิเสธ
    input.value = ''
    if (!next) return
    const ext = next.name.split('.').pop()?.toLowerCase() ?? ''
    const allowed = accept.split(',').map((x) => x.trim().replace(/^\./, '').toLowerCase())
    if (!allowed.includes(ext)) return setError(`ชนิดไฟล์ไม่ถูกต้อง ${hint}`)
    if (next.size > MAX_FILE_BYTES) return setError('ไฟล์ใหญ่เกิน 5 MB')
    setError(null)
    onChange(next)
  }
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <label
          className={cx(
            'block min-w-0 flex-1 cursor-pointer rounded-xl border bg-paper px-4 py-3 transition focus-within:ring-2',
            error
              ? 'border-rq-rejected-ink focus-within:ring-rq-rejected-ink/20'
              : cx(file ? 'border-rq-line' : 'border-dashed border-rq-line', 'hover:border-rq-line-hover focus-within:border-rq-ink-2 focus-within:ring-rq-ink/10'),
          )}
        >
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-1 block break-all text-[13px] text-text-dim">{file ? file.name : `${hint} · ไม่เกิน 5 MB · กดเพื่อเลือกไฟล์`}</span>
          <input className="sr-only" type="file" accept={accept} onChange={pick} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
        </label>
        {file && <Button size="sm" className="self-center" onClick={() => { setError(null); onChange(null) }}>ลบไฟล์</Button>}
      </div>
      {error && <p id={errorId} role="alert" className="mt-1.5 text-sm text-rq-rejected-ink">{error}</p>}
    </div>
  )
}

function RequestCard({ request, onChanged, onCancel, onError }: { request: UnifiedRequest; onChanged: () => void; onCancel: () => void; onError: (m: string) => void }) {
  const status = REQUEST_STATUS[request.status]
  const detail = request.kind === 'leave' ? request.reason : request.taskDescription
  return (
    <article className="rounded-[18px] border border-rq-line bg-rq-card p-5 sm:p-6">
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
          {request.kind === 'leave' && request.leaveType === 'sick' && <MedicalCertificate request={request} onChanged={onChanged} onError={onError} />}
          {request.status === 'pending' && (
            <button type="button" onClick={onCancel} className="-ml-1 mt-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-rq-dim underline-offset-4 transition-colors hover:text-rq-accent hover:underline">
              ยกเลิกคำขอ
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

/** สถานะใบรับรองแพทย์บนการ์ดลาป่วย: แนบแล้ว (เปิดดูได้) · รอส่ง (แนบได้ทันที) */
function MedicalCertificate({ request, onChanged, onError }: { request: LeaveRequest; onChanged: () => void; onError: (m: string) => void }) {
  const notify = useNotify()
  const [uploading, setUploading] = useState(false)
  if (request.medicalCertificatePath) return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-rq-approved-bg px-3 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rq-approved-ink">
        <Icon name="paperclip" className="size-4" />
        แนบใบรับรองแพทย์แล้ว
      </span>
      <a className="inline-flex min-h-11 items-center text-sm font-medium text-rq-approved-ink underline underline-offset-4" target="_blank" rel="noreferrer" href={request.medicalCertificatePath}>เปิดดู</a>
    </div>
  )
  if (!request.medicalCertificatePending) return null
  return (
    <div className="mt-3">
      <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-rq-pending-bg px-2.5 py-1 text-xs font-semibold text-rq-pending-ink">รอส่งใบรับรองแพทย์</p>
      <FilePicker
        label={uploading ? 'กำลังอัปโหลด' : 'แนบใบรับรองแพทย์'}
        hint="รองรับ PDF, JPEG และ PNG"
        accept=".pdf,.jpg,.jpeg,.png"
        file={null}
        onChange={async (file) => {
          if (!file || uploading) return
          setUploading(true)
          try {
            await api.uploadMedicalCertificate(request.id, file)
            notify.toast('แนบใบรับรองแพทย์แล้ว')
            onChanged()
          } catch (err) {
            onError((err as Error).message)
          } finally {
            setUploading(false)
          }
        }}
      />
    </div>
  )
}

function CancelDialog({ request, onClose, onConfirm }: { request: UnifiedRequest; onClose: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const bodyId = useId()

  // showModal ทำให้ส่วนอื่นของหน้ากดไม่ได้และ focus วนอยู่ในกล่อง
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    backRef.current?.focus()
  }, [])

  const close = () => { if (!busy) onClose() }
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError((e as Error).message || 'ยกเลิกไม่สำเร็จ ลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => { e.preventDefault(); close() }}
      onClick={(e) => e.target === ref.current && close()}
      className="m-auto w-[calc(100%-3rem)] max-w-[420px] rounded-[18px] border border-rq-line bg-rq-card p-0 text-rq-ink shadow-xl backdrop:bg-rq-ink/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="font-display text-xl font-semibold text-rq-ink">ยกเลิกคำขอนี้?</h2>
        <div id={bodyId} className="mt-2 space-y-1 text-[15px] leading-relaxed">
          <p className="font-medium text-rq-ink-2">{typeLabelOf(request)} · {dateLabelOf(request)}</p>
          <p className="text-rq-dim">หากต้องการ ต้องยื่นคำขอใหม่อีกครั้ง</p>
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rq-note-bg px-3 py-2 text-sm text-rq-rejected-ink">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={backRef} type="button" onClick={close} disabled={busy} className="min-h-11 rounded-full border border-rq-line bg-rq-card px-5 font-medium text-rq-ink transition-colors hover:bg-rq-chip disabled:opacity-60">
            กลับ
          </button>
          <button type="button" onClick={confirm} disabled={busy} className="min-h-11 rounded-full bg-rq-accent px-5 font-medium text-white transition-colors hover:bg-[#9a1f18] disabled:opacity-60">
            {busy ? 'กำลังยกเลิก' : 'ยืนยันยกเลิก'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
