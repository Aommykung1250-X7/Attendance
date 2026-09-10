import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { StatusText } from '../components/StatusPill'
import type { KioskBoard, ShiftInstance } from '../lib/types'

/**
 * จอติดผนัง มองจากระยะ 3-4 เมตร
 * นาฬิกาเป็นพระเอกเพราะทั้งระบบมีอยู่เพื่อเทียบเวลาหนึ่งกับอีกเวลาหนึ่ง
 * รายชื่อเป็นแถวมีเส้นคั่น ไม่ใช่การ์ด เพราะนี่คือบัญชีรายชื่อ
 */
export default function Kiosk() {
  const { displayKey = 'demo' } = useParams()
  const [board, setBoard] = useState<KioskBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // นาฬิกาเดินทุกวินาที แต่ค่าที่ใช้ตัดสินจริงคือเวลาของเซิร์ฟเวอร์เสมอ
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ดึงกระดานใหม่ทุก 8 วินาที ไม่ต้องต่อ websocket สำหรับ 27 คน
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const b = await api.board(displayKey)
        if (alive) {
          setBoard(b)
          setError(null)
        }
      } catch {
        if (alive) setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่')
      }
    }
    pull()
    const t = setInterval(pull, 8000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [displayKey])

  // QR หมุนตาม token ที่เซิร์ฟเวอร์ส่งมา อายุสั้นตามที่ตั้งใน settings
  useEffect(() => {
    if (!board || !canvasRef.current) return
    const url = `${location.origin}/checkin?token=${board.qrToken}`
    QRCode.toCanvas(canvasRef.current, url, { width: 460, margin: 1, color: { dark: '#101a2b', light: '#ffffff' } })
  }, [board])

  const clock = useMemo(
    () => ({
      hh: String(now.getHours()).padStart(2, '0'),
      mm: String(now.getMinutes()).padStart(2, '0'),
      ss: String(now.getSeconds()).padStart(2, '0'),
    }),
    [now],
  )

  return (
    <div className="min-h-dvh bg-ink text-chalk">
      <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-10 px-8 py-8 lg:grid-cols-[minmax(0,42%)_minmax(0,58%)] lg:gap-14 lg:px-12">
        {/* ---- ซ้าย: นาฬิกาและ QR ---- */}
        <section className="flex flex-col justify-between gap-8">
          <div>
            <p className="display text-2xl text-chalk-dim">{board?.dateLabel ?? '\u00a0'}</p>
            <p className="display tnum mt-1 text-[clamp(4.5rem,11vw,10rem)] leading-[0.95] font-semibold tracking-tight">
              {clock.hh}
              <span className="text-chalk-dim">:</span>
              {clock.mm}
              <span className="ml-2 align-top text-[0.38em] text-chalk-dim">{clock.ss}</span>
            </p>
          </div>

          <div className="flex items-start gap-7">
            <div className="rounded-2xl bg-white p-4">
              <canvas ref={canvasRef} className="block h-[clamp(200px,20vw,300px)] w-[clamp(200px,20vw,300px)]" />
            </div>
            <div className="pt-2">
              <p className="display text-3xl leading-tight font-medium">สแกนเพื่อเช็กชื่อ</p>
              <p className="mt-2 max-w-[24ch] text-lg leading-snug text-chalk-dim">
                เปิดกล้องมือถือ แล้วเข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้
              </p>
              <p className="mt-4 text-base text-chalk-dim">รหัสเปลี่ยนทุก {board?.tokenExpiresIn ?? 30} วินาที</p>
            </div>
          </div>

          {board && <Summary summary={board.summary} />}
          {error && (
            <p role="status" className="text-lg text-[#f0b552]">
              {error}
            </p>
          )}
        </section>

        {/* ---- ขวา: บัญชีรายชื่อ ---- */}
        <section className="min-w-0">
          {!board ? (
            <p className="text-xl text-chalk-dim">กำลังโหลดรายชื่อ</p>
          ) : (
            board.groups.map((g) => (
              <div key={g.startTime} className="mb-9 last:mb-0">
                <div className="flex items-baseline gap-4 border-b-2 border-ink-rule pb-2">
                  <h2 className="display tnum text-3xl font-semibold">{g.label}</h2>
                  <span className="text-xl text-chalk-dim">{g.rows.length} คน</span>
                </div>
                <ul>
                  {g.rows.map((r) => (
                    <Row key={r.shiftId} row={r} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

function Row({ row }: { row: ShiftInstance }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-5 border-b border-ink-rule py-3 last:border-b-0">
      <span className="display truncate text-[clamp(1.25rem,1.7vw,1.9rem)] font-medium">
        {row.nickname}
        {row.gen && <span className="ml-2 text-[0.7em] font-normal text-chalk-dim">{row.gen}</span>}
      </span>
      <span className="tnum text-[clamp(1.1rem,1.4vw,1.6rem)] text-chalk-dim">{row.scannedAt?.slice(0, 5) ?? '—'}</span>
      <span className="w-[7.5em] text-right">
        <StatusText status={row.status} />
      </span>
    </li>
  )
}

function Summary({ summary }: { summary: KioskBoard['summary'] }) {
  const cells: [string, number][] = [
    ['ต้องมา', summary.expected],
    ['มาแล้ว', summary.arrived],
    ['สาย', summary.late],
    ['ยังไม่มา', summary.pending],
    ['ลา', summary.leave],
    ['ขาด', summary.absent],
  ]
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-ink-rule pt-5">
      {cells.map(([label, n]) => (
        <div key={label}>
          <dd className="display tnum text-4xl leading-none font-semibold">{n}</dd>
          <dt className="mt-1.5 text-base text-chalk-dim">{label}</dt>
        </div>
      ))}
    </dl>
  )
}
