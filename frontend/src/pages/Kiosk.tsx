import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { bangkok, minutesOf } from '../lib/format'
import type { KioskBoard, ShiftInstance } from '../lib/types'

/**
 * จอติดผนังในออฟฟิศ เปิดทิ้งไว้ทั้งวัน ไม่มีใครมาเลื่อน
 * ทุกอย่างต้องอยู่ในจอเดียว ห้ามมีแถบเลื่อน ถ้ารายชื่อยาวให้ตัวหนังสือเล็กลงเองแทน
 *
 * โครงหน้าตามจออ้างอิง: ยังไม่มาซ้าย มาแล้วขวา และแถบ QR/ลา/ขาดด้านล่าง
 * รายชื่อไม่ตัดด้วย ellipsis และไม่มีข้อความสถานะต่อท้าย ใช้สีจุดแทนเพื่อให้ใส่ชื่อได้มากที่สุด
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
    <div className="h-dvh w-screen overflow-hidden bg-kiosk-frame p-[clamp(10px,1.7vw,34px)] text-text">
      <Roster board={board} error={error} now={now} canvasRef={canvasRef} clock={clock} />

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
// รายชื่อและแถบล่าง
// ---------------------------------------------------------------------------

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
/** ป้ายกำกับชื่อ: Gen สำหรับนักศึกษา ชื่อโปรเจกสำหรับพนักงานประจำ เพราะชื่อเล่นซ้ำกันได้ */
const tagOf = (r: ShiftInstance) => r.gen ?? r.projectName
const shortDate = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Bangkok' })

function Roster({
  board,
  error,
  now,
  canvasRef,
  clock,
}: {
  board: KioskBoard | null
  error: string | null
  now: Date
  canvasRef: RefObject<HTMLCanvasElement | null>
  clock: ReturnType<typeof bangkok>
}) {
  const b = bangkok(now)
  const nowMin = minutesOf(`${b.hh}:${b.mm}`)
  const rows = board?.today ?? []

  const { pending, arrived, leave, absent } = useMemo(() => {
    const byStart = (x: ShiftInstance, y: ShiftInstance) => minutesOf(x.startTime) - minutesOf(y.startTime) || x.nickname.localeCompare(y.nickname, 'th')
    const afternoon = nowMin >= 13 * 60
    const activeLeave = (r: ShiftInstance) =>
      r.leavePortion === 'full_day' ||
      (r.leavePortion === 'morning' && !afternoon) ||
      (r.leavePortion === 'afternoon' && afternoon)
    return {
      pending: rows.filter((r) => r.status === 'pending' && !activeLeave(r)).sort(byStart),
      // คนที่เพิ่งสแกนอยู่บนสุด คนที่ยืนอยู่หน้าจอจะเห็นชื่อตัวเองขึ้นทันที
      arrived: rows
        .filter((r) => (r.status === 'ontime' || r.status === 'late' || r.status === 'offsite') && !activeLeave(r))
        .sort((x, y) => (y.scannedAt ?? '').localeCompare(x.scannedAt ?? '')),
      leave: rows.filter((r) => r.status === 'leave' || activeLeave(r)),
      absent: rows.filter((r) => r.status === 'absent'),
    }
  }, [rows, nowMin])

  // เพิ่มคอลัมน์ตามพื้นที่ก่อน จากนั้นจึงย่อขนาดตัวหนังสือจนชื่อเต็มทุกชื่อพอดี โดยไม่ใช้ ellipsis
  const fitRef = useRef<HTMLDivElement>(null)
  const fitKey = rows.map((r) => `${r.shiftId}:${r.nickname}:${tagOf(r)}:${r.status}:${r.leavePortion ?? ''}`).join('|')
  useFitText(fitRef, [pending.length, arrived.length, leave.length, absent.length, fitKey])

  const secondsOf = (t: string) => {
    const [h, m, s] = t.split(':').map(Number)
    return h * 3600 + m * 60 + (s || 0)
  }
  const nowSec = Number(b.hh) * 3600 + Number(b.mm) * 60 + Number(b.ss)

  const loadingMessage = error && !board
    ? error
    : !board
      ? 'กำลังโหลดรายชื่อ'
      : rows.length === 0
        ? board.dateLabel.includes('·') ? 'วันนี้เป็นวันหยุด' : 'วันนี้ไม่มีใครมีตารางงาน'
        : null

  return (
    <main ref={fitRef} className="grid h-full min-h-0 grid-cols-[minmax(260px,31fr)_minmax(0,69fr)] grid-rows-[minmax(0,1fr)_clamp(108px,14.5vh,158px)] gap-[clamp(9px,1vw,18px)] rounded-[clamp(14px,1.4vw,24px)] bg-surface p-[clamp(10px,1.1vw,20px)] text-[calc(clamp(15px,1.22vw,25px)*var(--fit,1))]">
      <section className="flex min-h-0 min-w-0 flex-col gap-[0.65em]">
        <header className="flex shrink-0 items-center gap-[0.8em] px-[0.15em]">
          <h1 className="display text-[1.65em] leading-none font-semibold">ใครต้องมาวันนี้</h1>
          <CountBadge count={board?.summary.expected ?? rows.length} tone="neutral" />
        </header>
        <StatusPanel tone="pending" title="ยังไม่มา" count={pending.length} empty="มาครบทุกคนแล้ว" columnWidth="8.7em">
          {pending.map((r) => <PendingItem key={r.shiftId} row={r} />)}
        </StatusPanel>
      </section>

      <StatusPanel tone="arrived" title="มาแล้ว" count={arrived.length} empty={loadingMessage ?? 'ยังไม่มีใครสแกน'} columnWidth="14em" notice={error && board ? error : null}>
        {arrived.map((r) => {
          const fresh = r.scannedAt && r.recordedBy === 'self' && nowSec - secondsOf(r.scannedAt) < 90 && nowSec >= secondsOf(r.scannedAt)
          return <ArrivedItem key={r.shiftId} row={r} fresh={!!fresh} />
        })}
      </StatusPanel>

      <div className="col-span-2 grid min-h-0 grid-cols-[minmax(250px,20fr)_minmax(0,39fr)_minmax(0,41fr)] gap-[clamp(9px,1vw,18px)]">
        <TimeQrCard canvasRef={canvasRef} now={now} clock={clock} />
        <FooterStatus tone="leave" label="ลา" rows={leave} />
        <FooterStatus tone="absent" label="ขาด" rows={absent} />
      </div>
    </main>
  )
}

