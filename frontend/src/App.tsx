import { BrowserRouter, Link, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NotifyProvider } from './components/notify'
import CheckIn from './pages/CheckIn'
import Kiosk from './pages/Kiosk'
import AdminLayout from './pages/admin/AdminLayout'
import Today from './pages/admin/Today'
import Employees from './pages/admin/Employees'
import EmployeeDetail from './pages/admin/EmployeeDetail'
import Projects from './pages/admin/Projects'
import ProjectDetail from './pages/admin/ProjectDetail'
import ImportExcel from './pages/admin/ImportExcel'
import Report from './pages/admin/Report'
import Settings from './pages/admin/Settings'
import { loginUrl } from './lib/api'

export default function App() {
  return (
    <BrowserRouter>
      <NotifyProvider>
        <AppRoutes />
      </NotifyProvider>
    </BrowserRouter>
  )
}

function AppRoutes() {
  const location = useLocation()
  return (
    <ErrorBoundary full resetKey={location.pathname}>
      <Routes>
        <Route path="/display/:displayKey" element={<Kiosk />} />
        <Route path="/checkin" element={<CheckIn />} />
        <Route path="/auth/error" element={<AuthError />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Today />} />
          <Route path="employees" element={<Employees />} />
          <Route path="employees/:id" element={<EmployeeDetail />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="import" element={<ImportExcel />} />
          <Route path="report" element={<Report />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Plain title="ไม่พบหน้านี้" body="ลิงก์อาจพิมพ์ผิดหรือถูกเปลี่ยนแล้ว" />} />
      </Routes>
    </ErrorBoundary>
  )
}

function Plain({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col justify-center px-6 py-16">
      <p className="display text-3xl leading-snug font-semibold">{title}</p>
      <p className="mt-3 text-[17px] leading-relaxed text-text-dim">{body}</p>
      {children && <div className="mt-8 flex flex-col gap-3">{children}</div>}
    </main>
  )
}

function Home() {
  return (
    <Plain title="ระบบเช็กชื่อเข้างาน" body="พนักงานเช็กชื่อด้วยการสแกน QR ที่จอในออฟฟิศ ไม่ต้องเปิดหน้านี้">
      <Link to="/admin" className="text-[15px] font-medium text-text underline underline-offset-4">
        เข้าหน้าแอดมิน
      </Link>
    </Plain>
  )
}

const REASONS: Record<string, string> = {
  cancelled: 'คุณยกเลิกการเข้าสู่ระบบที่หน้า Google',
  state: 'การเข้าสู่ระบบใช้เวลานานเกินไปหรือเปิดจากคนละแท็บ ลองใหม่อีกครั้ง',
  unverified: 'บัญชี Google นี้ยังไม่ได้ยืนยันอีเมล',
  google_error: 'ติดต่อ Google ไม่สำเร็จ ลองใหม่อีกครั้ง',
}

function AuthError() {
  const [p] = useSearchParams()
  const reason = p.get('reason') ?? ''
  return (
    <Plain title="เข้าสู่ระบบไม่สำเร็จ" body={REASONS[reason] ?? 'เกิดข้อผิดพลาดระหว่างเข้าสู่ระบบ'}>
      <p className="text-[15px] text-text-dim">ถ้ากำลังเช็กชื่อ ให้สแกน QR บนจออีกครั้ง</p>
      <a href={loginUrl('/admin', true)} className="text-[15px] font-medium text-text underline underline-offset-4">
        เข้าสู่ระบบแอดมินอีกครั้ง
      </a>
    </Plain>
  )
}
