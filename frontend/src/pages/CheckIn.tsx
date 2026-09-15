import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, loginUrl } from '../lib/api'
import { Button } from '../components/ui'
import { STATUS_LABEL, type CheckInView } from '../lib/types'

/**
 * หน้านี้มีอายุการใช้งานสามวินาที คนยืนอยู่หน้าจอ มือถืออยู่ในมือ
 * จึงมีข้อความหลักหนึ่งข้อความ และปุ่มหลักหนึ่งปุ่มเท่านั้นในแต่ละสถานะ
 */
export default function CheckIn() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [view, setView] = useState<CheckInView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .checkInView(token)
      .then(setView)
      .catch(() => setError('เชื่อมต่อไม่ได้ ลองสแกนใหม่อีกครั้ง'))
  }, [token])

  async function run(fn: () => Promise<CheckInView>) {
    setBusy(true)
    setError(null)
    try {
      setView(await fn())
    } catch {
      setError('บันทึกไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col px-6 pt-10 pb-safe">
      {!view && !error && <p className="mt-24 text-center text-text-dim">กำลังตรวจสอบ</p>}
      {error && <Notice tone="warn" title="เกิดข้อผิดพลาด" body={error} />}
      {view && <Body view={view} busy={busy} run={run} token={token} />}
    </main>
  )
}

function Body({
  view,
  busy,
  run,
  token,
}: {
  view: CheckInView
  busy: boolean
  run: (fn: () => Promise<CheckInView>) => void
  token: string
}) {
  // กดยังไม่กลับ: ไม่บันทึกอะไร (หน้าที่เปิดจากการสแกนมักย้อนกลับไม่ได้ จึงแสดงข้อความแทน)
  const [kept, setKept] = useState(false)
  if (kept && view.kind === 'early_leave')
    return <Notice tone="calm" title="ไม่ได้บันทึกอะไร" body="กะของคุณยังดำเนินต่อตามปกติ ปิดหน้านี้ได้เลย" />

  switch (view.kind) {
    case 'expired':
      return (
        <Notice
          tone="warn"
          title="รหัสหมดอายุแล้ว"
          body="รหัสบนจอเปลี่ยนทุก 30 วินาที สแกนใหม่อีกครั้งได้เลย"
        />
      )

    case 'not_registered':
      return (
        <>
          <Notice
            tone="warn"
            title="ยังไม่ได้ลงทะเบียนบัญชีนี้"
            body={`${view.email} ไม่อยู่ในรายชื่อพนักงาน ติดต่อแอดมินเพื่อเพิ่มอีเมลนี้เข้าระบบ`}
          />
          {/* คนที่มีหลายบัญชี Google มักเลือกผิดบัญชี ให้เปลี่ยนได้ทันทีโดยไม่ต้องสแกนใหม่ */}
          <Actions>
            <a
              href={loginUrl(`/checkin?token=${encodeURIComponent(token)}`, true)}
              className="flex min-h-11 w-full items-center justify-center rounded-lg border border-rule-strong bg-surface px-4 text-base font-medium"
            >
              เข้าสู่ระบบด้วยบัญชีอื่น
            </a>
          </Actions>
        </>
      )

    case 'no_shift_today':
      return (
        <Notice
          tone="calm"
          title={`วันนี้ ${view.nickname} ไม่มีตารางงาน`}
          body="ถ้าคิดว่าตารางไม่ถูกต้อง แจ้งแอดมินให้แก้ให้ได้"
        />
      )

    case 'all_done':
      return <Notice tone="calm" title={`${view.nickname} เช็กชื่อครบแล้ววันนี้`} body="ไม่มีกะที่ต้องเช็กชื่อเพิ่ม" />

    case 'too_early':
      return (
        <Notice
          tone="calm"
          title="ยังเช็กเข้ากะถัดไปไม่ได้"
          body={`กะปัจจุบันสิ้นสุดเวลา ${view.previousEndTime} หลังจากนั้นสแกนได้เลย`}
        />
      )

    case 'ready':
      return (
        <>
          <Greeting nickname={view.nickname} />
          <ShiftFacts
            project={view.shift.projectName}
            start={view.shift.startTime}
            end={view.shift.endTime}
            scannedAt={view.scannedAt}
          />
          <Actions>
            <Button
              variant="primary"
              className="w-full text-base"
              disabled={busy}
              onClick={() => run(() => api.confirmCheckIn(token))}
            >
              {busy ? 'กำลังบันทึก' : 'เช็กชื่อเข้างาน'}
            </Button>
            <p className="mt-3 text-center text-[13px] text-text-dim">
              ระบบจะบันทึกเวลา {view.scannedAt} ซึ่งเป็นเวลาที่คุณสแกน
            </p>
          </Actions>
        </>
      )

    case 'ready_checkout':
      return (
        <>
          <Greeting nickname={view.nickname} />
          <p className="display mt-4 text-3xl leading-snug font-semibold">บันทึกเวลาออกงาน</p>
          <ShiftFacts
            project={view.shift.projectName}
            start={view.shift.startTime}
            end={view.shift.endTime}
            scannedAt={view.scannedAt}
          />
          <Actions>
            <Button
              variant="primary"
              className="w-full text-base"
              disabled={busy}
              onClick={() => run(() => api.confirmCheckOut(token))}
            >
              {busy ? 'กำลังบันทึก' : 'เช็กชื่อออกงาน'}
            </Button>
            <p className="mt-3 text-center text-[13px] text-text-dim">
              ระบบจะบันทึกเวลา {view.scannedAt} ซึ่งเป็นเวลาที่คุณสแกน
            </p>
          </Actions>
        </>
      )

    case 'done': {
      const late = view.status === 'late'
      return (
        <div className="animate-stamp">
          <Greeting nickname={view.nickname} />
          <p
            className={`display mt-5 text-5xl leading-tight font-semibold ${late ? 'text-late' : 'text-ontime'}`}
          >
            {STATUS_LABEL[view.status]}
          </p>
          <p className="tnum mt-2 text-lg text-text-dim">บันทึกเวลา {view.shift.scannedAt}</p>
          <ShiftFacts project={view.shift.projectName} start={view.shift.startTime} end={view.shift.endTime} />
          <p className="mt-8 text-[15px] text-text-dim">ปิดหน้านี้ได้เลย</p>
        </div>
      )
    }

    case 'checkout_done':
      return (
        <div className="animate-stamp">
          <Greeting nickname={view.nickname} />
          <p className="display mt-5 text-4xl leading-tight font-semibold text-ontime">บันทึกเวลาออกงานแล้ว</p>
          <p className="tnum mt-2 text-lg text-text-dim">
            บันทึกเวลา {view.shift.checkedOutAt ?? view.shift.endTime}
          </p>
          <ShiftFacts
            project={view.shift.projectName}
            start={view.shift.startTime}
            end={view.shift.endTime}
            scannedAt={view.shift.scannedAt ?? undefined}
          />
          <p className="mt-8 text-[15px] text-text-dim">ปิดหน้านี้ได้เลย</p>
        </div>
      )

    case 'early_leave': {
      const h = Math.floor(view.minutesRemaining / 60)
      const m = view.minutesRemaining % 60
      return (
        <>
          <Greeting nickname={view.nickname} />
          <p className="display mt-4 text-3xl leading-snug font-semibold">คุณกำลังแจ้งกลับก่อนเวลา</p>
          <p className="mt-3 text-[17px] leading-relaxed text-text-dim">
            กะนี้เหลืออีก{' '}
            <span className="tnum font-semibold text-text">
              {h > 0 && `${h} ชั่วโมง `}
              {m} นาที
            </span>{' '}
            เมื่อยืนยันแล้วกะนี้จะถือว่าจบ สแกนกลับเข้ามาใหม่ไม่ได้
          </p>
          <ShiftFacts
            project={view.shift.projectName}
            start={view.shift.startTime}
            end={view.shift.endTime}
            scannedAt={view.shift.scannedAt ?? undefined}
          />
          {/* ปุ่มเด่นคือปุ่มกลับ เพราะคนส่วนใหญ่ที่มาถึงหน้านี้คือคนที่กดพลาด */}
          <Actions>
            <Button variant="primary" className="w-full text-base" onClick={() => setKept(true)}>
              ยังไม่กลับ ปิดหน้านี้
            </Button>
            <Button
              variant="danger"
              className="mt-3 w-full text-base"
              disabled={busy}
              onClick={() => run(() => api.confirmEarlyLeave(token))}
            >
              {busy ? 'กำลังบันทึก' : 'ยืนยันว่ากลับก่อนเวลา'}
            </Button>
          </Actions>
        </>
      )
    }

    case 'early_leave_done':
      return (
        <div className="animate-stamp">
          <Greeting nickname={view.nickname} />
          <p className="display mt-5 text-4xl leading-tight font-semibold text-leave">บันทึกว่ากลับก่อนเวลาแล้ว</p>
          <ShiftFacts project={view.shift.projectName} start={view.shift.startTime} end={view.shift.endTime} />
          <p className="mt-8 text-[15px] text-text-dim">ถ้าบันทึกผิด แจ้งแอดมินให้แก้ให้ได้</p>
        </div>
      )
  }
}

function Greeting({ nickname }: { nickname: string }) {
  return <p className="display text-2xl font-medium text-text-dim">สวัสดี {nickname}</p>
}

function ShiftFacts({
  project,
  start,
  end,
  scannedAt,
}: {
  project: string
  start: string
  end: string
  scannedAt?: string
}) {
  const rows: [string, string][] = [
    ['โปรเจก', project],
    ['เวลากะ', `${start} – ${end}`],
  ]
  if (scannedAt) rows.push(['เวลาที่สแกน', scannedAt])
  return (
    <dl className="mt-7 border-t border-rule">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-rule py-3">
          <dt className="text-[15px] text-text-dim">{k}</dt>
          <dd className="tnum text-[15px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto pt-10">{children}</div>
}

function Notice({ tone, title, body }: { tone: 'warn' | 'calm'; title: string; body: string }) {
  return (
    <div className="mt-16">
      <p className={`display text-3xl leading-snug font-semibold ${tone === 'warn' ? 'text-absent' : 'text-text'}`}>
        {title}
      </p>
      <p className="mt-3 text-[17px] leading-relaxed text-text-dim">{body}</p>
    </div>
  )
}
