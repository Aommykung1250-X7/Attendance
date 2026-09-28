/**
 * AttendanceMascot — "เพื่อนประจำระบบเช็คชื่อ"
 *
 * มาสคอตตัวเดียว (Beluga Pup) ที่เดินเล่นอยู่บนขอบบนของการ์ดสรุปตัวเลขในจอ Kiosk
 * เวลาไม่มีอะไรเกิดขึ้น → เดินไปมาเบาๆ (idle)
 * เวลามี event (เช่นเช็คชื่อสำเร็จ) → หยุด หันมอง วิ่งไปรับขนม กิน ดีใจ แล้วกลับไปเดินต่อ
 *
 * ออกแบบให้ผูกกับข้อมูลพนักงานให้น้อยที่สุด: รับแค่ event object ธรรมดาผ่าน prop `event`
 * (หรือเรียกผ่าน ref ก็ได้ — ดู AttendanceMascotHandle) ตัว component เองไม่รู้จัก ShiftInstance/KioskBoard เลย
 * เพจไหนจะเอาไปใช้ก็แค่ diff ข้อมูลของตัวเองแล้วยิง event เข้ามา
 *
 * ภาพต้นฉบับมีรูปเดียวต่อท่า (front/side/back) ไม่มีเลเยอร์แยกส่วน (ตา/หู/หาง) แยกกัน
 * แอนิเมชันทั้งหมดด้านล่างจึงขยับ "ทั้งตัว" ด้วย transform (translate/scale/rotate) + opacity เท่านั้น
 * ไม่มีการพยายามปลอมการกระพริบตา/ขยับหูแบบแยกชิ้นส่วน เพราะภาพต้นฉบับไม่มีชั้นให้ทำแบบนั้นได้อย่างแม่นยำ —
 * ใช้การหายใจ/เอียงหัว/เด้งตัว/ส่ายตัวแทน ซึ่งอ่านเป็น "มีชีวิต" ได้โดยไม่เสี่ยงหลุดตำแหน่งจนดูเป็นบั๊ก
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import mascotFront from '../assets/mascot/mascot-front.png'
import mascotSide from '../assets/mascot/mascot-side.png'
import mascotBack from '../assets/mascot/mascot-back.png'
import './AttendanceMascot.css'

// ---------------------------------------------------------------------------
// Event API — ออกแบบไว้ให้ต่อยอด (ดูสเปกข้อ 11: CHECK_IN / LATE / ABSENT / LEAVE / EARLY_CHECK_IN / MULTIPLE_CHECK_IN)
// ---------------------------------------------------------------------------

export type MascotEventType = 'CHECK_IN' | 'EARLY_CHECK_IN' | 'MULTIPLE_CHECK_IN' | 'LATE' | 'ABSENT' | 'LEAVE'

export interface MascotEvent {
  /** ต้องไม่ซ้ำกันต่อ event หนึ่งครั้ง (เช่น `${shiftId}-${scannedAt}`) ใช้กันยิงซ้ำเวลา re-render */
  id: string
  type: MascotEventType
  /** ชื่อเล่นพนักงาน ใช้แสดงในลูกโป่งข้อความเฉยๆ ไม่ผูก logic ใดๆ กับตัวมาสคอต */
  name?: string
  tag?: string
  /** สำหรับ MULTIPLE_CHECK_IN */
  count?: number
}

export interface AttendanceMascotHandle {
  /** เรียกใช้แบบ imperative เช่น mascotRef.current?.play('CHECK_IN', { name: 'ยูริ' }) */
  play: (type: MascotEventType, payload?: Omit<MascotEvent, 'id' | 'type'>) => void
}

interface Props {
  /** เปลี่ยน id ทุกครั้งที่อยากให้เล่น event ใหม่ (คอมโพเนนต์แม่คุม state เอง ไม่ต้องใช้ ref ก็ได้) */
  event?: MascotEvent | null
  className?: string
}

// ---------------------------------------------------------------------------
// ค่าคงที่ท่าเดิน/พื้นที่เดิน
// ---------------------------------------------------------------------------

/** ภาพ side.png ต้นฉบับหันหน้าไปทางซ้าย → facing 'left' ไม่ต้อง flip, facing 'right' ต้อง scaleX(-1) */
type Facing = 'left' | 'right'
type Pose = 'front' | 'side' | 'back'

const REWARD_X = 0.9 // ตำแหน่ง "จุดรับขนม" (สัดส่วนของความกว้าง walking area)
const ROAM_MIN = 0.05
const ROAM_MAX = 0.8
const ROAM_MIN_COMPACT = 0.08
const ROAM_MAX_COMPACT = 0.66
const REWARD_X_COMPACT = 0.78

