import { useState } from 'react'
import type { Employee } from '../lib/types'
import { Field, Input, cx } from './ui'

export type EmployeeInput = Omit<Employee, 'id' | 'isActive'>

export const emptyEmployee: EmployeeInput = { nickname: '', gen: null, email: '', type: 'student', position: '' }

export function EmployeeForm({ value, onChange }: { value: EmployeeInput; onChange: (v: EmployeeInput) => void }) {
  const [touched, setTouched] = useState(false)
  const emailBad = touched && value.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
  const set = (patch: Partial<EmployeeInput>) => onChange({ ...value, ...patch })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="ชื่อเล่น">{(id) => <Input id={id} value={value.nickname} onChange={(e) => set({ nickname: e.target.value })} autoFocus />}</Field>
      <Field label="Gen" hint="แยกจากชื่อ ใส่เฉพาะนักศึกษา เช่น Gen 8">
        {(id) => <Input id={id} value={value.gen ?? ''} onChange={(e) => set({ gen: e.target.value || null })} placeholder="เว้นว่างได้" />}
      </Field>
      <div className="sm:col-span-2">
        <Field
          label="อีเมลบัญชี Google"
          error={emailBad ? 'อีเมลไม่ถูกต้อง แก้ให้อยู่ในรูป name@example.com' : null}
          hint={
            <>
              <strong className="font-medium text-late">ต้องเป็นอีเมลที่ใช้ล็อกอิน Google ได้</strong> (Gmail หรืออีเมลที่ผูกกับบัญชี Google)
              ถ้ากรอกอีเมลอื่น คนนี้จะเช็กชื่อไม่ได้เลย ถ้าไม่แน่ใจให้เจ้าตัวลองเปิด accounts.google.com ด้วยอีเมลนั้นก่อน
            </>
          }
        >
          {(id) => (
            <Input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={value.email}
              onBlur={() => setTouched(true)}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="name@gmail.com"
            />
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">ประเภท</legend>
        <div className="flex gap-2">
          {(['staff', 'student'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={value.type === t}
              onClick={() => set({ type: t })}
              className={cx(
                'min-h-11 flex-1 rounded-lg border px-3 text-[15px] transition-colors',
                value.type === t ? 'border-ink bg-ink text-chalk' : 'border-rule-strong bg-surface hover:bg-sunken',
              )}
            >
              {t === 'staff' ? 'ประจำ' : 'นักศึกษา'}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="ตำแหน่ง">{(id) => <Input id={id} value={value.position} onChange={(e) => set({ position: e.target.value })} placeholder="เว้นว่างได้" />}</Field>
    </div>
  )
}

export function employeeFormError(v: EmployeeInput): string | null {
  if (!v.nickname.trim()) return 'กรอกชื่อเล่น'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return 'กรอกอีเมลบัญชี Google ให้ถูกต้อง'
  return null
}
