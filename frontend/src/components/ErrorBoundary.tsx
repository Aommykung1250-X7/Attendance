// กันหน้าขาว: ถ้าหน้าไหนพัง ให้แสดงข้อความพร้อมรายละเอียด แทนที่ทั้งแอปจะหายไป
// resetKey เปลี่ยน (เช่นเปลี่ยนหน้า) แล้วจะลองแสดงหน้าใหม่อีกครั้ง

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  resetKey?: string
  /** แสดงแบบเต็มจอ (ใช้ชั้นนอกสุด) หรือแบบในกรอบเนื้อหา */
  full?: boolean
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[หน้าเว็บพัง]', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={this.props.full ? 'mx-auto flex min-h-dvh max-w-[34rem] flex-col justify-center px-6 py-16' : 'py-10'}>
        <p className="display text-2xl font-semibold">หน้านี้แสดงไม่ได้</p>
        <p className="mt-2 text-[15px] leading-relaxed text-text-dim">
          เกิดข้อผิดพลาดระหว่างแสดงผล ลองโหลดหน้าใหม่ ถ้ายังเป็นอยู่ ให้แคปข้อความด้านล่างส่งให้คนดูแลระบบ
        </p>
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-absent">
          {error.name}: {error.message}
          {'\n'}
          {location.pathname}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => location.reload()} className="min-h-11 rounded-lg bg-ink px-4 font-medium text-chalk">
            โหลดหน้าใหม่
          </button>
          <a href="/admin" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 font-medium">
            กลับหน้าแอดมิน
          </a>
        </div>
      </div>
    )
  }
}
