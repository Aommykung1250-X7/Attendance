import { useEffect, useState } from 'react'
import { Button, ErrorNote, Input, Loading } from '../components/ui'
import { useNotify } from '../components/notify'
import { api } from '../lib/api'
import type { LeaveDuration, LeaveType, ShiftInstance, UnifiedRequest } from '../lib/types'

type Overview = Awaited<ReturnType<typeof api.requestOverview>>

const today = () => {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export default function RequestPage() {
  const notify = useNotify()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'leave' | 'offsite' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.requestOverview().then(setData).catch((e) => setError(e.message))
  useEffect(() => void load(), [])

  if (!data && !error) return <main className="mx-auto max-w-[36rem] px-5 py-12"><Loading /></main>
  if (!data) return <main className="mx-auto max-w-[36rem] px-5 py-12"><ErrorNote message={error ?? 'โหลดข้อมูลไม่สำเร็จ'} /></main>

  return (
    <main className="mx-auto min-h-dvh max-w-[40rem] px-5 py-8 pb-16">
      <header className="border-b border-rule pb-5">
        <p className="text-sm font-medium text-text-dim">ระบบเช็กชื่อเข้างาน</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="display text-3xl font-bold">ยื่นคำขอ</h1>
          <span className="rounded-full border border-rule bg-surface px-3 py-1 text-sm font-medium">{data.employee.nickname}</span>
        </div>
      </header>

      {!mode ? (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Choice title="ยื่นลา" body="ลาเต็มวัน ครึ่งเช้า ครึ่งบ่าย หรือเลือกช่วงหลายวัน" onClick={() => setMode('leave')} />
          <Choice title="ทำงานนอกสถานที่" body="สำหรับวันนี้ พร้อมรูปถ่ายและพิกัดสถานที่ทำงาน" onClick={() => setMode('offsite')} />
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-rule bg-surface p-5">
          <button type="button" onClick={() => setMode(null)} className="text-sm font-medium text-brand">← กลับไปเลือกประเภท</button>
          {mode === 'leave' ? (
            <LeaveForm busy={busy} setBusy={setBusy} onDone={() => { setMode(null); load() }} />
          ) : (
            <OffsiteForm shifts={data.shifts} busy={busy} setBusy={setBusy} onDone={() => { setMode(null); load() }} />
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="display text-xl font-semibold">คำขอของฉัน</h2>
        {data.requests.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-rule p-6 text-center text-text-dim">ยังไม่มีคำขอ</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {data.requests.map((request) => (
              <RequestCard
                key={`${request.kind}-${request.id}`}
                request={request}
                onChanged={load}
                onError={(message) => notify.toast(message, { tone: 'error' })}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function Choice({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-rule bg-surface p-5 text-left transition hover:border-brand hover:shadow-sm">
      <span className="display text-xl font-semibold">{title}</span>
      <span className="mt-2 block text-sm leading-relaxed text-text-dim">{body}</span>
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
    if (endDate < startDate) return notify.toast('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม', { tone: 'error' })
    setBusy(true)
    try {
      const values: Record<string, string> = {
        startDate,
        endDate,
        duration: effectiveDuration,
        leaveType: effectiveDuration === 'full_day' ? leaveType : '',
        reason,
        medicalCertificatePending: String(effectiveDuration === 'full_day' && leaveType === 'sick' && pendingDocument),
      }
      if (file) {
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
    <form onSubmit={submit} className="mt-4 space-y-4">
      <h2 className="display text-2xl font-semibold">ยื่นลา</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">วันเริ่ม<input className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2" type="date" min={minDate} value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value) }} /></label>
        <label className="text-sm font-medium">วันสิ้นสุด<input className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      </div>
      {!multiple && (
        <RadioRow label="ช่วงเวลา" value={duration} setValue={(x) => setDuration(x as LeaveDuration)} options={[['full_day', 'เต็มวัน'], ['morning', 'ครึ่งเช้า'], ['afternoon', 'ครึ่งบ่าย']]} />
      )}
      {effectiveDuration === 'full_day' && (
        <RadioRow label="ประเภทลา" value={leaveType} setValue={(x) => setLeaveType(x as LeaveType)} options={[['sick', 'ลาป่วย'], ['personal', 'ลากิจ']]} />
      )}
      <label className="block text-sm font-medium">เหตุผล<textarea required maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper p-3" /></label>
      {effectiveDuration === 'full_day' && leaveType === 'sick' && (
        <div className="rounded-xl border border-rule p-3">
          <label className="block text-sm font-medium">ใบรับรองแพทย์<input className="mt-2 block w-full text-sm" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={pendingDocument} onChange={(e) => setPendingDocument(e.target.checked)} disabled={!!file} /> จะนำใบรับรองแพทย์มาส่งภายหลัง</label>
        </div>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'กำลังส่ง' : 'ส่งคำขอลา'}</Button>
    </form>
  )
}

function RadioRow({ label, value, setValue, options }: { label: string; value: string; setValue: (x: string) => void; options: [string, string][] }) {
  return <fieldset><legend className="text-sm font-medium">{label}</legend><div className="mt-2 flex flex-wrap gap-2">{options.map(([v, name]) => <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${value === v ? 'border-brand bg-brand/5 text-brand' : 'border-rule'}`}><input className="sr-only" type="radio" checked={value === v} onChange={() => setValue(v)} />{name}</label>)}</div></fieldset>
}

function OffsiteForm({ shifts, busy, setBusy, onDone }: { shifts: ShiftInstance[]; busy: boolean; setBusy: (x: boolean) => void; onDone: () => void }) {
  const notify = useNotify()
  const [shiftId, setShiftId] = useState(shifts[0]?.shiftId ?? '')
  const [task, setTask] = useState('')
  const [place, setPlace] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [locating, setLocating] = useState(false)

  const locate = () => {
    setLocating(true)
    navigator.geolocation?.getCurrentPosition(
      (p) => { setPosition(p); setLocating(false) },
      () => { setLocating(false); notify.toast('กรุณาเปิดตำแหน่งบนโทรศัพท์แล้วลองใหม่', { tone: 'error' }) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!position) return notify.toast('กรุณาแชร์ตำแหน่งสถานที่ทำงาน', { tone: 'error' })
    if (!file) return notify.toast('กรุณาแนบรูปถ่าย', { tone: 'error' })
    setBusy(true)
    try {
      const form = new FormData()
      form.append('shiftId', shiftId)
      form.append('taskDescription', task)
      form.append('locationName', place)
      form.append('latitude', String(position.coords.latitude))
      form.append('longitude', String(position.coords.longitude))
      form.append('photo', file)
      await api.submitRequestOffsite(form)
      notify.toast('ส่งคำขอทำงานนอกสถานที่แล้ว')
      onDone()
    } catch (e) {
      notify.toast((e as Error).message, { tone: 'error' })
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <h2 className="display text-2xl font-semibold">ขอทำงานนอกสถานที่</h2>
      {shifts.length === 0 ? <ErrorNote message="วันนี้ไม่มีตารางงาน" /> : <>
        <label className="block text-sm font-medium">กะ<select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper px-3 py-2">{shifts.map((s) => <option key={s.shiftId} value={s.shiftId}>{s.projectName} {s.startTime}–{s.endTime}</option>)}</select></label>
        <label className="block text-sm font-medium">สิ่งที่จะทำ<textarea required rows={3} value={task} onChange={(e) => setTask(e.target.value)} className="mt-1 block w-full rounded-lg border border-rule bg-paper p-3" /></label>
        <label className="block text-sm font-medium">สถานที่<Input required value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1" /></label>
        <label className="block text-sm font-medium">รูปถ่าย<input required className="mt-2 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <Button type="button" onClick={locate} className="w-full">{locating ? 'กำลังจับตำแหน่ง' : position ? 'จับตำแหน่งแล้ว ✓' : 'เปิดแชร์ตำแหน่ง'}</Button>
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'กำลังส่ง' : 'ส่งคำขอ'}</Button>
      </>}
    </form>
  )
}

function RequestCard({ request, onChanged, onError }: { request: UnifiedRequest; onChanged: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const labels = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', cancelled: 'ยกเลิกแล้ว' }
  const title = request.kind === 'leave'
    ? `${request.startDate}${request.endDate !== request.startDate ? ` – ${request.endDate}` : ''} · ${request.duration === 'full_day' ? request.leaveType === 'sick' ? 'ลาป่วย' : 'ลากิจ' : request.duration === 'morning' ? 'ลาครึ่งเช้า' : 'ลาครึ่งบ่าย'}`
    : `${request.date} · ทำงานนอกสถานที่`
  return (
    <article className="rounded-xl border border-rule bg-surface p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-text-dim">{request.kind === 'leave' ? request.reason : request.taskDescription}</p></div><span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 text-xs font-semibold">{labels[request.status]}</span></div>
      {request.rejectReason && <p className="mt-2 text-sm text-absent">เหตุผล: {request.rejectReason}</p>}
      {request.kind === 'leave' && request.medicalCertificatePath && <a className="mt-2 inline-block text-sm font-medium text-brand underline" target="_blank" rel="noreferrer" href={request.medicalCertificatePath}>เปิดใบรับรองแพทย์</a>}
      {request.status === 'pending' && <Button size="sm" className="mt-3" disabled={busy} onClick={async () => { setBusy(true); try { await api.cancelRequest(request.kind, request.id); onChanged() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }}>ยกเลิกคำขอ</Button>}
      {request.kind === 'leave' && request.leaveType === 'sick' && request.medicalCertificatePending && (
        <label className="mt-3 block text-sm font-medium text-brand">แนบใบรับรองภายหลัง<input className="mt-1 block w-full text-sm text-text" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { await api.uploadMedicalCertificate(request.id, file); onChanged() } catch (err) { onError((err as Error).message) } }} /></label>
      )}
    </article>
  )
}
