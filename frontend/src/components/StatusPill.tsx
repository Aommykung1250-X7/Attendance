import { STATUS_LABEL, type ShiftStatus } from '../lib/types'

const TEXT: Record<ShiftStatus, string> = {
  ontime: 'text-ontime',
  late: 'text-late',
  absent: 'text-absent',
  leave: 'text-leave',
  pending: 'text-pending',
}

const PILL: Record<ShiftStatus, string> = {
  ontime: 'bg-ontime-bg text-ontime',
  late: 'bg-late-bg text-late',
  absent: 'bg-absent-bg text-absent',
  leave: 'bg-leave-bg text-leave',
  pending: 'bg-pending-bg text-pending',
}

const DOT: Record<ShiftStatus, string> = {
  ontime: 'bg-ontime',
  late: 'bg-late',
  absent: 'bg-absent',
  leave: 'bg-leave',
  pending: 'bg-transparent ring-[1.5px] ring-pending ring-inset',
}

/** สถานะแบบข้อความมีจุดนำหน้า ใช้บนจอติดผนัง (สีเปลี่ยนตามพื้นหลังผ่าน .theme-ink) */
export function StatusText({ status }: { status: ShiftStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[clamp(1.05rem,1.35vw,1.5rem)] font-medium ${TEXT[status]}`}>
      <span aria-hidden className={`inline-block size-[0.55em] rounded-full ${DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** สถานะแบบป้าย ใช้ในหน้าแอดมิน */
export function StatusPill({ status, className = '' }: { status: ShiftStatus; className?: string }) {
  return (
    <span className={`inline-flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium ${PILL[status]} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}
