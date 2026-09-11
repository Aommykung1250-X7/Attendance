import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { bangkok, minutesOf } from '../lib/format'
import type { KioskBoard, ShiftInstance } from '../lib/types'

/**
 * จอติดผนังในออฟฟิศ เปิดทิ้งไว้ทั้งวัน ไม่มีใครมาเลื่อน
 * ทุกอย่างต้องอยู่ในจอเดียว ห้ามมีแถบเลื่อน ถ้ารายชื่อยาวให้ตัวหนังสือเล็กลงเองแทน
 *
 * ซ้าย: ตัวเลขสรุปของวันนี้ → นาฬิกาเซิร์ฟเวอร์ → QR
 * ขวา: กล่อง "ใครต้องมาวันนี้" แบ่งเป็น ยังไม่มา | มาแล้ว และแถบ ลา/ขาด ด้านล่าง
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
      width: 420,
      margin: 1,
      color: { dark: '#212529', light: '#ffffff' },
    }).then(() => {
      // ไลบรารีใส่ขนาดเป็น inline style ล้างออกให้ขนาดตาม class (วาดใหญ่แล้วย่อ จึงคมบนจอความละเอียดสูง)
      canvas.style.width = ''
      canvas.style.height = ''
    })
  }, [token])

  const clock = useMemo(() => bangkok(now), [now])
  const fullscreen = useFullscreen()
  useWakeLock()

  return (
    <div className="grid h-dvh w-screen grid-cols-[clamp(300px,29vw,540px)_minmax(0,1fr)] gap-[clamp(16px,2vw,40px)] overflow-hidden bg-paper p-[clamp(16px,2.2vw,44px)] text-text">
      {/* ================= ซ้าย ================= */}
      <aside className="flex min-h-0 flex-col gap-[clamp(14px,2.6vh,32px)]">
        <Summary summary={board?.summary} />

        <div>
          <p className="display truncate text-[clamp(15px,2.1vh,24px)] text-text-dim">{board?.dateLabel ?? ' '}</p>
          <p className="display tnum text-[clamp(56px,12.5vh,148px)] leading-[0.95] font-semibold tracking-tight">
            {clock.hh}
            <span className="text-text-dim">:</span>
            {clock.mm}
            <span className="ml-[0.12em] align-top text-[0.36em] text-text-dim">{clock.ss}</span>
          </p>
        </div>

        {/* การ์ด QR แนวตั้ง: ข้อความอยู่บน รูปอยู่ล่าง */}
        <div className="mt-auto flex min-h-0 flex-col items-center rounded-2xl border border-rule bg-surface p-[clamp(12px,1.8vh,22px)] text-center shadow-sm">
          <p className="display text-[clamp(20px,3.1vh,34px)] leading-tight font-semibold">สแกนเพื่อเช็กชื่อ</p>
          <p className="mt-1 text-[clamp(13px,1.7vh,18px)] leading-snug text-text-dim">ใช้กล้องมือถือสแกน แล้วเข้าสู่ระบบด้วย Google</p>
          <div className="mt-[clamp(10px,1.6vh,18px)] rounded-xl border border-rule bg-white p-[clamp(6px,0.9vh,10px)]">
            <canvas ref={canvasRef} className="block size-[clamp(140px,27vh,300px)]" aria-label="QR สำหรับเช็กชื่อ" />
          </div>
          <p className="mt-[clamp(8px,1.2vh,12px)] text-[clamp(12px,1.5vh,16px)] text-text-dim">รหัสเปลี่ยนทุก {board?.tokenExpiresIn ?? 30} วินาที</p>
        </div>
      </aside>

      {/* ================= ขวา ================= */}
      <Roster board={board} error={error} now={now} />

      {/* ปุ่มเต็มจอ ซ่อนเองเมื่ออยู่ในโหมดเต็มจอแล้ว (เบราว์เซอร์บังคับให้ต้องกดเองหนึ่งครั้ง) */}
      {!fullscreen.active && fullscreen.supported && (
        <button
          onClick={fullscreen.enter}
          className="fixed right-4 bottom-4 rounded-lg border border-rule bg-surface px-3.5 py-2 text-sm text-text-dim opacity-70 hover:opacity-100"
        >
          เต็มจอ
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ตัวเลขสรุป (มุมซ้ายบน)
// ---------------------------------------------------------------------------

function Summary({ summary }: { summary?: KioskBoard['summary'] }) {
  const s = summary ?? { expected: 0, arrived: 0, late: 0, pending: 0, leave: 0, absent: 0 }
  const cells: { label: string; n: number; tone: string; bg?: string }[] = [
    { label: 'ต้องมา', n: s.expected, tone: 'text-text' },
    { label: 'มาแล้ว', n: s.arrived, tone: 'text-ontime', bg: 'bg-ontime-bg' },
    { label: 'ยังไม่มา', n: s.pending, tone: 'text-brand-text', bg: 'bg-brand-50' },
    { label: 'สาย', n: s.late, tone: 'text-late' },
    { label: 'ลา', n: s.leave, tone: 'text-leave' },
    { label: 'ขาด', n: s.absent, tone: 'text-absent' },
  ]
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-rule bg-rule shadow-sm">
      {cells.map((c) => (
        <div key={c.label} className={`${c.bg ?? 'bg-surface'} px-[clamp(10px,1vw,18px)] py-[clamp(8px,1.5vh,16px)]`}>
          <dd className={`display tnum text-[clamp(28px,5.4vh,58px)] leading-none font-semibold ${c.n > 0 ? c.tone : 'text-text-dim/40'}`}>{c.n}</dd>
          <dt className="mt-[0.4em] text-[clamp(12px,1.7vh,18px)] text-text-dim">{c.label}</dt>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// กล่องรายชื่อ (ขวา)
// ---------------------------------------------------------------------------

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
/** ป้ายกำกับชื่อ: Gen สำหรับนักศึกษา ชื่อโปรเจกสำหรับพนักงานประจำ เพราะชื่อเล่นซ้ำกันได้ */
const tagOf = (r: ShiftInstance) => r.gen ?? r.projectName

function Roster({ board, error, now }: { board: KioskBoard | null; error: string | null; now: Date }) {
  const b = bangkok(now)
  const nowMin = minutesOf(`${b.hh}:${b.mm}`)
  const rows = board?.today ?? []

  const { pending, arrived, leave, absent } = useMemo(() => {
    const byStart = (x: ShiftInstance, y: ShiftInstance) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th')
    return {
      pending: rows.filter((r) => r.status === 'pending').sort(byStart),
      // คนที่เพิ่งสแกนอยู่บนสุด คนที่ยืนอยู่หน้าจอจะเห็นชื่อตัวเองขึ้นทันที
      arrived: rows
        .filter((r) => r.status === 'ontime' || r.status === 'late')
        .sort((x, y) => (y.scannedAt ?? '').localeCompare(x.scannedAt ?? '')),
      leave: rows.filter((r) => r.status === 'leave'),
      absent: rows.filter((r) => r.status === 'absent'),
    }
  }, [rows])

  // ย่อขนาดตัวหนังสือจนรายชื่อพอดีกล่อง
  const fitRef = useRef<HTMLDivElement>(null)
  useFitText(fitRef, [pending.length, arrived.length, leave.length, absent.length])

  const secondsOf = (t: string) => {
    const [h, m, s] = t.split(':').map(Number)
    return h * 3600 + m * 60 + (s || 0)
  }
  const nowSec = Number(b.hh) * 3600 + Number(b.mm) * 60 + Number(b.ss)

  let body: ReactNode
  if (error && !board) body = <Center big>{error}</Center>
  else if (!board) body = <Center>กำลังโหลดรายชื่อ</Center>
  else if (rows.length === 0) body = <Center big>{board.dateLabel.includes('·') ? 'วันนี้เป็นวันหยุด' : 'วันนี้ไม่มีใครมีตารางงาน'}</Center>
  else
    body = (
      <div ref={fitRef} className="flex min-h-0 flex-1 flex-col text-[calc(clamp(14px,1.2vw,26px)*var(--fit,1))]">
        {/* ฝั่งที่มีชื่อมากกว่าได้พื้นที่มากกว่า (ระหว่าง 35–65%) เช้าๆ ฝั่งยังไม่มากว้าง สายๆ ฝั่งมาแล้วกว้าง */}
        <div className="grid min-h-0 flex-1 gap-[0.9em]" style={{ gridTemplateColumns: split(pending.length, arrived.length) }}>
          <Column tone="pending" title="ยังไม่มา" count={pending.length} empty="มาครบทุกคนแล้ว">
            {pending.map((r) => {
              const overdue = minutesOf(r.startTime) <= nowMin
              return (
                <Item key={r.shiftId} row={r} dot="ring">
                  <span className={`tnum ${overdue ? 'text-late' : 'text-text-dim'}`}>
                    {overdue ? 'เลย ' : 'เข้า '}
                    {r.startTime}
                  </span>
                </Item>
              )
            })}
          </Column>
          <Column tone="arrived" title="มาแล้ว" count={arrived.length} empty="ยังไม่มีใครสแกน">
            {arrived.map((r) => {
              const fresh = r.scannedAt && r.recordedBy === 'self' && nowSec - secondsOf(r.scannedAt) < 90 && nowSec >= secondsOf(r.scannedAt)
              return (
                <Item key={r.shiftId} row={r} dot={r.status === 'late' ? 'late' : 'ontime'} fresh={!!fresh}>
                  {r.status === 'late' && <span className="text-late">สาย</span>}
                  {r.earlyLeaveAt && <span className="text-text-dim">กลับ {hhmm(r.earlyLeaveAt)}</span>}
                  <span className="tnum">{hhmm(r.scannedAt)}</span>
                </Item>
              )
            })}
          </Column>
        </div>

        {(leave.length > 0 || absent.length > 0) && (
          <div className="mt-[0.9em] flex shrink-0 flex-wrap gap-x-[1.6em] gap-y-[0.4em] border-t border-rule pt-[0.7em]">
            {leave.length > 0 && <Chips label="ลา" tone="text-leave" rows={leave} />}
            {absent.length > 0 && <Chips label="ขาด" tone="text-absent" rows={absent} />}
          </div>
        )}
      </div>
    )

  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-rule bg-surface p-[clamp(16px,2vw,32px)] shadow-sm">
      <header className="mb-[clamp(10px,1.8vh,22px)] flex items-baseline justify-between gap-4">
        <h1 className="display text-[clamp(20px,3.2vh,36px)] font-semibold">ใครต้องมาวันนี้</h1>
        {error && board && <p className="text-[clamp(13px,1.6vh,17px)] text-late">{error}</p>}
      </header>
      {body}
    </section>
  )
}

function split(a: number, b: number) {
  const r = a + b === 0 ? 0.5 : Math.min(0.65, Math.max(0.35, a / (a + b)))
  return `minmax(0,${r.toFixed(3)}fr) minmax(0,${(1 - r).toFixed(3)}fr)`
}

/**
 * สองช่องมีพื้นหลังคนละสี มองจากไกลก็แยกออกทันที
 * ยังไม่มา = พื้นส้มอ่อน (สีหลักของบริษัท) · มาแล้ว = พื้นเขียวอ่อน (สีเดียวกับสถานะ "ตรงเวลา")
 */
const COLUMN_TONE = {
  pending: { panel: 'bg-brand-50 border-brand-100', bar: 'bg-brand', count: 'bg-brand text-on-brand' },
  arrived: { panel: 'bg-ontime-bg border-ontime/20', bar: 'bg-ontime', count: 'bg-ontime text-white' },
} as const

function Column({ tone, title, count, empty, children }: { tone: keyof typeof COLUMN_TONE; title: string; count: number; empty: string; children: ReactNode }) {
  const t = COLUMN_TONE[tone]
  return (
    <div className={`flex min-h-0 min-w-0 flex-col rounded-[0.8em] border px-[0.75em] pt-[0.7em] pb-[0.5em] ${t.panel}`}>
      <div className="mb-[0.45em] flex items-center gap-[0.5em] px-[0.35em]">
        <span aria-hidden className={`h-[1.1em] w-[0.28em] rounded-full ${t.bar}`} />
        <h2 className="display text-[1.35em] leading-none font-semibold">{title}</h2>
        <span className={`display tnum ml-auto min-w-[1.9em] rounded-full px-[0.55em] py-[0.12em] text-center text-[1.1em] font-semibold ${t.count}`}>{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-[0.35em] pt-[0.4em] text-text-dim">{empty}</p>
      ) : (
        // ถ้าคนเยอะ รายชื่อไหลต่อเป็นคอลัมน์ที่สองในกล่องเดียวกัน
        <ul data-fit className="min-h-0 flex-1 overflow-hidden [column-fill:auto] [column-gap:1.4em] [column-width:11em]">
          {children}
        </ul>
      )}
    </div>
  )
}

function Item({ row, dot, fresh, children }: { row: ShiftInstance; dot: 'ring' | 'ontime' | 'late'; fresh?: boolean; children: ReactNode }) {
  const dotCls = dot === 'ring' ? 'ring-[0.12em] ring-pending ring-inset' : dot === 'late' ? 'bg-late' : 'bg-ontime'
  return (
    <li className={`flex break-inside-avoid items-center gap-[0.55em] rounded-[0.4em] px-[0.35em] py-[0.32em] ${fresh ? 'animate-stamp bg-surface shadow-sm ring-1 ring-ontime/40' : ''}`}>
      <span aria-hidden className={`size-[0.55em] shrink-0 rounded-full ${dotCls}`} />
      <span className="min-w-0 flex-1 truncate">
        <span className="display font-medium">{row.nickname}</span>
        <span className="ml-[0.4em] text-[0.78em] text-text-dim">{tagOf(row)}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-[0.6em] text-[0.9em]">{children}</span>
    </li>
  )
}

function Chips({ label, tone, rows }: { label: string; tone: string; rows: ShiftInstance[] }) {
  return (
    <p className="min-w-0 text-[0.92em]">
      <span className={`display font-semibold ${tone}`}>{label}</span>
      <span className="ml-[0.6em] text-text">
        {rows.map((r, i) => (
          <span key={r.shiftId}>
            {i > 0 && <span className="text-text-dim">, </span>}
            {r.nickname}
            <span className="ml-[0.3em] text-[0.8em] text-text-dim">{tagOf(r)}</span>
          </span>
        ))}
      </span>
    </p>
  )
}

function Center({ children, big }: { children: ReactNode; big?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center text-center">
      <p className={big ? 'display text-[clamp(22px,3.4vh,40px)] text-text-dim' : 'text-text-dim'}>{children}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

/**
 * ลดขนาดตัวหนังสือทีละขั้นจนทุกรายการ [data-fit] อยู่ในกล่องโดยไม่ล้น (ไม่มีแถบเลื่อน)
 * คำนวณใหม่เมื่อจำนวนคนเปลี่ยนหรือขนาดจอเปลี่ยน
 */
function useFitText(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const lists = [...el.querySelectorAll<HTMLElement>('[data-fit]')]
      const overflowing = () =>
        el.scrollHeight > el.clientHeight + 1 ||
        lists.some((l) => l.scrollHeight > l.clientHeight + 1 || l.scrollWidth > l.clientWidth + 1)
      for (const s of [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5]) {
        el.style.setProperty('--fit', String(s))
        if (!overflowing()) break
      }
    }
    fit()
    // ฟอนต์ไทยโหลดเสร็จทีหลัง ขนาดตัวอักษรเปลี่ยน ต้องวัดใหม่
    document.fonts?.ready.then(fit)
    // จอหมุน/เปลี่ยนขนาด/ออกจากเต็มจอ
    let last = `${el.clientWidth}x${el.clientHeight}`
    const ro = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`
      if (size !== last) {
        last = size
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** โหมดเต็มจอ */
function useFullscreen() {
  const [active, setActive] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const on = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  return {
    active,
    supported: !!document.documentElement.requestFullscreen,
    enter: () => {
      document.documentElement.requestFullscreen?.().catch(() => {})
    },
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
