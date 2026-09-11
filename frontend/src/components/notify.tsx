// การแจ้งเตือนของทั้งแอป แทน alert()/confirm() ของเบราว์เซอร์
//
//   const notify = useNotify()
//   notify.toast('บันทึกแล้ว')                                  // แจ้งผลสั้นๆ มุมขวาบน หายเองใน 4 วินาที
//   notify.toast('ลบไม่สำเร็จ', { tone: 'error', detail: e.message })
//   if (await notify.confirm({ title: 'ลบโปรเจก A?', danger: true })) { ... }
//
// confirm ส่ง action มาได้ ปุ่มยืนยันจะขึ้น "กำลัง..." และถ้า action พัง ข้อความผิดพลาดจะขึ้นในกล่องเดิม
// ไม่ต้องปิดแล้วเปิดใหม่

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, cx } from './ui'

type Tone = 'success' | 'error' | 'info'

type ToastOpts = { tone?: Tone; detail?: ReactNode }

export type ConfirmOpts = {
  title: ReactNode
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** ปุ่มยืนยันสีแดง และโฟกัสเริ่มที่ปุ่มยกเลิก กันกด Enter พลาด */
  danger?: boolean
  /** งานที่ทำหลังกดยืนยัน กล่องจะรอจนเสร็จ ถ้า throw จะแสดงข้อความในกล่องและยังไม่ปิด */
  action?: () => Promise<unknown>
  busyLabel?: string
}

type Notify = {
  toast: (message: ReactNode, opts?: ToastOpts) => void
  confirm: (opts: ConfirmOpts) => Promise<boolean>
}

const Ctx = createContext<Notify | null>(null)

export function useNotify() {
  const n = useContext(Ctx)
  if (!n) throw new Error('useNotify ต้องอยู่ใต้ <NotifyProvider>')
  return n
}

type ToastItem = { id: number; message: ReactNode; tone: Tone; detail?: ReactNode }
type Pending = ConfirmOpts & { id: number; resolve: (ok: boolean) => void }

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const seq = useRef(0)

  const toast = useCallback((message: ReactNode, opts?: ToastOpts) => {
    const id = ++seq.current
    // เก็บไว้ไม่เกิน 3 อัน อันเก่าสุดหลุดไปก่อน
    setToasts((list) => [...list.slice(-2), { id, message, tone: opts?.tone ?? 'success', detail: opts?.detail }])
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false)
          return { ...opts, id: ++seq.current, resolve }
        })
      }),
    [],
  )

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])
  const remove = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastRegion toasts={toasts} onRemove={remove} />
      {pending && (
        <ConfirmDialog
          key={pending.id}
          opts={pending}
          onDone={(ok) => {
            pending.resolve(ok)
            setPending(null)
          }}
        />
      )}
    </Ctx.Provider>
  )
}

/**
 * ตัวเชื่อมสำหรับหน้าที่ใช้ state แบบเดิม: <Toast message={toast} onDone={() => setToast(null)} />
 * ส่งข้อความเข้าระบบแจ้งเตือนกลางแล้วล้าง state ทันที
 */
export function Toast({ message, tone, onDone }: { message: string | null; tone?: Tone; onDone: () => void }) {
  const { toast } = useNotify()
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!message) return
    // หน่วงหนึ่งจังหวะ StrictMode รัน effect ซ้ำตอน dev จะได้ไม่ขึ้นสองอัน
    const t = setTimeout(() => {
      toast(message, { tone })
      done.current()
    })
    return () => clearTimeout(t)
  }, [message, tone, toast])
  return null
}

// ---------------------------------------------------------------------------
// ข้อความแจ้งผล
// ---------------------------------------------------------------------------

const TONE: Record<Tone, { icon: string; badge: string; bar: string; label: string }> = {
  success: { icon: 'M5 12.5l4.2 4.2L19 7', badge: 'bg-ontime-bg text-ontime', bar: 'bg-ontime', label: 'สำเร็จ' },
  error: { icon: 'M12 7.5v6M12 16.8v.2', badge: 'bg-absent-bg text-absent', bar: 'bg-absent', label: 'ผิดพลาด' },
  info: { icon: 'M12 11v5.5M12 7.8v.2', badge: 'bg-brand-50 text-brand-text', bar: 'bg-brand', label: 'แจ้งเตือน' },
}

