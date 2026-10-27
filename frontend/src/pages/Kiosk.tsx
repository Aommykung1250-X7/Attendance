import { useEffect, useMemo, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { bangkok, fullThaiDate, minutesOf } from '../lib/format'
import type { KioskBoard, LeaveDuration, LeaveType, ShiftInstance } from '../lib/types'

/**
 * จอ "เช็คชื่อวันนี้" ติดผนังในออฟฟิศ เปิดทิ้งไว้ทั้งวัน พนักงานเดินมาสแกน QR หัวหน้าดูสถานะทีมได้ในแวบเดียว
 *
 * บนลงล่าง: หัว (วันที่ · นาฬิกา) | การ์ดสรุป 5 ช่อง + แถบสัดส่วน | 3 คอลัมน์ สแกน · มาแล้ว (กว้าง 1.4 เท่า) · ยังไม่มา/ลา/ขาด
 * จอ ≥1280px: ทั้งหน้าพอดีจอ รายชื่อยาวเลื่อนในกล่องตัวเอง · จอแคบกว่า: คอลัมน์เดียว ทั้งหน้าเลื่อนลง
 * ตัวหนังสือเล็กสุด 14px เพราะอ่านจากระยะไกล
 */
export default function Kiosk() {
  const { displayKey = 'demo' } = useParams()
  const [board, setBoard] = useState<KioskBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  // ส่วนต่างระหว่างนาฬิกาเซิร์ฟเวอร์กับเครื่องนี้ นาฬิกาบนจอจึงตรงกับเวลาที่ใช้ตัดสินจริง
  // ไม่ใช่นาฬิกาของเครื่องที่ต่อจอ ซึ่งอาจคลาดเคลื่อนเป็นนาที
  const offset = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // นาฬิกาเดินตามเวลาของเซิร์ฟเวอร์ (spec หัวข้อ 8 "จอในออฟฟิศ")
  useEffect(() => {
    const t = setInterval(() => setNow(new Date(Date.now() + offset.current)), 250)
    return () => clearInterval(t)
  }, [])

  // ดึงข้อมูลใหม่ทุก 8 วินาที ไม่ต้องต่อ websocket สำหรับ 27 คน
  const pullRef = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const sent = Date.now()
        const b = await api.board(displayKey)
        // ชดเชยเวลาเดินทางของคำขอครึ่งหนึ่ง
        offset.current = Date.parse(b.serverTime) - (sent + (Date.now() - sent) / 2)
        if (alive) {
          setBoard(b)
          setError(null)
        }
      } catch (e) {
        if (!alive) return
        const status = (e as { status?: number }).status
        setError(status === 404 ? 'ลิงก์หน้าจอนี้ใช้ไม่ได้แล้ว ขอลิงก์ใหม่จากแอดมิน' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่')
        if (status === 404) setBoard(null)
      }
    }
    pullRef.current = pull
    pull()
    const t = setInterval(pull, 8000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [displayKey])

  // วาด QR ใหม่เฉพาะตอนรหัสเปลี่ยน
  const token = board?.qrToken
  useEffect(() => {
    if (!token || !canvasRef.current) return
    const canvas = canvasRef.current
    QRCode.toCanvas(canvas, `${location.origin}/checkin?token=${token}`, {
      width: 720,
      margin: 1,
      color: { dark: '#2a211c', light: '#ffffff' },
    }).then(() => {
      // ไลบรารีใส่ขนาดเป็น inline style ล้างออกให้ขนาดตาม class (วาดใหญ่แล้วย่อ จึงคมบนจอความละเอียดสูง)
      canvas.style.width = ''
      canvas.style.height = ''
    })
  }, [token])

  const b = useMemo(() => bangkok(now), [now])
  const nowMin = minutesOf(`${b.hh}:${b.mm}`)
  const rows = board?.today ?? []
  const groups = useMemo(() => {
    const byStart = (x: ShiftInstance, y: ShiftInstance) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th')
    const afternoon = nowMin >= 13 * 60
    const activeLeave = (r: ShiftInstance) =>
      r.leavePortion === 'full_day' ||
      (r.leavePortion === 'morning' && !afternoon) ||
      (r.leavePortion === 'afternoon' && afternoon)
    const exited = (r: ShiftInstance) => !!(r.checkedOutAt || r.earlyLeaveAt)
    // มาแล้ว = ตรงเวลา + สาย + ทำงานนอกสถานที่
    const arrived = rows.filter((r) => ['ontime', 'late', 'offsite'].includes(r.status) && !activeLeave(r))
    return {
      // คนที่ยังอยู่เรียงเวลาเข้างานล่าสุดก่อน · คนออกงานแล้วแยกกลุ่มล่างสุด เรียงออกล่าสุดก่อน
      inside: arrived.filter((r) => !exited(r)).sort((x, y) => (y.scannedAt ?? '').localeCompare(x.scannedAt ?? '')),
      out: arrived
        .filter(exited)
        .sort((x, y) => (y.checkedOutAt ?? y.earlyLeaveAt ?? '').localeCompare(x.checkedOutAt ?? x.earlyLeaveAt ?? '')),
      pending: rows.filter((r) => r.status === 'pending' && !activeLeave(r)).sort(byStart),
      leave: rows.filter((r) => r.status === 'leave' || activeLeave(r)).sort(byStart),
      absent: rows.filter((r) => r.status === 'absent' && !activeLeave(r)).sort(byStart),
    }
  }, [rows, nowMin])

  // นับถอยหลังถึงรอบเปลี่ยน QR: token แบ่งช่วงตาม floor(วินาทีของเซิร์ฟเวอร์ / ttl) (backend/src/lib/qr.ts)
  // now เดินตามนาฬิกาเซิร์ฟเวอร์อยู่แล้ว จึงคำนวณจุดเปลี่ยนรอบได้ตรงกับที่เซิร์ฟเวอร์ใช้จริง
  const ttl = board?.tokenExpiresIn ?? 30
  const nowSec = now.getTime() / 1000
  const bucket = Math.floor(nowSec / ttl)
  const secondsLeft = Math.max(0, (bucket + 1) * ttl - nowSec)
  // ขึ้นรอบใหม่เมื่อไหร่ ดึงข้อมูลทันที ไม่ต้องรอโพลรอบถัดไป QR บนจอจึงเปลี่ยนตรงกับตัวนับ
  const lastBucket = useRef(bucket)
  useEffect(() => {
    if (lastBucket.current === bucket) return
    lastBucket.current = bucket
    pullRef.current()
  }, [bucket])

  useWakeLock()

  // คนที่มีหลายกะในวันเดียว บอกเป็น "รอบ 1 / รอบ 2"
  const roundNo = useMemo(() => {
    const byEmployee = new Map<string, ShiftInstance[]>()
    for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r])
    const out = new Map<string, number>()
    for (const list of byEmployee.values()) {
      if (list.length < 2) continue
      list.sort((x, y) => minutesOf(x.startTime) - minutesOf(y.startTime)).forEach((r, i) => out.set(r.shiftId, i + 1))
    }
    return out
  }, [rows])
  const roundLabelOf = (r: ShiftInstance) => (roundNo.has(r.shiftId) ? `รอบ ${roundNo.get(r.shiftId)}` : null)

  const holiday = board?.dateLabel.split(' · ')[1]
  const arrivedCount = groups.inside.length + groups.out.length
  const lateCount = [...groups.inside, ...groups.out].filter((r) => r.status === 'late').length

  return (
    <div className="flex min-h-dvh w-full flex-col gap-4 bg-dash-page px-4 py-5 [font-family:'IBM_Plex_Sans_Thai','Noto_Sans_Thai',ui-sans-serif,sans-serif] text-dash-ink min-[1280px]:h-dvh min-[1280px]:overflow-hidden min-[1280px]:px-8 min-[1280px]:py-6">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[20px] text-dash-dim">
            {fullThaiDate(b.date)}
            {holiday && <span className="text-dash-brand"> · {holiday}</span>}
          </p>
          <h1 className="text-[36px] leading-tight font-semibold text-dash-brand">เช็คชื่อวันนี้</h1>
        </div>
        <p className="tnum leading-none font-semibold text-dash-brand" aria-label={`เวลา ${b.hh}:${b.mm}`}>
          <span className="text-[64px]">
            {b.hh}:{b.mm}
          </span>
          <span className="ml-1.5 text-[28px] text-dash-dim">{b.ss}</span>
        </p>
      </header>

      {error && board && (
        <p role="status" className="shrink-0 rounded-xl bg-dash-pending-bg px-4 py-2 text-[16px] text-dash-pending-ink">
          {error}
        </p>
      )}

      <Summary
        total={rows.length}
        arrived={arrivedCount}
        late={lateCount}
        pending={groups.pending.length}
        leave={groups.leave.length}
        absent={groups.absent.length}
      />

      <main className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] min-[1280px]:grid-rows-[minmax(0,1fr)]">
        <ScanCard canvasRef={canvasRef} hasToken={!!token} secondsLeft={secondsLeft} ttl={ttl} />

        {error && !board ? (
          <MessageCard>{error}</MessageCard>
        ) : !board ? (
          <MessageCard dim>กำลังโหลดรายชื่อ</MessageCard>
        ) : rows.length === 0 ? (
          <MessageCard>{holiday ? 'วันนี้เป็นวันหยุด' : 'วันนี้ไม่มีใครมีตารางงาน'}</MessageCard>
        ) : (
          <>
            <ArrivedCard inside={groups.inside} out={groups.out} />
            <div className="grid min-h-0 min-w-0 grid-cols-1 gap-4 min-[1280px]:grid-rows-[repeat(3,minmax(0,1fr))]">
              <ListBox
                icon={<IconPending />}
                tone="pending"
                title="ยังไม่มา"
                rows={groups.pending}
                empty="มากันครบแล้ว"
                note={roundLabelOf}
              />
              <ListBox icon={<IconLeave />} tone="leave" title="ลา" rows={groups.leave} empty="วันนี้ไม่มีใครลา" note={leaveReason} />
              <ListBox icon={<IconAbsent />} tone="absent" title="ขาด" rows={groups.absent} empty="วันนี้ไม่มีใครขาด" note={roundLabelOf} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ชิ้นส่วน
// ---------------------------------------------------------------------------

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
/** อักษรแรกของชื่อเล่นในวงกลม ชื่อที่ขึ้นต้นด้วยสระหน้า (เ แ โ ใ ไ) เอาพยัญชนะตามมาด้วย เช่น "เจ" */
function initialOf(name: string) {
  const chars = [...name]
  return /^[เแโใไ]/.test(name) ? chars.slice(0, 2).join('') : (chars[0] ?? '')
}

const CARD = 'rounded-[20px] border border-dash-line bg-white'

type Tone = 'present' | 'late' | 'pending' | 'leave' | 'absent' | 'offsite'
/** พื้น / ตัวอักษรของแต่ละสถานะ ดูค่าสีที่ --color-dash-* ใน index.css */
const TONE: Record<Tone, string> = {
  present: 'bg-dash-present-bg text-dash-present-ink',
  late: 'bg-dash-late-bg text-dash-late-ink',
  pending: 'bg-dash-pending-bg text-dash-pending-ink',
  leave: 'bg-dash-leave-bg text-dash-leave-ink',
  absent: 'bg-dash-absent-bg text-dash-absent-ink',
  offsite: 'bg-dash-offsite-bg text-dash-offsite-ink',
}

/** การ์ดสรุป 5 ช่องเท่ากัน + แถบสัดส่วน 1 ช่องต่อ 1 คน เรียง มาแล้ว → สาย → ยังไม่มา → ลา → ขาด */
function Summary({ total, arrived, late, pending, leave, absent }: { total: number; arrived: number; late: number; pending: number; leave: number; absent: number }) {
  const tiles: { tone: Tone; label: string; icon: ReactNode; n: number; of?: number }[] = [
    { tone: 'present', label: 'มาแล้ว', icon: <IconCheck />, n: arrived, of: total },
    { tone: 'pending', label: 'ยังไม่มา', icon: <IconPending />, n: pending },
    { tone: 'late', label: 'สาย', icon: <IconLate />, n: late },
    { tone: 'leave', label: 'ลา', icon: <IconLeave />, n: leave },
    { tone: 'absent', label: 'ขาด', icon: <IconAbsent />, n: absent },
  ]
  // สายนับรวมในมาแล้ว แถบจึงแยกส่วนที่มาแล้วแต่ไม่สายออกมาก่อน
  const segments: Tone[] = [
    ...Array<Tone>(Math.max(0, arrived - late)).fill('present'),
    ...Array<Tone>(late).fill('late'),
    ...Array<Tone>(pending).fill('pending'),
    ...Array<Tone>(leave).fill('leave'),
    ...Array<Tone>(absent).fill('absent'),
  ]
  return (
    <section aria-label="สรุปวันนี้" className={`${CARD} shrink-0 p-4`}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.tone} className={`flex min-w-0 items-center gap-3 rounded-2xl px-4 py-3 ${TONE[t.tone]}`}>
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/70 [&>svg]:size-5">
              {t.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[16px] leading-tight font-medium">{t.label}</span>
              <span className="tnum block text-[36px] leading-none font-semibold">
                {t.n}
                {t.of !== undefined && <span className="text-[22px] font-medium"> / {t.of}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {segments.length > 0 && (
        <div aria-hidden className="mt-3 flex h-3 gap-[3px]">
          {segments.map((tone, i) => (
            <span key={i} className={`min-w-0 flex-1 rounded-full ring-1 ring-current/25 ring-inset ${TONE[tone]}`} />
          ))}
        </div>
      )}
    </section>
  )
}

/** คอลัมน์ 1: QR ใหญ่เต็มความกว้าง (≥1280px ย่อให้พอดีความสูงที่เหลือ) นับถอยหลัง และขั้นตอน 3 ข้อ */
function ScanCard({
  canvasRef,
  hasToken,
  secondsLeft,
  ttl,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  hasToken: boolean
  secondsLeft: number
  ttl: number
}) {
  const whole = Math.ceil(secondsLeft)
  return (
    <section className={`${CARD} flex min-h-0 min-w-0 flex-col gap-4 p-5`}>
      <h2 className="text-[26px] leading-tight font-semibold text-dash-brand">สแกนเพื่อเช็คชื่อ</h2>
      <div className="flex min-h-0 flex-1 items-center justify-center min-[1280px]:[container-type:size]">
        <div className="aspect-square w-full max-w-[420px] rounded-2xl border border-dash-line bg-white p-3 min-[1280px]:aspect-auto min-[1280px]:size-[min(100cqw,100cqh)] min-[1280px]:max-w-none">
          <canvas ref={canvasRef} className={`block size-full ${hasToken ? '' : 'opacity-0'}`} aria-label="QR สำหรับเช็คชื่อ" role="img" />
        </div>
      </div>
      <div className="shrink-0">
        <p className="text-[18px] text-dash-dim">
          รหัสใหม่ใน <span className="tnum font-semibold text-dash-brand">{whole}</span> วินาที
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-dash-track">
          <div
            className="h-full rounded-full bg-dash-brand transition-[width] duration-300 ease-linear"
            style={{ width: `${Math.min(100, (secondsLeft / ttl) * 100)}%` }}
          />
        </div>
      </div>
      <ol className="grid shrink-0 grid-cols-3 gap-2">
        {['เปิดกล้องมือถือ', 'สแกน QR ด้านบน', 'ล็อกอินด้วย Google'].map((step, i) => (
          <li key={step} className="flex flex-col items-center gap-1.5 text-center">
            <span aria-hidden className="tnum flex size-9 items-center justify-center rounded-full bg-dash-pending-bg text-[18px] font-semibold text-dash-brand">
              {i + 1}
            </span>
            <span className="text-[16px] leading-snug">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** ป้ายสังกัด (พื้นเทาฟ้าทึบ) */
function Tags({ r }: { r: ShiftInstance }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="rounded-full bg-dash-org-bg px-2 py-px text-[14px] leading-tight font-medium whitespace-nowrap text-dash-org-ink">{r.projectName}</span>
    </span>
  )
}

function CountPill({ n, tone }: { n: number; tone: Tone }) {
  return <span className={`tnum rounded-full px-3 py-0.5 text-[18px] font-semibold ${TONE[tone]}`}>{n}</span>
}

const ARRIVED_STATUS: Partial<Record<ShiftInstance['status'], { label: string; tone: string }>> = {
  ontime: { label: 'ตรงเวลา', tone: 'bg-dash-neutral-bg text-dash-neutral-ink' },
  late: { label: 'สาย', tone: TONE.late },
  offsite: { label: 'ทำงานนอกสถานที่', tone: TONE.offsite },
}

/** คอลัมน์ 2 "มาแล้ว": ตาราง ชื่อ/สังกัด · เข้า · ออก · สถานะ คนออกงานแล้วแยกเป็นกลุ่มล่างสุด แถวสีจาง */
function ArrivedCard({ inside, out }: { inside: ShiftInstance[]; out: ShiftInstance[] }) {
  const total = inside.length + out.length
  return (
    <section className={`${CARD} flex min-h-0 min-w-0 flex-col p-5`}>
      <header className="mb-3 flex shrink-0 items-center gap-3">
        <span aria-hidden className={`flex size-10 items-center justify-center rounded-full [&>svg]:size-5 ${TONE.present}`}>
          <IconCheck />
        </span>
        <h2 className="text-[26px] leading-tight font-semibold text-dash-ink">มาแล้ว</h2>
        <CountPill n={total} tone="present" />
      </header>
      {total === 0 ? (
        <p className="text-[18px] text-dash-dim">ยังไม่มีใครสแกน</p>
      ) : (
        // ตารางแคบเกินเลื่อนแนวนอนในกล่องนี้ ไม่ให้ทั้งหน้าเลื่อนข้าง
        <div className="max-h-[70vh] min-h-0 flex-1 overflow-auto min-[1280px]:max-h-none">
          <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-[14px] text-dash-dim">
                <th scope="col" className="border-b border-dash-line py-2 pr-2 font-medium">ชื่อ / สังกัด</th>
                <th scope="col" className="border-b border-dash-line px-2 py-2 font-medium">เข้า</th>
                <th scope="col" className="border-b border-dash-line px-2 py-2 font-medium">ออก</th>
                <th scope="col" className="border-b border-dash-line py-2 pl-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {inside.map((r) => (
                <ArrivedRow key={r.shiftId} r={r} />
              ))}
            </tbody>
            {out.length > 0 && (
              <tbody>
                <tr>
                  <th scope="colgroup" colSpan={4} className="pt-4 pb-1.5 text-[16px] font-semibold text-dash-dim">
                    ออกงานแล้ว · <span className="tnum">{out.length}</span>
                  </th>
                </tr>
                {out.map((r) => (
                  <ArrivedRow key={r.shiftId} r={r} faded />
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  )
}

function ArrivedRow({ r, faded = false }: { r: ShiftInstance; faded?: boolean }) {
  const status = ARRIVED_STATUS[r.status] ?? ARRIVED_STATUS.ontime!
  const exit = r.checkedOutAt ?? r.earlyLeaveAt
  const cell = `border-b border-dash-line py-2 ${faded ? 'bg-dash-faded' : ''}`
  return (
    <tr className={faded ? 'text-dash-dim' : ''}>
      <td className={`${cell} pr-2 pl-1`}>
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold ${faded ? 'bg-dash-neutral-bg text-dash-neutral-ink' : TONE.present}`}>
            {initialOf(r.nickname)}
          </span>
          <div className="min-w-0">
            <p className={`truncate text-[20px] leading-tight font-semibold ${faded ? '' : 'text-dash-ink'}`}>{r.nickname}</p>
            <div className="mt-1">
              <Tags r={r} />
            </div>
          </div>
        </div>
      </td>
      <td className={`${cell} tnum px-2 text-[18px]`}>{hhmm(r.scannedAt)}</td>
      <td className={`${cell} tnum px-2 text-[18px]`}>
        {exit ? (
          <>
            {hhmm(exit)}
            {!r.checkedOutAt && <span className="block text-[14px]">กลับก่อน</span>}
          </>
        ) : (
          <span aria-label="ยังไม่ออก">–</span>
        )}
      </td>
      <td className={`${cell} pl-2`}>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[14px] font-medium whitespace-nowrap ${status.tone}`}>{status.label}</span>
      </td>
    </tr>
  )
}

/** ลาเพราะอะไร: ประเภทจากใบลา (ลาป่วย / ลากิจ + ครึ่งวัน) ถ้าแอดมินกดลาให้เองใช้หมายเหตุของแอดมิน
 * ไม่แสดงเหตุผลที่พนักงานพิมพ์ในใบลา เพราะจอนี้ติดผนังให้ทุกคนเห็น อาจมีเรื่องสุขภาพส่วนตัว
 */
const LEAVE_TYPE: Record<LeaveType, string> = { sick: 'ลาป่วย', personal: 'ลากิจ' }
const LEAVE_PORTION: Record<LeaveDuration, string> = { full_day: '', morning: 'ครึ่งเช้า', afternoon: 'ครึ่งบ่าย' }
function leaveReason(r: ShiftInstance) {
  const portion = r.leavePortion ? LEAVE_PORTION[r.leavePortion] : ''
  if (r.leaveType) return [LEAVE_TYPE[r.leaveType], portion].filter(Boolean).join(' · ')
  return r.adminNote || ['ลา', portion].filter(Boolean).join(' · ')
}

/** คอลัมน์ 3: กล่องรายชื่อ ยังไม่มา / ลา / ขาด สูงเท่ากัน หมายเหตุชิดขวา รายชื่อยาวเลื่อนในกล่อง */
function ListBox({
  icon,
  tone,
  title,
  rows,
  empty,
  note,
}: {
  icon: ReactNode
  tone: Tone
  title: string
  rows: ShiftInstance[]
  empty: string
  note: (r: ShiftInstance) => string | null
}) {
  return (
    <section className={`${CARD} flex min-h-0 min-w-0 flex-col p-4`}>
      <header className="mb-2 flex shrink-0 items-center gap-3">
        <span aria-hidden className={`flex size-9 items-center justify-center rounded-full [&>svg]:size-5 ${TONE[tone]}`}>
          {icon}
        </span>
        <h2 className="text-[22px] leading-tight font-semibold text-dash-ink">{title}</h2>
        <CountPill n={rows.length} tone={tone} />
      </header>
      {rows.length === 0 ? (
        <p className="text-[16px] text-dash-dim">{empty}</p>
      ) : (
        <ul className="grid max-h-[50vh] min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pr-1 min-[1280px]:max-h-none">
          {rows.map((r) => {
            const n = note(r)
            return (
              <li key={r.shiftId} className={`flex min-w-0 items-center gap-2.5 rounded-xl px-4 py-2.5 ${TONE[tone]}`}>
                <span className="min-w-0 truncate text-[20px] leading-tight font-semibold">{r.nickname}</span>
                <Tags r={r} />
                {n && <span className="ml-auto shrink-0 text-[16px] font-medium whitespace-nowrap">{n}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function MessageCard({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <section className={`${CARD} flex min-h-[40vh] items-center justify-center p-8 text-center min-[1280px]:col-span-2`}>
      <p className={dim ? 'text-[20px] text-dash-dim' : 'text-[30px] font-semibold text-dash-ink'}>{children}</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ไอคอน (เส้น currentColor เรียบ ไม่มีสีของตัวเอง)
// ---------------------------------------------------------------------------

function IconPending(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconLate(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5M5 3.5 2.5 6M19 3.5 21.5 6" />
    </svg>
  )
}

function IconLeave(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3.5 10h17" />
    </svg>
  )
}

function IconAbsent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

/**
 * กันจอดับเองระหว่างเปิดหน้านี้ (Chrome, Edge, Safari 16.4+)
 * ขอใหม่ทุกครั้งที่กลับมาที่แท็บ เพราะเบราว์เซอร์ปล่อยอัตโนมัติเมื่อแท็บถูกซ่อน
 */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // เบราว์เซอร์ไม่อนุญาต ไม่เป็นไร ตั้งค่าไม่ให้จอดับที่เครื่องแทน
      }
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      document.removeEventListener('visibilitychange', request)
      lock?.release().catch(() => {})
    }
  }, [])
}
