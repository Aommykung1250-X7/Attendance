// ทุกหน้าเรียก backend ผ่าน `api` ตัวเดียวนี้
// ตั้ง VITE_USE_MOCK=true ใน .env เพื่อใช้ข้อมูลจำลองโดยไม่ต้องมี backend

import { mockApi } from './mock'
import type {
  AdminAction,
  AppSettings,
  AuditEntry,
  CheckInView,
  DayLog,
  DayLogRow,
  Employee,
  EmployeeSchedule,
  Holiday,
  ImportPreview,
  KioskBoard,
  Me,
  MonthlyReport,
  Project,
  ProjectDetail,
  ProjectSummary,
  ScheduleWriteResult,
  ShiftEntry,
} from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** ลิงก์ไปหน้า Google แล้วกลับมาที่หน้าปัจจุบัน */
export function loginUrl(next = location.pathname + location.search, switchAccount = false) {
  return `/api/auth/google?next=${encodeURIComponent(next)}${switchAccount ? '&switch=1' : ''}`
}

async function request<T>(method: string, path: string, body?: unknown, opts: { redirectOn401?: boolean } = {}): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  if (res.status === 401 && opts.redirectOn401) {
    // ยังไม่ได้ล็อกอิน พาไปหน้า Google แล้วกลับมาที่ URL เดิม
    location.href = loginUrl()
    return new Promise<T>(() => {})
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', data)
  return data as T
}

const get = <T>(p: string) => request<T>('GET', p)
const post = <T>(p: string, b: unknown = {}) => request<T>('POST', p, b)
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b)
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b)
const del = <T>(p: string, b?: unknown) => request<T>('DELETE', p, b)
const q = encodeURIComponent

const realApi = {
  // ---- จอในออฟฟิศ (ไม่ต้องล็อกอิน) ----
  board: (displayKey: string) => get<KioskBoard>(`/board/${q(displayKey)}`),

  // ---- เช็กชื่อบนมือถือ ----
  checkInView: (token: string) => request<CheckInView>('GET', `/checkin?token=${q(token)}`, undefined, { redirectOn401: true }),
  confirmCheckIn: (token: string) => request<CheckInView>('POST', '/checkin', { token }, { redirectOn401: true }),
  confirmEarlyLeave: (token: string) => request<CheckInView>('POST', '/checkin/early-leave', { token }, { redirectOn401: true }),

  // ---- ผู้ใช้ ----
  me: () => get<Me>('/me'),
  logout: () => post<{ ok: true }>('/auth/logout'),

  // ---- บันทึกประจำวัน ----
  day: (date?: string) => get<DayLog>(`/admin/day${date ? `?date=${date}` : ''}`),
  adminAction: (shiftId: string, date: string, action: AdminAction) =>
    post<DayLogRow>('/admin/attendance', { shiftId, date, ...action }),
  history: (shiftId: string, date: string) => get<AuditEntry[]>(`/admin/attendance/history?shiftId=${q(shiftId)}&date=${date}`),

  // ---- พนักงาน ----
  employees: (includeInactive = false) => get<Employee[]>(`/employees${includeInactive ? '?inactive=1' : ''}`),
  createEmployee: (e: Omit<Employee, 'id' | 'isActive'>) => post<Employee>('/employees', e),
  updateEmployee: (id: string, e: Partial<Omit<Employee, 'id' | 'isActive'>>) => patch<Employee>(`/employees/${id}`, e),
  hideEmployee: (id: string) => del<Employee>(`/employees/${id}`),
  restoreEmployee: (id: string) => post<Employee>(`/employees/${id}/restore`),
  purgeEmployee: (id: string, confirmName: string) => del<{ ok: true }>(`/employees/${id}/purge`, { confirmName }),
  schedule: (id: string) => get<EmployeeSchedule>(`/employees/${id}/schedule`),
  writeSchedule: (employeeId: string, projectId: string, shifts: ShiftEntry[]) =>
    put<ScheduleWriteResult>(`/employees/${employeeId}/schedule/${projectId}`, { shifts }),

  // ---- โปรเจก ----
  projects: () => get<ProjectSummary[]>('/projects'),
  project: (id: string) => get<ProjectDetail>(`/projects/${id}`),
  createProject: (p: Omit<Project, 'id'>) => post<Project>('/projects', p),
  updateProject: (id: string, p: Partial<Omit<Project, 'id'>>) => patch<Project>(`/projects/${id}`, p),
  deleteProject: (id: string) => del<{ ok: true }>(`/projects/${id}`),
  assign: (projectId: string, employeeId: string, shifts: ShiftEntry[]) =>
    post<ScheduleWriteResult>(`/projects/${projectId}/assign`, { employeeId, shifts }),

  // ---- รายงาน ----
  report: (employeeId: string, month: string) => get<MonthlyReport>(`/report/${employeeId}?month=${month}`),

  // ---- นำเข้า Excel ----
  importPreview: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<ImportPreview>('POST', '/import/preview', fd)
  },
  importCommit: () => post<{ applied: number }>('/import/commit'),
  importCancel: () => post<{ ok: true }>('/import/cancel'),
  templateUrl: '/api/import/template',

  // ---- ตั้งค่า ----
  settings: () => get<AppSettings>('/settings'),
  updateSettings: (s: { qrTokenTtl: number }) => patch<AppSettings>('/settings', s),
  rotateDisplayKey: () => post<AppSettings>('/settings/display-key'),
  resetAttendance: () => post<{ ok: true; deletedAttendance: number; deletedOverrides: number }>('/settings/reset-attendance'),
  holidays: (year?: string) => get<Holiday[]>(`/holidays${year ? `?year=${year}` : ''}`),
  addHoliday: (h: Holiday) => post<Holiday>('/holidays', h),
  removeHoliday: (date: string) => del<{ ok: true }>(`/holidays/${date}`),
}

export type Api = typeof realApi

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
export const api: Api = USE_MOCK ? mockApi : realApi
