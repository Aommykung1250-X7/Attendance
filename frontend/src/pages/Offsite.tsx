import { useEffect, useState } from 'react'
import { api, ApiError, loginUrl } from '../lib/api'
import { Button, Field, Input } from '../components/ui'
import { STATUS_LABEL, type CheckInView } from '../lib/types'
import { Actions, DonePage, Greeting, Notice, ShiftFacts } from './CheckIn'

/** ยาวสุดของ "ทำงานที่ไหน" ตรงกับ OFFSITE_NOTE_MAX ฝั่ง backend */
const NOTE_MAX = 200

/**
 * เช็กชื่อแบบทำงานนอกสถานที่: คนที่ไม่ได้อยู่ออฟฟิศจึงสแกน QR ที่จอไม่ได้ เปิดหน้านี้เองบนมือถือ
 * ล็อกอิน Google แล้วกรอกว่าทำงานที่ไหน ระบบบันทึกเวลาที่กดปุ่ม สถานะคิดปกติ/สายเหมือนการสแกน
 * แอดมินเห็นในบันทึกประจำวันว่าแถวนี้แจ้งนอกสถานที่ และจอในออฟฟิศขึ้นเป็นสีม่วงในการ์ด "มาแล้ว"
 */
export default function Offsite() {
  const [view, setView] = useState<CheckInView | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    api
      .offsiteView()
      .then(setView)
      .catch(() => setError('เชื่อมต่อไม่ได้ ลองเปิดหน้านี้ใหม่อีกครั้ง'))
  }, [])

  async function submit() {
    if (!note.trim()) return setFormError('กรอกว่าทำงานที่ไหน')
    setBusy(true)
    setFormError(null)
    try {
      setView(await api.confirmOffsite(note))
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DonePage done={view?.kind === 'done'}>
      <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col px-6 pt-10 pb-safe">
        {!view && !error && <p className="mt-24 text-center text-text-dim">กำลังตรวจสอบ</p>}
        {error && <Notice tone="warn" title="เกิดข้อผิดพลาด" body={error} />}
        {view && <Body view={view} note={note} setNote={setNote} busy={busy} formError={formError} submit={submit} />}
      </main>
    </DonePage>
  )
}

function Body({
  view,
  note,
  setNote,
  busy,
  formError,
  submit,
}: {
  view: CheckInView
  note: string
  setNote: (v: string) => void
  busy: boolean
  formError: string | null
  submit: () => void
}) {
  switch (view.kind) {
    case 'not_registered':
      return (
        <>
          <Notice tone="warn" title="ยังไม่ได้ลงทะเบียนบัญชีนี้" body={`${view.email} ไม่อยู่ในรายชื่อพนักงาน ติดต่อแอดมินเพื่อเพิ่มอีเมลนี้เข้าระบบ`} />
          <Actions>
            <a
              href={loginUrl('/offsite', true)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-rule-strong bg-surface px-4 text-base font-medium text-text transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-sunken"
            >
              เข้าสู่ระบบด้วยบัญชีอื่น
            </a>
          </Actions>
        </>
      )

    case 'no_shift_today':
      return <Notice tone="calm" title={`วันนี้ ${view.nickname} ไม่มีตารางงาน`} body="ถ้าคิดว่าตารางไม่ถูกต้อง แจ้งแอดมินให้แก้ให้ได้" />

    case 'all_done':
      return <Notice tone="calm" title={`${view.nickname} เช็กชื่อครบแล้ววันนี้`} body="ไม่มีกะที่ต้องเช็กชื่อเพิ่ม" />

    case 'too_early':
      return <Notice tone="calm" title="ยังเช็กเข้ากะถัดไปไม่ได้" body={`กะปัจจุบันสิ้นสุดเวลา ${view.previousEndTime} หลังจากนั้นเปิดหน้านี้อีกครั้ง`} />

    case 'ready':
      return (
        <>
          <Greeting nickname={view.nickname} />
          <p className="display mt-4 text-3xl leading-snug font-semibold">เช็กชื่อทำงานนอกสถานที่</p>
          <p className="mt-2 text-[15px] leading-relaxed text-text-dim">ใช้เมื่อวันนี้ไม่ได้เข้าออฟฟิศ ถ้าอยู่ที่ออฟฟิศให้สแกน QR ที่จอแทน</p>
          <ShiftFacts project={view.shift.projectName} start={view.shift.startTime} end={view.shift.endTime} location="นอกสถานที่" />
          <form
            className="mt-7"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field label="ทำงานที่ไหน" hint="เช่น ประชุมลูกค้า บริษัทเอ / ออกงานอีเวนต์ที่เชียงใหม่" error={formError}>
              {(id) => <Input id={id} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="สถานที่หรืองานที่ไป" />}
            </Field>
            <Actions>
              <Button type="submit" variant="primary" className="w-full text-base" disabled={busy}>
                {busy ? 'กำลังบันทึก' : 'เช็กชื่อ (นอกสถานที่)'}
              </Button>
              <p className="mt-3 text-center text-[13px] text-text-dim">ระบบจะบันทึกเวลาที่กดปุ่มนี้เป็นเวลาเข้างาน</p>
            </Actions>
          </form>
        </>
      )

    case 'done': {
      const late = view.status === 'late'
      return (
        <div className="animate-stamp">
          <Greeting nickname={view.nickname} />
          <p className={`display mt-5 text-5xl leading-tight font-semibold ${late ? 'text-late' : 'text-ontime'}`}>{STATUS_LABEL[view.status]}</p>
          <p className="mt-2 text-lg text-text-dim">ทำงานนอกสถานที่</p>
          <ShiftFacts
            project={view.shift.projectName}
            start={view.shift.startTime}
            end={view.shift.endTime}
            location={view.shift.offsiteNote ?? 'นอกสถานที่'}
            scannedAt={view.shift.scannedAt ?? undefined}
            scannedLabel="เวลาที่เช็กชื่อ"
          />
          <p className="mt-8 text-[15px] text-text-dim">ปิดหน้านี้ได้เลย</p>
        </div>
      )
    }

    // เช็กชื่อกะนี้ไปแล้ว (หน้านี้ไม่มีการแจ้งกลับก่อนเวลา ให้แจ้งแอดมินแทน)
    case 'early_leave':
      return (
        <>
          <Notice
            tone="calm"
            title="เช็กชื่อกะนี้แล้ว"
            body={`กะ ${view.shift.startTime}–${view.shift.endTime} เช็กชื่อไว้แล้วเวลา ${view.shift.scannedAt ?? '-'} ถ้าจะกลับก่อนเวลา แจ้งแอดมินให้บันทึกให้`}
          />
          {view.shift.offsite && (
            <ShiftFacts project={view.shift.projectName} start={view.shift.startTime} end={view.shift.endTime} location={view.shift.offsiteNote ?? 'นอกสถานที่'} />
          )}
        </>
      )

    case 'early_leave_done':
      return <Notice tone="calm" title="กะนี้จบแล้ว" body="บันทึกว่ากลับก่อนเวลาแล้ว ถ้าบันทึกผิด แจ้งแอดมินให้แก้ให้ได้" />

    case 'expired':
      return <Notice tone="warn" title="หน้านี้หมดอายุ" body="เปิดหน้านี้ใหม่อีกครั้ง" />
  }
}