function ToastRegion({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
  // ใช้ popover ให้ขึ้นใน top layer จะได้อยู่เหนือ <dialog> ที่เปิดค้างอยู่ด้วย
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.showPopover) return
    try {
      if (el.matches(':popover-open')) el.hidePopover()
      if (toasts.length) el.showPopover()
    } catch {
      // เบราว์เซอร์เก่าไม่มี popover ก็แสดงเป็น fixed ธรรมดา
    }
  }, [toasts])

  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-auto bottom-4 m-0 flex h-auto w-auto flex-col gap-2.5 overflow-visible border-0 bg-transparent p-0 sm:inset-x-auto sm:top-5 sm:right-5 sm:bottom-auto sm:w-[380px]"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onRemove={() => onRemove(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const t = TONE[item.tone]
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-rule bg-surface py-3 pr-2 pl-3.5 text-text shadow-[0_18px_40px_-16px_rgba(17,19,21,0.4)]',
        leaving ? 'animate-toast-out' : 'animate-toast-in',
      )}
      onAnimationEnd={(e) => e.animationName === 'toast-out' && onRemove()}
    >
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-1', t.bar)} />
      <span aria-hidden className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', t.badge)}>
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={t.icon} />
        </svg>
      </span>
      <div className="min-w-0 flex-1 py-1">
        <span className="sr-only">{t.label}: </span>
        <p className="text-[15px] leading-snug font-medium">{item.message}</p>
        {item.detail && <p className="mt-0.5 text-sm leading-relaxed text-text-dim">{item.detail}</p>}
      </div>
      <button onClick={() => setLeaving(true)} className="grid size-8 shrink-0 place-items-center rounded-md text-text-dim hover:bg-sunken hover:text-text" aria-label="ปิดการแจ้งเตือน">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
      {/* แถบนับถอยหลัง เอาเมาส์ชี้แล้วหยุด หมดแถบเมื่อไรก็ปิดเอง */}
      {!leaving && (
        <span
          aria-hidden
          className={cx('toast-timer absolute bottom-0 left-0 h-[3px] w-full origin-left opacity-60 group-hover:[animation-play-state:paused]', t.bar)}
          onAnimationEnd={(e) => {
            e.stopPropagation()
            setLeaving(true)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// กล่องยืนยัน
// ---------------------------------------------------------------------------

function ConfirmDialog({ opts, onDone }: { opts: Pending; onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    ;(opts.danger ? cancelRef : okRef).current?.focus()
  }, [opts.danger])

  const cancel = () => !busy && onDone(false)
  const ok = async () => {
    if (!opts.action) return onDone(true)
    setBusy(true)
    setError(null)
    try {
      await opts.action()
      onDone(true)
    } catch (e) {
      setError((e as Error).message || 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  const danger = !!opts.danger
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={opts.body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        cancel()
      }}
      onClick={(e) => e.target === ref.current && cancel()}
      className="m-auto w-[calc(100%-2rem)] max-w-[440px] overflow-hidden rounded-2xl border-0 bg-surface p-0 text-text shadow-[0_30px_80px_-20px_rgba(17,19,21,0.55)] backdrop:bg-ink-3/55 backdrop:backdrop-blur-[2px] open:animate-pop"
    >
      <div className="flex gap-4 px-6 pt-6 pb-5">
        <span aria-hidden className={cx('grid size-11 shrink-0 place-items-center rounded-full', danger ? 'bg-absent-bg text-absent' : 'bg-brand-50 text-brand-text')}>
          <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {danger ? (
              <>
                <path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9.5v4M12 16.6v.2" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 16.8v.2" />
              </>
            )}
          </svg>
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <h2 id={titleId} className="display text-lg leading-snug font-semibold">
            {opts.title}
          </h2>
          {opts.body && (
            <div id={bodyId} className="mt-1.5 text-[15px] leading-relaxed text-text-dim">
              {opts.body}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-absent/30 bg-absent-bg px-3 py-2 text-sm text-absent">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-rule bg-paper px-6 py-4 sm:flex-row sm:justify-end">
        <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={cancel}>
          {opts.cancelLabel ?? 'ยกเลิก'}
        </Button>
        <Button ref={okRef} variant={danger ? 'danger-solid' : 'primary'} disabled={busy} onClick={ok}>
          {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
          {busy ? (opts.busyLabel ?? 'กำลังดำเนินการ') : (opts.confirmLabel ?? 'ยืนยัน')}
        </Button>
      </div>
    </dialog>
  )
}
