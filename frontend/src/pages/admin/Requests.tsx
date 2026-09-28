import { useEffect, useState } from 'react'
import { Button, Dialog, Input, Loading, PageHeader } from '../../components/ui'
import { useNotify } from '../../components/notify'
import { api } from '../../lib/api'
import type { Employee, LeaveDuration, LeaveType, UnifiedRequest } from '../../lib/types'

export default function Requests() {
  const notify = useNotify()
  const [requests, setRequests] = useState<UnifiedRequest[] | null>(null)
  const [status, setStatus] = useState('pending')
  const [kind, setKind] = useState('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [reject, setReject] = useState<{ request: UnifiedRequest; reason: string } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<{ kind: UnifiedRequest['kind']; id: string } | null>(null)

  const selectedRequest = selected ? requests?.find((r) => r.kind === selected.kind && r.id === selected.id) ?? null : null
  const load = () => api.adminRequests(status === 'all' ? undefined : status, kind === 'all' ? undefined : kind).then((next) => {
    setRequests(next)
    setSelected((current) => current && next.some((r) => r.kind === current.kind && r.id === current.id) ? current : null)
  }).catch((e) => notify.toast(e.message, { tone: 'error' }))
  useEffect(() => {
    const refresh = () => load()
    void load()
    window.addEventListener('attendance:requests-updated', refresh)
    return () => window.removeEventListener('attendance:requests-updated', refresh)
  }, [status, kind])

  const review = async (request: UnifiedRequest, action: 'approve' | 'reject', reason?: string) => {
    setBusy(request.id)
    try {
      await api.reviewRequest(request.kind, request.id, action, reason)
      notify.toast(action === 'approve' ? 'อนุมัติคำขอแล้ว' : 'ปฏิเสธคำขอแล้ว')
      setReject(null)
      load()
    } catch (e) { notify.toast((e as Error).message, { tone: 'error' }) } finally { setBusy(null) }
  }

  const markDocument = async (request: UnifiedRequest) => {
    if (request.kind !== 'leave') return
    setBusy(request.id)
    try { await api.markMedicalReceived(request.id); notify.toast('ยืนยันรับเอกสารแล้ว'); await load() }
    catch (e) { notify.toast((e as Error).message, { tone: 'error' }) }
    finally { setBusy(null) }
  }

  const cancelLeave = async (request: UnifiedRequest) => {
    if (request.kind !== 'leave') return
    setBusy(request.id)
    try { await api.adminCancelLeave(request.id); notify.toast('ยกเลิกรายการแล้ว'); await load() }
    catch (e) { notify.toast((e as Error).message, { tone: 'error' }) }
    finally { setBusy(null) }
  }

  return (
    <div className="pb-12">
      <PageHeader title="คำขอ" actions={<Button onClick={() => setShowCreate(true)}>เพิ่มลาย้อนหลัง</Button>} />
      <p className="-mt-3 text-[15px] text-text-dim">พิจารณาใบลาและคำขอทำงานนอกสถานที่จากหน้าเดียว</p>
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-surface p-2">
        <div className="flex flex-wrap gap-1.5">
          {[['pending', 'รออนุมัติ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ปฏิเสธ'], ['cancelled', 'ยกเลิก'], ['all', 'ทั้งหมด']].map(([v, label]) => <Filter key={v} active={status === v} onClick={() => setStatus(v)}>{label}</Filter>)}
        </div>
        <span aria-hidden className="h-px w-full bg-rule md:h-7 md:w-px" />
        <div className="flex flex-wrap gap-1.5 md:ml-auto">
          {[['all', 'ทุกประเภท'], ['leave', 'ลา'], ['offsite', 'นอกสถานที่']].map(([v, label]) => <Filter key={v} active={kind === v} onClick={() => setKind(v)}>{label}</Filter>)}
        </div>
      </div>
      {!requests ? <Loading /> : requests.length === 0 ? <p className="mt-8 rounded-xl border border-dashed border-rule p-8 text-center text-text-dim">ไม่มีคำขอในหมวดนี้</p> : (
        <div className="mt-4 grid gap-2.5">
          {requests.map((r) => <AdminRequestCard key={`${r.kind}-${r.id}`} request={r} busy={busy === r.id} onOpen={() => setSelected({ kind: r.kind, id: r.id })} onApprove={() => review(r, 'approve')} onReject={() => setReject({ request: r, reason: '' })} onMarkDocument={() => markDocument(r)} onCancel={() => cancelLeave(r)} />)}
        </div>
      )}

      <Dialog open={!!reject} title="ปฏิเสธคำขอ" onClose={() => setReject(null)} footer={<><Button onClick={() => setReject(null)}>กลับ</Button><Button variant="danger-solid" disabled={!reject?.reason.trim() || busy === reject?.request.id} onClick={() => reject && review(reject.request, 'reject', reject.reason)}>ยืนยันปฏิเสธ</Button></>}>
        <label className="text-sm font-medium">เหตุผลที่ปฏิเสธ<textarea autoFocus rows={3} value={reject?.reason ?? ''} onChange={(e) => setReject((x) => x ? { ...x, reason: e.target.value } : null)} className="mt-2 w-full rounded-lg border border-rule bg-surface p-3" /></label>
      </Dialog>
      <CreateLeave open={showCreate} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load() }} />
      <Dialog open={!!selectedRequest} title={selectedRequest ? `${requestTypeLabel(selectedRequest)} · ${selectedRequest.nickname ?? 'พนักงาน'}` : 'รายละเอียดคำขอ'} onClose={() => setSelected(null)} wide footer={selectedRequest && <RequestActions request={selectedRequest} busy={busy === selectedRequest.id} onApprove={() => review(selectedRequest, 'approve')} onReject={() => setReject({ request: selectedRequest, reason: '' })} onMarkDocument={() => markDocument(selectedRequest)} onCancel={() => cancelLeave(selectedRequest)} />}>
        {selectedRequest && <RequestDetails request={selectedRequest} />}
      </Dialog>
    </div>
  )
}

