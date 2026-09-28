import { useEffect, useMemo, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { bangkok, minutesOf, shortWeekdayDate } from '../lib/format'
import type { KioskBoard, ShiftInstance } from '../lib/types'
import AttendanceMascot, { type MascotEvent } from '../components/AttendanceMascot'

/**
 * จอติดผนังในออฟฟิศ เปิดทิ้งไว้ทั้งวัน อ่านจากระยะ 2–3 เมตร (ออกแบบที่ 1440×900)
 *
 * บน: นาฬิกา+วันที่ (ซ้าย) · แถบสถิติ (ขวา)
 * ล่าง: การ์ด QR | "ยังไม่มา" | "มาแล้ว" | "ลา" สี่การ์ดเรียงข้างกัน สูงเท่ากัน รายชื่อยาวเลื่อนในการ์ด
 * จอแคบกว่า 1200px: เหลือคอลัมน์เดียว และให้ทั้งหน้าเลื่อนได้
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
      width: 640,
      margin: 1,
      // พื้นโปร่ง วางบนกรอบขาวทึบ (ดู QRCard)
      color: { dark: '#212529', light: '#ffffff00' },
    }).then(() => {
      // ไลบรารีใส่ขนาดเป็น inline style ล้างออกให้ขนาดตาม class (วาดใหญ่แล้วย่อ จึงคมบนจอความละเอียดสูง)
      canvas.style.width = ''
      canvas.style.height = ''
    })
  }, [token])

  const b = useMemo(() => bangkok(now), [now])
  const nowMin = minutesOf(`${b.hh}:${b.mm}`)
  const rows = board?.today ?? []
  const { pending, arrived, leave, absent, multiShift } = useMemo(() => {
    const byStart = (x: ShiftInstance, y: ShiftInstance) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th')
    const afternoon = nowMin >= 13 * 60
    const activeLeave = (r: ShiftInstance) =>
      r.leavePortion === 'full_day' ||
      (r.leavePortion === 'morning' && !afternoon) ||
      (r.leavePortion === 'afternoon' && afternoon)
    // คนที่มีหลายกะในวันเดียว ต้องบอกให้ชัดว่ารายการไหนเป็นรอบไหน
    const count = new Map<string, number>()
    for (const r of rows) count.set(r.employeeId, (count.get(r.employeeId) ?? 0) + 1)
    return {
      pending: rows.filter((r) => r.status === 'pending' && !activeLeave(r)).sort(byStart),
      // คนที่เพิ่งสแกนอยู่บนสุด คนที่ยืนอยู่หน้าจอจะเห็นชื่อตัวเองขึ้นทันที
      arrived: rows.filter((r) => ['ontime', 'late', 'offsite'].includes(r.status) && !activeLeave(r)).sort((x, y) => (y.scannedAt ?? '').localeCompare(x.scannedAt ?? '')),
      leave: rows.filter((r) => r.status === 'leave' || activeLeave(r)),
      absent: rows.filter((r) => r.status === 'absent'),
      multiShift: new Set([...count].filter(([, n]) => n > 1).map(([id]) => id)),
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

  const fullscreen = useFullscreen()
  useWakeLock()
  const mascotEvent = useMascotEvent({ board, arrived, leave, absent })

  const roundOf = (r: ShiftInstance) => (multiShift.has(r.employeeId) ? `${r.startTime}–${r.endTime}` : null)

  return (
    <div className="kiosk-theme flex min-h-dvh w-full flex-col gap-7 px-5 py-6 font-sans text-text min-[1200px]:h-dvh min-[1200px]:overflow-hidden min-[1200px]:px-12 min-[1200px]:py-9">
      {/* ================= Header ================= */}
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="display tnum leading-none font-bold tracking-tight text-text text-[clamp(56px,9.8vh,88px)]">
            {b.hh}:{b.mm}
            <span className="ml-2 align-top text-[30px] font-semibold text-k-seconds">{b.ss}</span>
          </p>
          <p className="mt-2 text-[20px] text-text-dim">{shortWeekdayDate(b.date)}</p>
          {error && board && <p className="mt-1 text-[16px] text-k-orange">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <StatChips summary={board?.summary} />
          {!fullscreen.active && fullscreen.supported && (
            <button onClick={fullscreen.enter} className="panel rounded-full px-4 py-2 text-[14px] font-medium text-text-dim hover:text-text">
              เต็มจอ
            </button>
          )}
        </div>
      </header>

      {/*
        มาสคอตสุนัข: เดินเล่นอยู่บนขอบบนของการ์ดสามใบ อยู่ในเลย์เอาต์ปกติ (ไม่ absolute)
        -mt ลบระยะห่างใต้ header ส่วน -mb ดึงการ์ดขึ้นมาให้เท้าทับขอบบนการ์ด 6px จึงดูเหมือนยืนอยู่บนการ์ด
        z-10 + pointer-events:none (จาก .am-track) ลอยทับการ์ดได้โดยไม่บังการคลิก
      */}
      <AttendanceMascot event={mascotEvent} className="relative z-10 -mt-7 -mb-[calc(1.75rem+6px)]" />

      {/* ================= Main: QR (440px ที่จอ 1440 ยืดตามจอ) | ยังไม่มา | มาแล้ว เรียงข้างกันสูงเท่ากัน ================= */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-7 min-[1200px]:grid-cols-[clamp(320px,27%,560px)_1fr_1fr_1fr] min-[1200px]:grid-rows-[minmax(0,1fr)]">
        <QRCard canvasRef={canvasRef} secondsLeft={secondsLeft} ttl={ttl} hasToken={!!token} />

        {error && !board ? (
          <MessageCard>{error}</MessageCard>
        ) : !board ? (
          <MessageCard dim>กำลังโหลดรายชื่อ</MessageCard>
        ) : rows.length === 0 ? (
          <MessageCard>{board.dateLabel.includes('·') ? 'วันนี้เป็นวันหยุด' : 'วันนี้ไม่มีใครมีตารางงาน'}</MessageCard>
        ) : (
          <>
            <PendingCard rows={pending} absent={absent} nowMin={nowMin} roundOf={roundOf} />
            <ArrivedCard rows={arrived} roundOf={roundOf} />
            <LeaveCard rows={leave} roundOf={roundOf} />
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
/** ป้ายกำกับชื่อ: Gen สำหรับนักศึกษา ชื่อโปรเจกสำหรับพนักงานประจำ เพราะชื่อเล่นซ้ำกันได้ */
const tagOf = (r: ShiftInstance) => r.gen ?? r.projectName

/** การ์ดกระจกฝ้าบนพื้นกรมท่า (class panel ใน index.css สลับตัวหนังสือในการ์ดเป็นแดงให้เอง) */
const PANEL_CARD = 'panel rounded-2xl'
/** ชั้นกระจกที่ลอยอยู่บนการ์ดอีกชั้น (แถวรายชื่อ ช่องสถิติ) ดู .glass-tile ใน index.css */
const PANEL_TILE = 'glass-tile'

/**
 * ของในการ์ดย่อ/ขยายตามขนาดการ์ด: section เป็น container แล้ว div ข้างในตั้ง
 * --u = 1px ที่ขนาดออกแบบ (1440×900) คิดจากความกว้าง/สูงของการ์ดเอง
 * และตั้ง --spacing ของ Tailwind ใหม่ให้ p-/gap-/size- ทั้งหมดคิดจาก --u ด้วย
 * ทุกอย่างในการ์ด (ตัวหนังสือ ระยะห่าง ไอคอน) ย่อ/ขยายตามสัดส่วนการ์ดเดียวกัน จอเปลี่ยนขนาดแล้วไม่บีบ
 * ไม่เล็กกว่า 0.5 เท่า และไม่ใหญ่กว่า 1.75 เท่าของขนาดออกแบบ
 */
function Card({
  children,
  unit,
  sized = true,
  className = '',
  inner = '',
}: {
  children: ReactNode
  /** สูตร --u ของการ์ดนี้ เช่น 'min(0.2273cqw,0.1493cqh)' (= 1px เมื่อการ์ดกว้าง 440 สูง 670) */
  unit: string
  /** true = วัดทั้งกว้างและสูง (การ์ดต้องมีความสูงแน่นอน) · false = วัดแค่ความกว้าง (การ์ดสูงตามเนื้อหา) */
  sized?: boolean
  className?: string
  inner?: string
}) {
  return (
    <section className={`${PANEL_CARD} flex min-h-0 min-w-0 ${sized ? '[container-type:size]' : '[container-type:inline-size]'} ${className}`}>
      <div
        className={`flex min-h-0 w-full flex-col ${sized ? 'h-full' : ''} ${inner}`}
        style={
          {
            '--u': `clamp(0.5px, ${unit}, 1.75px)`,
            '--spacing': 'calc(var(--u) * 4)',
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </section>
  )
}

// สูตร --u ต่อการ์ด: 100/ขนาดออกแบบ (px) ของการ์ดนั้น
// ขนาดที่เนื้อหาในการ์ดวางพอดีโดยไม่ต้องขึ้นบรรทัดใหม่ การ์ดแคบกว่านี้ทุกอย่างย่อตามสัดส่วนเดียวกัน
const U_QR = 'min(0.2273cqw, 0.1493cqh)' // 440 × 670
const U_LIST = '0.2358cqw' // 424 = แถว "มาแล้ว" ที่ยาวที่สุด (ชื่อ + Gen + รอบ + สาย + เวลา) วางพอดีบรรทัดเดียว
/** แถบสถิติไม่ได้อยู่ในการ์ด จึงย่อ/ขยายตามความกว้างจอแทน (1px ที่จอกว้าง 1440) */
const U_SCREEN = 'clamp(0.6px, 0.0694vw, 1.5px)'

/**
 * สถิติ ยังไม่มา / สาย / ลา / ขาด แบบ Floating Navigation Bar: แคปซูลเดียวลอย เงาลึก พื้นโปร่งเบลอ
 * แต่ละช่อง = กล่องกระจกลอยบนแคปซูลกระจกอีกชั้น · "ยังไม่มา" ที่ยังมีคนค้างเน้นเป็นแคปซูลขาวทึบ ตัวหนังสือแดงเข้ม
 * ค่า 0 เป็นขาวจาง (k-zero)
 */
function StatChips({ summary }: { summary?: KioskBoard['summary'] }) {
  const s = summary ?? {
    expected: 0,
    arrived: 0,
    late: 0,
    pending: 0,
    leave: 0,
    absent: 0,
  }
  const items: {
    label: string
    n: number
    tone: string
    icon: ReactNode
    active?: boolean
  }[] = [
    {
      label: 'ยังไม่มา',
      n: s.pending,
      tone: 'bg-k-orange-tint text-k-orange',
      icon: <IconPending />,
      active: s.pending > 0,
    },
    {
      label: 'สาย',
      n: s.late,
      tone: 'bg-k-orange-tint text-k-orange',
      icon: <IconLate />,
    },
    {
      label: 'ลา',
      n: s.leave,
      tone: 'bg-k-neutral-tint text-text',
      icon: <IconLeave />,
    },
    {
      label: 'ขาด',
      n: s.absent,
      tone: 'bg-k-red-tint text-k-red',
      icon: <IconAbsent />,
    },
  ]
  return (
    <nav
      aria-label="สรุปวันนี้"
      className="panel flex items-center gap-2 rounded-full p-2"
      style={{ '--u': U_SCREEN, '--spacing': 'calc(var(--u) * 4)' } as React.CSSProperties}
    >
      {items.map((c) => {
        const zero = c.n === 0
        return (
          <div
            key={c.label}
            className={`flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 transition-colors ${c.active ? 'border border-brand bg-brand text-on-brand shadow-[0_8px_18px_-8px_rgba(176,18,10,0.6)]' : PANEL_TILE}`}
          >
            <span
              aria-hidden
              className={`flex size-9 shrink-0 items-center justify-center rounded-full [&>svg]:size-5 ${
                c.active ? 'bg-white/20 text-white' : zero ? 'bg-k-neutral-tint text-k-zero' : c.tone
              }`}
            >
              {c.icon}
            </span>
            <span className="flex flex-col leading-none">
              <span className={`display tnum text-[calc(22*var(--u))] font-bold ${c.active ? '' : zero ? 'text-k-zero' : 'text-text'}`}>{c.n}</span>
              <span className={`mt-1 text-[calc(14*var(--u))] whitespace-nowrap ${c.active ? 'text-white' : zero ? 'text-k-zero' : 'text-text-dim'}`}>{c.label}</span>
            </span>
          </div>
        )
      })}
    </nav>
  )
}

function QRCard({
  canvasRef,
  secondsLeft,
  ttl,
  hasToken,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  secondsLeft: number
  ttl: number
  hasToken: boolean
}) {
  const whole = Math.ceil(secondsLeft)
  const soon = whole <= 5
  return (
    <Card
      unit={U_QR}
      className="flex-1 min-[1200px]:[container-type:size] max-[1199px]:[container-type:inline-size]"
      inner="items-center justify-center gap-5 px-8 py-8 text-center"
    >
      <h2 className="display text-[calc(32*var(--u))] leading-tight font-bold text-text">สแกนเพื่อเช็กชื่อ</h2>

      {/*
        กรอบ QR: ชั้นนอกเป็นกระจกลอยบนการ์ด · ชั้นในรอบตัว QR ขาวทึบ (QR วาดพื้นโปร่ง) กล้องมือถือจึงอ่านได้
      */}
      <div className="glass-tile rounded-2xl p-3">
        <div className="rounded-lg bg-white p-2.5">
          <canvas ref={canvasRef} className={`block size-[calc(300*var(--u))] ${hasToken ? '' : 'opacity-0'}`} aria-label="QR สำหรับเช็กชื่อ" />
        </div>
      </div>

      {/* นับถอยหลังถึงรอบเปลี่ยน QR เหลือ ≤5 วินาทีแถบเปลี่ยนเป็นสีส้ม */}
      <div className="w-[calc(300*var(--u))]">
        <p className="text-[calc(17*var(--u))] text-text-dim">
          รหัสใหม่ใน <span className={`tnum font-semibold ${soon ? 'text-k-orange' : 'text-text'}`}>{whole}</span> วินาที
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-k-track">
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-300 ease-linear ${soon ? 'bg-k-orange-dot' : 'bg-k-blue'}`}
            style={{ width: `${Math.min(100, (secondsLeft / ttl) * 100)}%` }}
          />
        </div>
      </div>

      <ol className="grid w-full grid-cols-3 gap-2">
        {['เปิดกล้องมือถือ', 'สแกน QR', 'ล็อกอิน Google'].map((t, i) => (
          <li key={t} className="flex flex-col items-center gap-2">
            <span className="display tnum flex size-9 items-center justify-center rounded-full bg-k-blue-tint text-[calc(18*var(--u))] font-bold text-k-blue">
              {i + 1}
            </span>
            <span className="text-[calc(16*var(--u))] leading-snug text-text">{t}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function CardHeader({ icon, tone, title, count, aside }: { icon: ReactNode; tone: string; title: string; count: number; aside?: ReactNode }) {
  return (
    <header className="mb-4 flex shrink-0 items-center gap-3">
      <span aria-hidden className={`flex size-11 shrink-0 items-center justify-center rounded-full ${tone}`}>
        {icon}
      </span>
      <h2 className="display text-[calc(24*var(--u))] font-bold text-text">{title}</h2>
      <span className={`display tnum rounded-full px-3 py-0.5 text-[calc(18*var(--u))] font-bold ${tone}`}>{count}</span>
      {aside && <span className="ml-auto text-[calc(16*var(--u))] text-text-dim">{aside}</span>}
    </header>
  )
}

/**
 * "ยังไม่มา": คอลัมน์กลาง สูงเท่าการ์ด QR รายชื่อเป็นแถวยาวเต็มการ์ดทีละคน ยาวเกินเลื่อนในการ์ด
 * คนที่ถูกตัดเป็น "ขาด" แล้วยังอยู่ในการ์ดนี้ แต่ไว้ล่างสุดต่อจากคนที่ยังไม่มา ชื่อแดงเข้ม ตามด้วยป้าย "ขาด" แดงทึบ
 * ตัวเลขบนหัวการ์ดนับเฉพาะคนที่ยังไม่มา ให้ตรงกับแถบสถิติด้านบน (ขาดมีช่องของตัวเอง)
 */
function PendingCard({
  rows,
  absent,
  nowMin,
  roundOf,
}: {
  rows: ShiftInstance[]
  absent: ShiftInstance[]
  nowMin: number
  roundOf: (r: ShiftInstance) => string | null
}) {
  const byStart = (x: ShiftInstance, y: ShiftInstance) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th')
  // คนที่ยังไม่มาอยู่บน คนที่ขาดแล้วอยู่ล่างสุด (แต่ละกลุ่มเรียงตามเวลานัด)
  const list = [...[...rows].sort(byStart), ...[...absent].sort(byStart)]
  return (
    <Card unit={U_LIST} sized={false} inner="p-6">
      <CardHeader icon={<IconPending className="size-6" />} tone="bg-k-orange-tint text-k-orange" title="ยังไม่มา" count={rows.length} />
      {list.length === 0 ? (
        <p className="text-[calc(18*var(--u))] text-text-dim">มาครบทุกคนแล้ว</p>
      ) : (
        <ul className="scroll-list grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2.5 overflow-y-auto pr-1">
          {list.map((r) => {
            const isAbsent = r.status === 'absent'
            // เลยเวลานัดแล้ว: จุดกะพริบเบาๆ (คนที่ขาดแล้วไม่ต้องกะพริบ)
            const overdue = !isAbsent && minutesOf(r.startTime) <= nowMin
            return (
              <li
                key={r.shiftId}
                className={`flex min-w-0 items-center gap-2 rounded-2xl px-3.5 py-2 ${isAbsent ? 'border border-k-red/40 bg-k-red-tint' : PANEL_TILE}`}
              >
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${isAbsent ? 'bg-k-red' : 'bg-k-orange-dot'} ${overdue ? 'animate-pulse-soft' : ''}`} />
                <span className={`min-w-0 truncate text-[calc(18*var(--u))] ${isAbsent ? 'font-bold text-k-red' : 'font-semibold text-text'}`}>{r.nickname}</span>
                {isAbsent && (
                  <span className="shrink-0 rounded-full bg-k-red px-2 py-0.5 text-[calc(13*var(--u))] font-semibold text-white">ขาด</span>
                )}
                <Tag line="border-k-orange-line">{tagOf(r)}</Tag>
                <span className="tnum ml-auto shrink-0 text-[calc(15*var(--u))] font-semibold whitespace-nowrap text-k-orange">นัด {roundOf(r) ?? r.startTime}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** "มาแล้ว": คอลัมน์ขวา สูงเท่าการ์ด QR ล่าสุดอยู่บนสุด เลื่อนในการ์ดเมื่อยาวเกิน */
function ArrivedCard({ rows, roundOf }: { rows: ShiftInstance[]; roundOf: (r: ShiftInstance) => string | null }) {
  return (
    <Card unit={U_LIST} sized={false} className="arrived-theme max-h-[75vh] min-[1200px]:max-h-none" inner="p-6">
      <CardHeader icon={<IconCheck className="size-6" />} tone="bg-k-blue-tint text-k-blue" title="มาแล้ว" count={rows.length} aside="ล่าสุดอยู่บนสุด" />
      {rows.length === 0 ? (
        <p className="text-[calc(18*var(--u))] text-text-dim">ยังไม่มีใครสแกน</p>
      ) : (
        // การ์ดกว้าง (จอแคบกว่า 1200px ที่การ์ดยืดเต็มจอ) แบ่งเป็นหลายคอลัมน์ การ์ดแคบเหลือคอลัมน์เดียว
        <ul className="scroll-list grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-2.5 overflow-y-auto pr-1">
          {rows.map((r, i) => {
            const latest = i === 0
            const late = r.status === 'late'
            const offsite = r.offsite || r.status === 'offsite'
            const exitedAt = r.checkedOutAt ?? r.earlyLeaveAt
            const round = roundOf(r)
            return (
              <li
                // key ผูกกับกะ: มีคนเช็กชื่อใหม่ = แถวใหม่ถูก mount แอนิเมชันเข้าจึงเล่นครั้งเดียวกับคนนั้น
                key={r.shiftId}
                // ป้ายเยอะจนไม่พอในบรรทัดเดียว (เช่น มีรอบ + สาย) ให้ขึ้นบรรทัดใหม่ แทนการบีบชื่อจนอ่านไม่ออก
                // กรอบฟ้าเทา #B5C8D4 · มาสายส้ม #FDD5BA ขอบ #F4A06B · นอกสถานที่เขียว #BFE0DC ขอบ #7FC0B8 (มาก่อนสาย)
                // แถวล่าสุดขอบหนาสีเดียวกับตัวหนังสือของแถวนั้น
                className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl px-3.5 py-2 ${
                  offsite ? 'offsite-row bg-arrived-offsite-bg' : late ? 'late-row bg-arrived-late-bg' : 'bg-arrived-bg'
                } ${
                  latest
                    ? 'border-2 border-arrived-text shadow-[0_6px_16px_-10px_rgba(23,52,92,0.6)] motion-safe:animate-arrive'
                    : `border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${
                        offsite ? 'border-arrived-offsite-line' : late ? 'border-arrived-late-line' : 'border-white/70'
                      }`
                }`}
              >
                <span className="max-w-full min-w-0 truncate text-[calc(18*var(--u))] font-semibold text-text">{r.nickname}</span>
                <Tag line="border-k-blue-tag-line">{tagOf(r)}</Tag>
                {round && <Tag line="border-k-blue-tag-line">รอบ {round}</Tag>}
                {offsite && <Tag line="border-k-blue-tag-line">นอกสถานที่</Tag>}
                {exitedAt && <Tag line="border-k-blue-tag-line">{r.earlyLeaveAt && !r.checkedOutAt ? 'ออกก่อนเวลา' : 'ออกงานแล้ว'}</Tag>}
                <span className="ml-auto flex shrink-0 items-baseline gap-2">
                  {late && <span className="text-[calc(14*var(--u))] font-semibold text-k-orange">สาย</span>}
                  <span className="tnum text-[calc(18*var(--u))] font-semibold text-k-blue">{hhmm(exitedAt ?? r.scannedAt)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** "ลา": คอลัมน์ขวาสุด คนที่แอดมินบันทึกว่าลาวันนี้ เรียงตามเวลานัด พร้อมเหตุผลที่แอดมินจดไว้ (ถ้ามี) */
function LeaveCard({ rows, roundOf }: { rows: ShiftInstance[]; roundOf: (r: ShiftInstance) => string | null }) {
  const list = [...rows].sort((x, y) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th'))
  return (
    <Card unit={U_LIST} sized={false} className="max-h-[75vh] min-[1200px]:max-h-none" inner="p-6">
      <CardHeader icon={<IconLeave className="size-6" />} tone="bg-leave-row-bg text-leave-row-text" title="ลา" count={list.length} />
      {list.length === 0 ? (
        <p className="text-[calc(18*var(--u))] text-text-dim">วันนี้ไม่มีใครลา</p>
      ) : (
        <ul className="scroll-list grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2.5 overflow-y-auto pr-1">
          {list.map((r) => (
            // พื้นเหลือง #FCD9A3 ขอบ #F0B25C ตัวหนังสือ #B45309
            <li key={r.shiftId} className="leave-row flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-leave-row-line bg-leave-row-bg px-3.5 py-2">
              <span className="min-w-0 truncate text-[calc(18*var(--u))] font-semibold text-text">{r.nickname}</span>
              <Tag line="border-rule">{tagOf(r)}</Tag>
              <span className="tnum ml-auto shrink-0 text-[calc(15*var(--u))] font-semibold whitespace-nowrap text-text-dim">
                {roundOf(r) ?? `${r.startTime}–${r.endTime}`}
              </span>
              {r.adminNote && <span className="w-full truncate text-[calc(14*var(--u))] text-text-dim">{r.adminNote}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** ป้ายกลุ่ม (Gen / โปรเจก) พื้นขาว ตัวหนังสือสีรอง อ่านชัด เพราะชื่อเล่นซ้ำกันได้ */
function Tag({ children, line }: { children: ReactNode; line: string }) {
  return (
    <span className={`tnum shrink-0 rounded-full border bg-white px-2 py-0.5 text-[calc(13*var(--u))] font-medium whitespace-nowrap text-text-dim ${line}`}>
      {children}
    </span>
  )
}

function MessageCard({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <Card unit={U_LIST} sized={false} className="min-h-[40vh] min-[1200px]:col-span-3" inner="items-center justify-center p-8 text-center">
      <p className={dim ? 'text-[calc(20*var(--u))] text-text-dim' : 'display text-[calc(32*var(--u))] font-semibold text-text'}>{children}</p>
    </Card>
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

function useFullscreen() {
  const [active, setActive] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  return {
    active,
    supported: !!document.documentElement.requestFullscreen,
    enter: () => document.documentElement.requestFullscreen?.().catch(() => {}),
  }
}

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

/**
 * ผูกมาสคอตกับข้อมูลบอร์ดแบบหลวมๆ (ตามสเปก AttendanceMascot ข้อ 10: component ไม่ควรผูกกับข้อมูลพนักงานโดยตรง)
 * หน้าที่ของ hook นี้คือ diff รายชื่อ "มาแล้ว/ลา/ขาด" ระหว่างการโพลแต่ละรอบ
 * แล้วแปลงเป็น MascotEvent ก้อนเดียวส่งให้ <AttendanceMascot event={...} /> เล่นเอง
 * รอบแรกที่ข้อมูลโหลดมา (เพิ่งเปิดจอ/รีเฟรช) จะไม่ฉลองย้อนหลังให้คนที่มาก่อนจอจะเปิดอยู่แล้ว — แค่จดจำสถานะตั้งต้นไว้
 */
function useMascotEvent({
  board,
  arrived,
  leave,
  absent,
}: {
  board: KioskBoard | null
  arrived: ShiftInstance[]
  leave: ShiftInstance[]
  absent: ShiftInstance[]
}) {
  const [event, setEvent] = useState<MascotEvent | null>(null)
  const seenArrived = useRef<Set<string> | null>(null)
  const seenLeave = useRef<Set<string> | null>(null)
  const seenAbsent = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!board) return
    const arrivedIds = new Set(arrived.map((r) => r.shiftId))
    const leaveIds = new Set(leave.map((r) => r.shiftId))
    const absentIds = new Set(absent.map((r) => r.shiftId))

    // โหลดรอบแรก: จดจำสถานะตั้งต้น ไม่ต้องฉลองอะไร
    if (!seenArrived.current) {
      seenArrived.current = arrivedIds
      seenLeave.current = leaveIds
      seenAbsent.current = absentIds
      return
    }

    const newArrivals = arrived.filter((r) => !seenArrived.current!.has(r.shiftId))
    const newLeaves = leave.filter((r) => !seenLeave.current!.has(r.shiftId))
    const newAbsents = absent.filter((r) => !seenAbsent.current!.has(r.shiftId))
    seenArrived.current = arrivedIds
    seenLeave.current = leaveIds
    seenAbsent.current = absentIds

    if (newArrivals.length > 1) {
      // หลายคนเช็คชื่อในโพลรอบเดียวกัน: ฉลองรวบยอดครั้งเดียว กันมาสคอตวิ่งวนกินขนมรัวๆ
      setEvent({ id: `multi-${Date.now()}`, type: 'MULTIPLE_CHECK_IN', count: newArrivals.length })
    } else if (newArrivals.length === 1) {
      const r = newArrivals[0]
      // มาก่อนเวลาเข้ากะอย่างน้อย 15 นาที ถือว่า "มาไว" ได้ฉลองพิเศษหน่อย
      const early = r.status === 'ontime' && !!r.scannedAt && minutesOf(r.scannedAt) <= minutesOf(r.startTime) - 15
      setEvent({
        id: `arr-${r.shiftId}-${r.scannedAt}`,
        type: early ? 'EARLY_CHECK_IN' : 'CHECK_IN',
        name: r.nickname,
        tag: tagOf(r),
      })
    } else if (newLeaves.length > 0) {
      setEvent({ id: `leave-${newLeaves[0].shiftId}-${Date.now()}`, type: 'LEAVE', name: newLeaves[0].nickname })
    } else if (newAbsents.length > 0) {
      setEvent({ id: `absent-${newAbsents[0].shiftId}-${Date.now()}`, type: 'ABSENT', name: newAbsents[0].nickname })
    }
  }, [board, arrived, leave, absent])

  return event
}
