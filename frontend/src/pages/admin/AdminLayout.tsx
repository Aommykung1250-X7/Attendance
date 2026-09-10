import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api, loginUrl, USE_MOCK } from '../../lib/api'
import type { Me } from '../../lib/types'
import { cx } from '../../components/ui'
import { ErrorBoundary } from '../../components/ErrorBoundary'

const NAV = [
  { to: '/admin', label: 'บันทึกประจำวัน', end: true, icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/admin/employees', label: 'พนักงาน', icon: 'M16 19v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 10a3 3 0 100-6 3 3 0 000 6zM20 19v-1a4 4 0 00-3-3.87M15 4.13a3 3 0 010 5.74' },
  { to: '/admin/projects', label: 'โปรเจกและตารางกะ', icon: 'M4 7h16v12H4zM9 7V5h6v2' },
  { to: '/admin/import', label: 'นำเข้า Excel', icon: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14' },
  { to: '/admin/report', label: 'รายงานรายเดือน', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { to: '/admin/settings', label: 'ตั้งค่า', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
]

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export default function AdminLayout() {
  const [me, setMe] = useState<Me | null>(null)
  const [state, setState] = useState<'loading' | 'login' | 'forbidden' | 'ok' | 'error'>('loading')
  const location = useLocation()
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m)
        setState(m.isAdmin ? 'ok' : 'forbidden')
        // ลิงก์หน้าจอ QR ไว้ที่เมนู จะได้ไม่ต้องเข้าหน้าตั้งค่าทุกครั้ง
        if (m.isAdmin) api.settings().then((s) => setDisplayUrl(s.displayUrl)).catch(() => {})
      })
      .catch((e) => setState(e.status === 401 ? 'login' : 'error'))
  }, [])

  // เลื่อนกลับขึ้นบนเมื่อเปลี่ยนหน้า
  useEffect(() => window.scrollTo(0, 0), [location.pathname])

  if (state !== 'ok') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[28rem] flex-col justify-center px-6 py-16">
        {state === 'loading' && <p className="text-center text-text-dim">กำลังตรวจสอบ</p>}
        {state === 'error' && <Gate title="เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" body="ลองรีเฟรชหน้านี้อีกครั้ง" />}
        {state === 'login' && (
          <Gate title="หน้าแอดมิน" body="เข้าสู่ระบบด้วยบัญชี Google ที่ถูกกำหนดเป็นแอดมิน">
            <a href={loginUrl()} className="flex min-h-12 items-center justify-center gap-3 rounded-lg bg-ink px-5 text-base font-medium text-chalk hover:bg-ink-2">
              <GoogleMark /> เข้าสู่ระบบด้วย Google
            </a>
          </Gate>
        )}
        {state === 'forbidden' && (
          <Gate title="บัญชีนี้ไม่มีสิทธิ์แอดมิน" body={`${me?.email} ไม่ได้ถูกกำหนดเป็นแอดมิน ถ้าคิดว่าผิด ให้คนดูแลระบบเพิ่มอีเมลนี้ใน ADMIN_EMAILS`}>
            <a href={loginUrl(location.pathname, true)} className="flex min-h-11 items-center justify-center rounded-lg border border-rule-strong bg-surface px-4 font-medium">
              เข้าสู่ระบบด้วยบัญชีอื่น
            </a>
          </Gate>
        )}
      </main>
    )
  }

  const logout = async () => {
    await api.logout()
    window.location.href = '/admin'
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* แถบเมนู: ด้านข้างบนจอใหญ่ ด้านบนบนมือถือ */}
      <aside className="theme-ink sticky top-0 z-30 bg-ink text-chalk lg:h-dvh">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 lg:px-6 lg:pt-7 lg:pb-6">
            <div>
              <p className="display text-lg leading-tight font-semibold">เช็กชื่อเข้างาน</p>
              <p className="text-[13px] text-chalk-dim">ฝั่งแอดมิน{USE_MOCK && ' · ข้อมูลจำลอง'}</p>
            </div>
            <button onClick={logout} className="rounded-md px-2 py-1.5 text-[13px] text-chalk-dim hover:text-chalk lg:hidden">
              ออกจากระบบ
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0" aria-label="เมนูแอดมิน">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors',
                    isActive ? 'bg-chalk/12 font-medium text-chalk' : 'text-chalk-dim hover:bg-chalk/6 hover:text-chalk',
                  )
                }
              >
                <Icon d={n.icon} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          {displayUrl && (
            <a
              href={displayUrl}
              target="_blank"
              rel="noreferrer"
              className="mx-3 mt-4 hidden min-h-10 items-center gap-3 rounded-lg border border-ink-rule px-3 text-[15px] text-chalk-dim hover:text-chalk lg:flex"
            >
              <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
              เปิดหน้าจอ QR ↗
            </a>
          )}
          <div className="mt-auto hidden border-t border-ink-rule px-6 py-5 lg:block">
            <p className="truncate text-[13px] text-chalk-dim" title={me?.email}>
              {me?.email}
            </p>
            <button onClick={logout} className="mt-1 text-[13px] text-chalk-dim underline-offset-4 hover:text-chalk hover:underline">
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-24 sm:px-6 lg:px-10 lg:pt-9">
        {/* หน้าไหนพัง เมนูยังใช้ได้ กดไปหน้าอื่นแล้วจะหายเอง */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}

function Gate({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <>
      <p className="display text-3xl leading-snug font-semibold">{title}</p>
      <p className="mt-3 text-[17px] leading-relaxed text-text-dim">{body}</p>
      {children && <div className="mt-8">{children}</div>}
    </>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 rounded-full bg-white p-0.5" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 01-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 010-4.2V7.1H2.1a11 11 0 000 9.8l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 002.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  )
}