function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-9 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${active ? 'bg-brand text-white' : 'text-text-dim hover:bg-sunken hover:text-text'}`}>{children}</button>
}

function AdminRequestCard({ request, busy, onOpen, onApprove, onReject, onMarkDocument, onCancel }: { request: UnifiedRequest; busy: boolean; onOpen: () => void; onApprove: () => void; onReject: () => void; onMarkDocument: () => void; onCancel: () => void }) {
  const date = request.kind === 'leave' ? request.startDate === request.endDate ? request.startDate : `${request.startDate} – ${request.endDate}` : request.date
  return <article className={`rounded-xl border px-4 py-3.5 ${request.status === 'pending' ? 'border-amber-300 bg-amber-50/35' : 'border-rule bg-surface'}`}>
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">{request.nickname ?? 'พนักงาน'}</h2><span className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] font-semibold text-text-dim">{requestTypeLabel(request)}</span><StatusBadge status={request.status} /></div><p className="mt-1 text-[13px] text-text-dim">{date}</p></button>
      <div className="flex shrink-0 flex-wrap gap-1.5 md:max-w-64 md:justify-end">
        <RequestActions request={request} busy={busy} onApprove={onApprove} onReject={onReject} onMarkDocument={onMarkDocument} onCancel={onCancel} />
      </div>
    </div>
  </article>
}

const STATUS_LABEL = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', cancelled: 'ยกเลิก' }

function StatusBadge({ status }: { status: UnifiedRequest['status'] }) {
  return <span className="rounded-full border border-rule px-2 py-0.5 text-[11px] font-medium text-text-dim">{STATUS_LABEL[status]}</span>
}

function requestTypeLabel(request: UnifiedRequest) {
  if (request.kind === 'offsite') return 'ทำงานนอกสถานที่'
  const type = request.leaveType === 'sick' ? 'ลาป่วย' : request.leaveType === 'personal' ? 'ลากิจ' : 'ลา'
  if (request.duration === 'morning') return `${type}ครึ่งเช้า`
  if (request.duration === 'afternoon') return `${type}ครึ่งบ่าย`
  return type
}

function RequestActions({ request, busy, onApprove, onReject, onMarkDocument, onCancel }: { request: UnifiedRequest; busy: boolean; onApprove: () => void; onReject: () => void; onMarkDocument: () => void; onCancel: () => void }) {
  return <>{request.status === 'pending' && <><Button size="sm" variant="primary" disabled={busy} onClick={onApprove}>อนุมัติ</Button><Button size="sm" variant="danger" disabled={busy} onClick={onReject}>ปฏิเสธ</Button></>}{request.kind === 'leave' && request.medicalCertificatePending && <Button size="sm" disabled={busy} onClick={onMarkDocument}>ยืนยันรับเอกสาร</Button>}{request.kind === 'leave' && request.status === 'approved' && <Button size="sm" variant="danger" disabled={busy} onClick={onCancel}>ยกเลิกรายการ</Button>}</>
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-rule bg-sunken/40 px-3.5 py-3"><dt className="text-xs font-medium text-text-dim">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-[15px]">{children}</dd></div>
}

function RequestDetails({ request }: { request: UnifiedRequest }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={request.status} /><span className="text-sm text-text-dim">ส่งเมื่อ {new Date(request.createdAt).toLocaleString('th-TH')}</span></div><dl className="grid gap-3 sm:grid-cols-2">{request.kind === 'leave' ? <><DetailRow label="วันที่">{request.startDate === request.endDate ? request.startDate : `${request.startDate} – ${request.endDate}`}</DetailRow><DetailRow label="ช่วงเวลา">{request.duration === 'full_day' ? 'เต็มวัน' : request.duration === 'morning' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย'}</DetailRow>{request.leaveType && <DetailRow label="ประเภทลา">{request.leaveType === 'sick' ? 'ลาป่วย' : 'ลากิจ'}</DetailRow>}<div className="sm:col-span-2"><DetailRow label="เหตุผล">{request.reason}</DetailRow></div>{request.leaveType === 'sick' && <div className="sm:col-span-2"><DetailRow label="ใบรับรองแพทย์">{request.medicalCertificatePath ? <a target="_blank" rel="noreferrer" href={request.medicalCertificatePath} className="font-medium text-brand underline">เปิดใบรับรองแพทย์</a> : request.medicalCertificatePending ? 'รอพนักงานนำเอกสารมาส่ง' : 'ยืนยันรับเอกสารแล้ว'}</DetailRow></div>}</> : <><DetailRow label="วันที่">{request.date}</DetailRow><DetailRow label="กะ">{request.projectName ?? 'ไม่ระบุ'} {request.startTime && request.endTime ? `${request.startTime}–${request.endTime}` : ''}</DetailRow><div className="sm:col-span-2"><DetailRow label="สิ่งที่จะทำ">{request.taskDescription}</DetailRow></div><div className="sm:col-span-2"><DetailRow label="สถานที่">{request.locationName ?? 'ไม่ระบุ'}</DetailRow></div><div className="sm:col-span-2"><DetailRow label="รูปหลักฐาน">{imageFailed ? <span className="text-absent">โหลดรูปหลักฐานไม่สำเร็จ</span> : <img src={request.photoPath} alt={`รูปหลักฐานของ ${request.nickname ?? 'พนักงาน'}`} onError={() => setImageFailed(true)} className="mt-2 max-h-[55dvh] w-full rounded-lg object-contain" />}</DetailRow></div></>}</dl>{request.rejectReason && <p className="rounded-lg bg-absent-bg px-3.5 py-3 text-sm text-absent">เหตุผลที่ปฏิเสธ: {request.rejectReason}</p>}</div>
}

function CreateLeave({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [duration, setDuration] = useState<LeaveDuration>('full_day')
  const [leaveType, setLeaveType] = useState<LeaveType>('personal')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) api.employees().then((x) => { setEmployees(x); setEmployeeId(x[0]?.id ?? '') }) }, [open])
  const submit = async () => {
    setBusy(true)
    const effectiveDuration = endDate && endDate !== date ? 'full_day' : duration
    try { await api.adminCreateLeave({ employeeId, startDate: date, endDate: endDate || date, duration: effectiveDuration, leaveType, reason, medicalCertificatePending: leaveType === 'sick' }); notify.toast('เพิ่มการลาย้อนหลังแล้ว'); onDone() } catch (e) { notify.toast((e as Error).message, { tone: 'error' }) } finally { setBusy(false) }
  }
  return <Dialog open={open} title="เพิ่มการลาย้อนหลัง" onClose={onClose} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" disabled={busy || !employeeId || !date || !reason.trim()} onClick={submit}>บันทึกและอนุมัติ</Button></>} wide>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">พนักงาน<select className="mt-1 block w-full rounded-lg border border-rule bg-surface px-3 py-2" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.nickname} {e.gen ?? ''}</option>)}</select></label>
      <label className="text-sm font-medium">วันเริ่ม<Input className="mt-1" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value) }} /></label>
      <label className="text-sm font-medium">วันสิ้นสุด<Input className="mt-1" type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      {(!endDate || endDate === date) && <label className="text-sm font-medium">ช่วงเวลา<select className="mt-1 block w-full rounded-lg border border-rule bg-surface px-3 py-2" value={duration} onChange={(e) => setDuration(e.target.value as LeaveDuration)}><option value="full_day">เต็มวัน</option><option value="morning">ครึ่งเช้า</option><option value="afternoon">ครึ่งบ่าย</option></select></label>}
      <label className="text-sm font-medium">ประเภท<select className="mt-1 block w-full rounded-lg border border-rule bg-surface px-3 py-2" value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}><option value="sick">ลาป่วย</option><option value="personal">ลากิจ</option></select></label>
      {leaveType === 'sick' && <p className="text-sm text-text-dim sm:col-span-2">รายการจะถูกบันทึกเป็นรอรับใบรับรองแพทย์ แอดมินกดยืนยันรับเอกสารได้ภายหลัง</p>}
      <label className="text-sm font-medium sm:col-span-2">เหตุผล<textarea rows={3} className="mt-1 block w-full rounded-lg border border-rule bg-surface p-3" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </div>
  </Dialog>
}