const COLUMN_TONE = {
  pending: { panel: 'bg-kiosk-pending-bg', bar: 'bg-kiosk-pending', count: 'bg-kiosk-pending text-ink-3' },
  arrived: { panel: 'bg-kiosk-arrived-bg', bar: 'bg-kiosk-arrived', count: 'bg-kiosk-arrived text-white' },
} as const

function StatusPanel({ tone, title, count, empty, columnWidth, notice, children }: { tone: keyof typeof COLUMN_TONE; title: string; count: number; empty: string; columnWidth: string; notice?: string | null; children: ReactNode }) {
  const t = COLUMN_TONE[tone]
  return (
    <section className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-[0.75em] px-[0.8em] pt-[0.75em] pb-[0.6em] ${t.panel}`}>
      <div className="mb-[0.45em] flex items-center gap-[0.5em] px-[0.35em]">
        <span aria-hidden className={`h-[1.35em] w-[0.12em] ${t.bar}`} />
        <h2 className="display text-[1.35em] leading-none font-semibold">{title}</h2>
        {notice && <span className="ml-auto text-[0.66em] text-absent">{notice}</span>}
        <CountBadge count={count} tone={tone} className={notice ? '' : 'ml-auto'} />
      </div>
      {count === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-[0.35em] text-center text-text-dim/75">{empty}</div>
      ) : (
        <ul data-fit className="min-h-0 flex-1 overflow-hidden [column-fill:auto] [column-gap:1.15em]" style={{ columnWidth }}>
          {children}
        </ul>
      )}
    </section>
  )
}

function CountBadge({ count, tone, className = '' }: { count: number; tone: 'neutral' | keyof typeof COLUMN_TONE; className?: string }) {
  const color = tone === 'neutral' ? 'bg-sunken text-text' : COLUMN_TONE[tone].count
  return (
    <span className={`display tnum inline-flex size-[1.85em] shrink-0 items-center justify-center rounded-full text-[1.05em] font-medium ${color} ${className}`}>{count}</span>
  )
}

function PersonName({ row }: { row: ShiftInstance }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-[0.36em] whitespace-nowrap">
      <span className="display font-medium">{row.nickname}</span>
      <span className="text-[0.7em] text-text/85">{tagOf(row)}</span>
    </span>
  )
}

function PendingItem({ row }: { row: ShiftInstance }) {
  return (
    <li className="flex break-inside-avoid items-center px-[0.35em] py-[0.36em]" aria-label={`${row.nickname} ${tagOf(row)} ยังไม่มา`}>
      <PersonName row={row} />
    </li>
  )
}

function ArrivedItem({ row, fresh }: { row: ShiftInstance; fresh: boolean }) {
  const left = row.checkedOutAt ?? row.earlyLeaveAt
  const state = left ? 'checkout' : row.status === 'offsite' ? 'offsite' : row.status === 'late' ? 'late' : 'ontime'
  const stateLabel = state === 'checkout' ? row.earlyLeaveAt && !row.checkedOutAt ? 'ออกก่อนเวลา' : 'ออกงานแล้ว' : state === 'offsite' ? 'ทำงานนอกสถานที่' : state === 'late' ? 'เข้างานสาย' : 'เข้างานตรงเวลา'
  const dot = state === 'checkout' ? 'bg-kiosk-checkout' : state === 'offsite' ? 'bg-kiosk-offsite' : state === 'late' ? 'bg-kiosk-pending' : 'bg-kiosk-arrived'
  const time = hhmm(left ?? row.scannedAt)
  return (
    <li aria-label={`${row.nickname} ${tagOf(row)} ${stateLabel}${time ? ` เวลา ${time}` : ''}`} className={`flex break-inside-avoid items-center gap-[0.55em] rounded-[0.35em] px-[0.35em] py-[0.34em] ${fresh ? 'animate-stamp bg-surface/80 shadow-sm ring-1 ring-kiosk-arrived/35' : ''}`}>
      <span aria-hidden className={`size-[0.48em] shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">
        <PersonName row={row} />
      </span>
      {time && <span className="tnum shrink-0 text-[0.78em]">{time}</span>}
    </li>
  )
}

