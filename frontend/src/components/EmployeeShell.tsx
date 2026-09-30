// โครงหน้าของพนักงาน (/request, /history): พื้นครีม หัวหน้า ปุ่มบัญชี และเมนูล่างบนมือถือ

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cx } from './ui'
import { api } from '../lib/api'
import { displayName } from '../lib/format'
import type { Employee } from '../lib/types'

export function Shell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-rq-page text-rq-ink">
      <main className="mx-auto max-w-[48rem] px-6 pt-8 pb-[calc(76px+env(safe-area-inset-bottom)+40px)] sm:px-10 sm:pt-12 sm:pb-20">
        {header}
        {children}
      </main>
      <BottomNav />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ไอคอนเส้น
// ---------------------------------------------------------------------------

const ICONS = {
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  request: <><path d="M7 3.5h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" /><path d="M14 3.5V8h4M9 12.5h6M9 16h4" /></>,
  checkin: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  history: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9M12 8v4.5l3 2" /></>,
  paperclip: <path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4L15 7" />,
  inbox: <><path d="M3.5 13.5 6 5.5h12l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-5Z" /><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" /></>,
  logout: <><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 8l-4 4 4 4M6 12h9" /></>,
}

export type IconName = keyof typeof ICONS

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// ส่วนหัว และเมนูล่างบนมือถือ
// ---------------------------------------------------------------------------

/** ตัวแรกของชื่อที่ไม่ใช่สระหน้า (เ แ โ ใ ไ) เช่น "เอ" → "อ" */
const initialOf = (name: string) => Array.from(name.trim()).find((ch) => !'เแโใไ'.includes(ch))?.toUpperCase() ?? '?'

export function AccountButton({ employee }: { employee: Employee }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const name = displayName(employee)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const logout = async () => {
    await api.logout()
    window.location.href = '/request'
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`บัญชีผู้ใช้ ${name}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((x) => !x)}
        className="flex min-h-11 items-center gap-2 rounded-full transition-colors sm:border sm:border-rq-line sm:bg-rq-card sm:py-1 sm:pr-3 sm:pl-1 sm:hover:border-rq-line-hover"
      >
        <span aria-hidden className="grid size-11 place-items-center rounded-full bg-rq-accent font-display text-lg font-semibold text-white sm:size-9 sm:text-base">
          {initialOf(employee.nickname)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-rq-ink-2 sm:inline">{name}</span>
        <Icon name="chevronDown" className="hidden size-4 text-rq-meta sm:block" />
      </button>
      {open && (
        <div id={panelId} className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-rq-line bg-rq-card p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate font-medium text-rq-ink">{name}</p>
            {employee.email && <p className="truncate text-sm text-rq-meta">{employee.email}</p>}
          </div>
          <button type="button" onClick={logout} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-rq-ink-2 hover:bg-rq-chip">
            <Icon name="logout" className="size-[18px]" />
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}

const NAV: { label: string; icon: IconName; href: string }[] = [
  { label: 'คำขอ', icon: 'request', href: '/request' },
  { label: 'ประวัติ', icon: 'history', href: '/history' },
]

function BottomNav() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="เมนูหลัก" className="fixed inset-x-0 bottom-0 z-30 border-t border-rq-line bg-rq-card pb-[env(safe-area-inset-bottom)] sm:hidden">
      <ul className="mx-auto grid h-[76px] max-w-[30rem] grid-cols-2">
        {NAV.map((item) => {
          const current = item.href === pathname
          return (
            <li key={item.label}>
              <Link
                to={item.href}
                aria-current={current ? 'page' : undefined}
                className={cx('flex h-full min-h-11 flex-col items-center justify-center gap-1', current ? 'text-rq-accent' : 'text-rq-dim hover:text-rq-ink')}
              >
                <Icon name={item.icon} className="size-6" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** ลิงก์ระหว่างหน้าพนักงานบนจอใหญ่ (บนมือถือใช้เมนูล่างแทน) */
function DesktopNav() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="เมนูหลัก" className="hidden gap-1 sm:flex">
      {NAV.map((item) => {
        const current = item.href === pathname
        return (
          <Link
            key={item.label}
            to={item.href}
            aria-current={current ? 'page' : undefined}
            className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors', current ? 'text-rq-accent' : 'text-rq-dim hover:text-rq-ink')}
          >
            <Icon name={item.icon} className="size-[18px]" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** หัวหน้าของหน้าพนักงาน: ชื่อระบบ หัวข้อ และปุ่มบัญชี */
export function EmployeeHeader({ title, employee }: { title: string; employee: Employee }) {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-rq-line pb-5">
      <div className="min-w-0">
        <p className="text-sm text-rq-dim">ระบบเช็กชื่อเข้างาน</p>
        <h1 className="mt-1 font-display text-[28px] leading-tight font-bold text-rq-ink sm:text-4xl">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <DesktopNav />
        <AccountButton employee={employee} />
      </div>
    </header>
  )
}
