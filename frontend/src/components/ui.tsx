// ชิ้นส่วนพื้นฐานของหน้าเว็บ ปุ่มสูงอย่างน้อย 44px เพื่อให้กดบนมือถือได้แม่น

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

/** รวม class และให้ class ที่ส่งเข้ามาทีหลังชนะ (เช่น w-32 ทับ w-full) */
const cx = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(' '))
export { cx }

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong disabled:bg-brand-100 disabled:text-ink-rule',
  secondary: 'bg-surface text-text border border-rule-strong hover:bg-sunken disabled:text-text-dim',
  ghost: 'text-text-dim hover:bg-sunken hover:text-text',
  // ปุ่มอันตรายแบบเส้นขอบ วางรองจากปุ่มหลักได้โดยไม่แย่งความเด่น
  danger: 'border border-absent/40 text-absent bg-transparent hover:bg-absent-bg disabled:opacity-50',
  'danger-solid': 'bg-absent text-white hover:bg-absent/90 disabled:bg-absent/40',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        size === 'md' ? 'min-h-11 px-4 text-[15px]' : 'min-h-9 px-3 text-sm',
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-[13px] leading-relaxed text-text-dim">{hint}</p>}
      {error && <p className="text-[13px] text-absent">{error}</p>}
    </div>
  )
}

const inputCls =
  'min-h-11 w-full rounded-lg border border-rule-strong bg-surface px-3 text-[15px] text-text placeholder:text-text-dim/60 focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/20 disabled:bg-sunken'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputCls, className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'appearance-none bg-[length:12px] bg-[right_0.8rem_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  )
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%235e6776' stroke-width='1.6'/%3E%3C/svg%3E")`

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, 'min-h-20 py-2.5 leading-relaxed', className)} {...rest} />
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] select-none', className)}>
      <input type="checkbox" className="size-4.5 accent-ink" {...rest} />
      {label}
    </label>
  )
}

/** กล่องโต้ตอบแบบ modal ใช้ <dialog> ของเบราว์เซอร์ ปิดด้วย Esc ได้ */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'm-auto max-h-[92dvh] w-[calc(100%-1.5rem)] rounded-2xl bg-surface p-0 text-text shadow-2xl backdrop:bg-ink/45 open:animate-fade',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <h2 className="display text-lg leading-snug font-semibold">{title}</h2>
            <button onClick={onClose} className="-mr-2 -mt-1 rounded-md p-2 text-text-dim hover:bg-sunken" aria-label="ปิด">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="display text-[26px] leading-tight font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-text-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-xl border border-rule bg-surface', className)}>{children}</section>
}

export function Loading({ label = 'กำลังโหลด' }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-center text-[15px] text-text-dim">
      {label}
    </p>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-absent/30 bg-absent-bg px-4 py-3 text-[15px] text-absent">
      <span className="whitespace-pre-line">{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          ลองใหม่
        </Button>
      )}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="display text-lg font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-[42ch] text-[15px] leading-relaxed text-text-dim">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** ข้อความแจ้งผลสั้นๆ มุมล่างของจอ */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => done.current(), 3200)
    return () => clearTimeout(t)
  }, [message])
  if (!message) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <p className="animate-stamp rounded-full bg-ink px-5 py-2.5 text-[15px] text-chalk shadow-lg">{message}</p>
    </div>
  )
}