function TimeQrCard({ canvasRef, now, clock }: { canvasRef: RefObject<HTMLCanvasElement | null>; now: Date; clock: ReturnType<typeof bangkok> }) {
  return (
    <section className="grid min-h-0 min-w-0 grid-cols-[auto_1fr] items-center gap-[0.55em] rounded-[0.75em] bg-sunken p-[0.35em]">
      <div className="rounded-[0.55em] bg-white p-[0.22em]">
        <canvas ref={canvasRef} className="block size-[clamp(76px,10.5vh,118px)]" aria-label="QR สำหรับเช็กชื่อ" />
      </div>
      <div className="min-w-0 border-l-[0.16em] border-white px-[0.55em]">
        <p className="tnum whitespace-nowrap text-[0.78em] leading-none">{shortDate.format(now)}</p>
        <p className="display tnum mt-[0.16em] whitespace-nowrap text-[1.72em] leading-none font-medium tracking-tight">
          {clock.hh}:{clock.mm}<span className="ml-[0.08em] align-top text-[0.46em]">{clock.ss}</span>
        </p>
      </div>
    </section>
  )
}

const FOOTER_TONE = {
  leave: { panel: 'bg-kiosk-leave-bg', label: 'text-kiosk-leave', bar: 'bg-kiosk-leave', badge: 'bg-kiosk-leave text-white' },
  absent: { panel: 'bg-kiosk-absent-bg', label: 'text-kiosk-absent', bar: 'bg-kiosk-absent', badge: 'bg-kiosk-absent text-white' },
} as const

function FooterStatus({ tone, label, rows }: { tone: keyof typeof FOOTER_TONE; label: string; rows: ShiftInstance[] }) {
  const t = FOOTER_TONE[tone]
  return (
    <section className={`flex min-h-0 min-w-0 items-center gap-[0.65em] rounded-[0.75em] px-[0.72em] py-[0.55em] ${t.panel}`}>
      <span aria-hidden className={`h-[1.8em] w-[0.12em] shrink-0 ${t.bar}`} />
      <h2 className={`display shrink-0 text-[1.45em] leading-none font-semibold ${t.label}`}>{label}</h2>
      <div data-fit className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[0.7em] gap-y-[0.22em] overflow-hidden text-[0.82em]">
        {rows.map((r) => (
          <span key={r.shiftId} className="inline-flex items-baseline gap-[0.28em] whitespace-nowrap">
            <span className="display font-medium">{r.nickname}</span>
            <span className="text-[0.72em]">{tagOf(r)}</span>
            {tone === 'leave' && r.leavePortion && r.leavePortion !== 'full_day' && (
              <span className={`rounded-full px-[0.5em] py-[0.08em] text-[0.65em] font-semibold text-white ${t.bar}`}>{r.leavePortion === 'morning' ? 'เช้า' : 'บ่าย'}</span>
            )}
          </span>
        ))}
      </div>
      <span className={`display tnum inline-flex size-[1.85em] shrink-0 items-center justify-center rounded-full text-[1.05em] font-medium ${t.badge}`}>{rows.length}</span>
    </section>
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