const IDLE_SPEED = 22 // px/วินาที ตอนเดินเล่นปกติ
const TROT_SPEED = 96 // px/วินาที ตอนตื่นเต้นวิ่งไปรับขนม

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function useCompact() {
  const [compact, setCompact] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const on = () => setCompact(window.innerWidth < 640)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return compact
}

const AttendanceMascot = forwardRef<AttendanceMascotHandle, Props>(function AttendanceMascot({ event, className }, ref) {
  const reduceMotion = usePrefersReducedMotion()
  const compact = useCompact()

  const trackRef = useRef<HTMLDivElement>(null)
  const trackWidthRef = useRef(0)

  // ตำแหน่งปัจจุบัน (px จากซ้าย ภายใน track): xPxRef คือแหล่งความจริงเดียว อ่าน/เขียนได้ทันทีไม่ว่าจะถูกเรียกจาก
  // closure เก่าแค่ไหน (ต่างจาก React state ที่ closure จะเห็นค่าตอน render ครั้งนั้นเท่านั้น) — กันบั๊กหันทิศผิด
  // เวลาเช็คทิศจากตำแหน่งเก่าที่ยังไม่ re-render ทัน ส่วน xPx (state) มีไว้ให้ JSX render อย่างเดียว
  const xPxRef = useRef(0)
  const [xPx, setXPxState] = useState(0)
  const xFracRef = useRef(0.12)
  const [durationMs, setDurationMs] = useState(0)
  const [facing, setFacing] = useState<Facing>('right')
  const [pose, setPose] = useState<Pose>('side')
  const [bodyAnim, setBodyAnim] = useState<'breathe' | 'walk' | 'trot' | 'sit' | 'glance' | 'stop' | 'alert' | 'eat' | 'happy' | 'nod' | 'none'>('walk')
  const [bubble, setBubble] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showTreat, setShowTreat] = useState(false)
  const [particles, setParticles] = useState<{ id: number; glyph: string; dx: number; delay: number }[]>([])

  const genRef = useRef(0) // เปลี่ยนทุกครั้งที่เริ่มวงจรใหม่ (idle tick / reaction) กัน timer เก่าทำงานทับ
  const timersRef = useRef<number[]>([])
  const modeRef = useRef<'idle' | 'reacting'>('idle')
  const queueRef = useRef<MascotEvent[]>([])
  const lastEventIdRef = useRef<string | null>(null)

  const roamMin = compact ? ROAM_MIN_COMPACT : ROAM_MIN
  const roamMax = compact ? ROAM_MAX_COMPACT : ROAM_MAX
  const rewardX = compact ? REWARD_X_COMPACT : REWARD_X
  const speedScale = compact ? 1.3 : 1 // จอเล็ก: ความเร็วช้าลง (ระยะเวลานานขึ้น) ตามสเปกข้อ 7

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id))
    timersRef.current = []
  }, [])

  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, Math.max(0, ms))
    timersRef.current.push(id)
    return id
  }, [])

  /**
   * วัดความกว้าง track จริง แปลงสัดส่วน 0..1 เป็นตำแหน่ง px แล้วสั่งเดิน (transform เท่านั้น ไม่แตะ layout ระหว่างแอนิเมชัน)
   * maxMs จำกัดเพดานเวลาไว้กันไม่ให้ "วิ่งไปรับขนม" ตอนตื่นเต้นดูเนิบเกินไปถ้าบังเอิญอยู่ไกลจากจุดขนม
   * (ค่า default 9000 ไว้ใช้กับการเดินเล่นแบบ idle ที่ไม่รีบ ส่วนการวิ่งตอนมี event ควรส่งเพดานที่สั้นกว่านี้)
   */
  const moveTo = useCallback(
    (frac: number, speedPxPerSec: number, opts?: { instant?: boolean; maxMs?: number }) => {
      const w = trackWidthRef.current
      const clamped = Math.min(1, Math.max(0, frac))
      xFracRef.current = clamped
      const targetPx = clamped * w
      const fromPx = xPxRef.current
      const distance = Math.abs(targetPx - fromPx)
      const cap = opts?.maxMs ?? 9000
      const dur = opts?.instant || reduceMotion ? 0 : Math.min(cap, Math.max(280, (distance / speedPxPerSec) * 1000)) * speedScale
      setFacing(targetPx >= fromPx ? 'right' : 'left')
      setDurationMs(dur)
      xPxRef.current = targetPx
      setXPxState(targetPx)
      return dur
    },
    [reduceMotion, speedScale],
  )

  // ---------------------------------------------------------------------------
  // วัดความกว้าง walking area ตอน mount และตอน resize (ไม่ทำระหว่างแอนิเมชันเล่นอยู่)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      trackWidthRef.current = w
      // จอเปลี่ยนขนาด: จัดตำแหน่งปัจจุบันใหม่ทันทีตามสัดส่วนเดิม ไม่ต้องเล่นแอนิเมชัน
      const px = xFracRef.current * w
      xPxRef.current = px
      setXPxState(px)
      setDurationMs(0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---------------------------------------------------------------------------
  // วงจร Idle: เดินไปจุดสุ่ม พัก (ยืนหายใจ/นั่ง/มองซ้ายขวา) แล้วเดินต่อ วนไปเรื่อยๆ
  // ---------------------------------------------------------------------------
  const scheduleIdleStep = useCallback(
    (myGen: number) => {
      if (modeRef.current !== 'idle' || genRef.current !== myGen) return

      if (reduceMotion) {
        // ลด motion: ไม่เดินไปมา ลอยตัวอยู่กับที่เบาๆ พอ ไม่ต้องวนซ้ำถี่
        setPose('front')
        setBodyAnim('breathe')
        return
      }

      const target = roamMin + Math.random() * (roamMax - roamMin)
      setPose('side')
      setBodyAnim('walk')
      const dur = moveTo(target, IDLE_SPEED)

      after(dur + 40, () => {
        if (modeRef.current !== 'idle' || genRef.current !== myGen) return
        const roll = Math.random()
        setPose('front')
        if (roll < 0.5) {
          // ยืนหายใจเฉยๆ
          setBodyAnim('breathe')
          after(1400 + Math.random() * 1600, () => scheduleIdleStep(myGen))
        } else if (roll < 0.78) {
          // หันมองซ้าย-ขวา แบบขี้สงสัยนิดๆ
          setBodyAnim('glance')
          after(1700, () => scheduleIdleStep(myGen))
        } else {
          // นั่งพัก (ใช้ท่า back หันหลังนั่งเล่น ดูสงบและเป็นธรรมชาติกว่าเอาท่ายืนมานั่ง)
          setPose('back')
          setBodyAnim('sit')
          after(2200 + Math.random() * 1400, () => scheduleIdleStep(myGen))
        }
      })
    },
    [after, moveTo, reduceMotion, roamMax, roamMin],
  )

  const startIdle = useCallback(() => {
    modeRef.current = 'idle'
    genRef.current += 1
    setBubble(null)
    setToast(null)
    setShowTreat(false)
    scheduleIdleStep(genRef.current)
  }, [scheduleIdleStep])

  // ---------------------------------------------------------------------------
  // Reaction: ทำงานตาม event ที่ enqueue เข้ามา ทีละอันจนกว่าคิวจะว่าง
  // ---------------------------------------------------------------------------
  const spawnParticles = useCallback((kind: 'sparkle' | 'heart') => {
    const glyphs = kind === 'sparkle' ? ['✨', '⭐', '✨'] : ['💛', '✨', '💛']
    const items = glyphs.map((glyph, i) => ({ id: Date.now() + i, glyph, dx: (i - 1) * 14 + (Math.random() * 8 - 4), delay: i * 90 }))
    setParticles(items)
  }, [])

  const runReaction = useCallback(
    (evt: MascotEvent) => {
      modeRef.current = 'reacting'
      genRef.current += 1
      const myGen = genRef.current
      const alive = () => genRef.current === myGen

      const finish = () => {
        if (!alive()) return
        setBubble(null)
        setShowTreat(false)
        setParticles([])
        modeRef.current = 'idle'
        startIdle()
        after(50, drainQueue)
      }

      // -------- ปฏิกิริยาเบา: ไม่มีเดินไปรับขนม ใช้กับ LATE / ABSENT / LEAVE --------
      const lightReaction = (label: string, pose_: Pose, anim: typeof bodyAnim, holdMs: number) => {
        setBodyAnim('stop')
        after(reduceMotion ? 0 : 220, () => {
          if (!alive()) return
          setPose(pose_)
          setBodyAnim(anim)
          setBubble(label)
          after(reduceMotion ? 500 : holdMs, finish)
        })
      }

      if (evt.type === 'LATE') {
        lightReaction(evt.name ? `${evt.name} ยังไม่มา…` : 'สงสัยจัง 🤔', 'front', 'glance', 1500)
        return
      }
      if (evt.type === 'ABSENT') {
        lightReaction(evt.name ? `${evt.name} ขาด` : 'วันนี้ขาดไปคนนึง', 'back', 'sit', 1900)
        return
      }
      if (evt.type === 'LEAVE') {
        lightReaction(evt.name ? `${evt.name} ลา` : 'ลาวันนี้', 'front', 'nod', 1500)
        return
      }

      // -------- CHECK_IN / EARLY_CHECK_IN / MULTIPLE_CHECK_IN: วิ่งไปกินขนมเต็มรูปแบบ --------
      const early = evt.type === 'EARLY_CHECK_IN'
      const multi = evt.type === 'MULTIPLE_CHECK_IN'
      const label = multi
        ? `เช็คชื่อสำเร็จ ${evt.count ?? ''} คน!`
        : evt.name
          ? `${evt.name} เช็คชื่อสำเร็จ${evt.tag ? ` · ${evt.tag}` : ''}`
          : 'เช็คชื่อสำเร็จ!'

      // STEP 2: หยุดเดินทันที
      setBodyAnim('stop')
      after(reduceMotion ? 0 : 220, () => {
        if (!alive()) return
        // STEP 3+4: หันไปทาง reward spot + โชว์ sparkle/ลูกโป่งแจ้งเตือน
        setPose('front')
        setBodyAnim('alert')
        setBubble(label)
        spawnParticles('sparkle')

        after(reduceMotion ? 0 : 820, () => {
          if (!alive()) return
          setBubble(null)
          setParticles([])
          // STEP 5: วิ่งเล็กๆ ไปยังจุดรับขนม
          setPose('side')
          setBodyAnim(early || multi ? 'trot' : 'trot')
          // เพดานเวลาสั้นกว่าการเดินเล่นปกติเสมอ: ต่อให้บังเอิญอยู่ไกลสุดลู่ ก็ยังรู้สึกเป็น "วิ่งตื่นเต้นไปรับขนม" ไม่ใช่เดินเอื่อยๆ
          const dur = moveTo(rewardX, TROT_SPEED * (early ? 1.25 : 1), { maxMs: early ? 1100 : 1450 })

          after(dur + 30, () => {
            if (!alive()) return
            // STEP 6: ขนมโผล่มา
            setPose('front')
            setBodyAnim('eat')
            setShowTreat(true)

            // STEP 7: ดม → งับ → เคี้ยว → กลืน (คุมจังหวะด้วย keyframe เดียวยาว ~1.15s ใน CSS)
            after(reduceMotion ? 0 : 1150, () => {
              if (!alive()) return
              setShowTreat(false)
              // STEP 8: ดีใจ
              setBodyAnim('happy')
              spawnParticles(early || multi ? 'sparkle' : 'heart')
              setToast(multi ? `Yum! x${evt.count ?? ''}` : early ? 'เช้าจัง! +2 Treat ⭐' : 'Yum! +1 Treat')

              after(reduceMotion ? 400 : 1350, finish)
            })
          })
        })
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [after, moveTo, reduceMotion, rewardX, spawnParticles, startIdle],
  )

  const drainQueue = useCallback(() => {
    if (modeRef.current === 'reacting') return
    const next = queueRef.current.shift()
    if (next) runReaction(next)
  }, [runReaction])

  const enqueue = useCallback(
    (evt: MascotEvent) => {
      queueRef.current.push(evt)
      // คิวยาวเกินไป (event ถี่กว่าที่เล่นทัน): ตัดของเก่าทิ้ง เหลือแค่ล่าสุดไม่กี่อัน กันมาสคอตวิ่งวนแก้ event ค้างนานเกินจริง
      if (queueRef.current.length > 4) queueRef.current = queueRef.current.slice(-4)
      // สำคัญ: ห้ามเรียก clearTimers() ตรงนี้ — ถ้ามี reaction เล่นอยู่ (modeRef === 'reacting') timer ที่ค้างอยู่
      // คือ timer ที่ใช้ขับเคลื่อนขั้นตอนถัดไปของ reaction นั้นเอง เคลียร์ทิ้งตรงนี้จะทำให้แอนิเมชันที่เล่นอยู่ค้างกลางคัน
      // drainQueue() เองจะเช็ค modeRef ก่อนว่าง่ายๆ ถ้ากำลังเล่นอยู่ก็แค่ปล่อยให้อยู่ในคิวรอจนกว่าจะเล่นจบแล้วคิวจะถูกดึงไปเล่นเอง (ผ่าน finish() ในตอนท้ายของ runReaction)
      drainQueue()
    },
    [drainQueue],
  )

  useImperativeHandle(ref, () => ({
    play: (type, payload) => enqueue({ id: `${type}-${Date.now()}-${Math.random()}`, type, ...payload }),
  }))

  // event เข้าทาง prop
  useEffect(() => {
    if (!event || event.id === lastEventIdRef.current) return
    lastEventIdRef.current = event.id
    enqueue(event)
  }, [event, enqueue])

  // เริ่ม idle loop ตอน mount, เคลียร์ timer ตอน unmount
  useEffect(() => {
    startIdle()
    return () => {
      clearTimers()
      modeRef.current = 'idle'
      genRef.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // reduced motion เปลี่ยนระหว่างใช้งาน (คนกดเปิด/ปิดในระบบปฏิบัติการ): รีสตาร์ท idle ให้สอดคล้อง
  useEffect(() => {
    if (modeRef.current === 'idle') startIdle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion])

  const src = pose === 'front' ? mascotFront : pose === 'back' ? mascotBack : mascotSide
  const animClass = useMemo(() => {
    switch (bodyAnim) {
      case 'walk':
        return 'am-anim-walk'
      case 'trot':
        return 'am-anim-trot'
      case 'sit':
        return 'am-anim-sit'
      case 'glance':
        return 'am-anim-glance'
      case 'stop':
        return 'am-anim-stop'
      case 'alert':
        return 'am-anim-alert'
      case 'eat':
        return 'am-anim-eat'
      case 'happy':
        return 'am-anim-happy'
      case 'nod':
        return 'am-anim-nod'
      case 'breathe':
        return 'am-anim-breathe'
      default:
        return ''
    }
  }, [bodyAnim])

  // เงาใต้ตัวต้องยุบ-พองสวนจังหวะกับลำตัวพอดีตอนเดิน/วิ่ง (ดูคอมเมนต์ am-shadow-step ใน CSS) — ถ้าไม่ได้เดิน/วิ่งอยู่ก็ไม่ต้องเล่น keyframe อะไร แค่จางๆ นิ่งๆ
  const shadowAnimClass = bodyAnim === 'walk' ? 'am-shadow-walk' : bodyAnim === 'trot' ? 'am-shadow-trot' : ''

  return (
    <div ref={trackRef} className={`am-track ${className ?? ''}`} aria-hidden="true">
      <div
        className="am-stage"
        style={{
          transform: `translateX(${xPx}px)`,
          transitionDuration: `${durationMs}ms`,
        }}
      >
        <div className={`am-shadow ${shadowAnimClass}`} style={{ opacity: pose === 'back' && bodyAnim === 'sit' ? 0.55 : 0.9 }} />
        <div className={`am-sprite-wrap ${animClass}`} style={{ transform: facing === 'right' && pose !== 'front' && pose !== 'back' ? 'scaleX(-1)' : undefined }}>
          <img src={src} alt="" className="am-sprite" draggable={false} />
          <span className="am-led am-led-1" />
          <span className="am-led am-led-2" />

          {bubble && (
            <span key={bubble} className="am-bubble">
              {bubble}
            </span>
          )}
          {toast && (
            <span key={toast} className="am-toast">
              {toast}
            </span>
          )}
          {showTreat && (
            <span className="am-treat" aria-hidden>
              <TreatIcon />
            </span>
          )}
          {particles.length > 0 && (
            <span className="am-particles">
              {particles.map((p) => (
                <span key={p.id} className="am-particle" style={{ left: '50%', ['--dx' as string]: `${p.dx}px`, animationDelay: `${p.delay}ms` }}>
                  {p.glyph}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})

export default AttendanceMascot

/** ขนมสไตล์ mascot ทรงกระดูกเรียบๆ ไม่สมจริง สีขาว/ฟ้าให้เข้าธีม kiosk */
function TreatIcon() {
  return (
    <svg viewBox="0 0 32 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
      <path
        d="M8 4.2c-1.9 0-3.4 1.5-3.4 3.4 0 1 .4 1.9 1.1 2.4-.7.6-1.1 1.4-1.1 2.4 0 1.9 1.5 3.4 3.4 3.4 1.5 0 2.8-1 3.2-2.4h9.6c.4 1.4 1.7 2.4 3.2 2.4 1.9 0 3.4-1.5 3.4-3.4 0-1-.4-1.9-1.1-2.4.7-.6 1.1-1.4 1.1-2.4 0-1.9-1.5-3.4-3.4-3.4-1.5 0-2.8 1-3.2 2.4h-9.6c-.4-1.4-1.7-2.4-3.2-2.4Z"
        fill="#FFFDF9"
        stroke="#95BBEA"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
