import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { WEEKDAYS, describeShifts, displayName } from '../../lib/format'
import type { Employee, ProjectDetail as Detail, ShiftEntry } from '../../lib/types'
import { QuickShiftForm } from '../../components/Schedule'
import { Button, Card, Dialog, Empty, ErrorNote, Field, Loading, Select } from '../../components/ui'
import { Toast, useNotify } from '../../components/notify'
import { ProjectDialog } from './Projects'

export default function ProjectDetail() {
  const { id = '' } = useParams()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'edit' | 'assign'>(null)
  const [toast, setToast] = useState<string | null>(null)
  const navigate = useNavigate()
  const notify = useNotify()

  const load = () => api.project(id).then(setData).catch((e) => setError(e.message))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (error) return <ErrorNote message={error} onRetry={load} />
  if (!data) return <Loading />
  const p = data.project

  return (
    <>
      <Link to="/admin/projects" className="text-sm text-text-dim hover:text-text">
        ← โปรเจกทั้งหมด
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] leading-tight font-semibold">{p.name}</h1>
          <p className="tnum mt-1 text-[15px] text-text-dim">
            เวลาเริ่มต้น {p.defaultStart}–{p.defaultEnd} · {data.members.length} คน
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setDialog('edit')}>แก้โปรเจก</Button>
          <Button variant="primary" onClick={() => setDialog('assign')}>
            + เพิ่มคนเข้าโปรเจก
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {data.members.length === 0 ? (
          <Empty
            title="ยังไม่มีใครในโปรเจกนี้"
            body="เพิ่มทีละคน หรือนำเข้าจาก Excel"
            action={
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  const ok = await notify.confirm({
                    title: `ลบโปรเจก ${p.name}?`,
                    body: 'โปรเจกนี้ยังไม่มีใครอยู่ ลบแล้วจะหายจากรายการโปรเจก',
                    confirmLabel: 'ลบโปรเจก',
                    busyLabel: 'กำลังลบ',
                    danger: true,
                    action: () => api.deleteProject(p.id),
                  })
                  if (!ok) return
                  notify.toast(`ลบโปรเจก ${p.name} แล้ว`)
                  navigate('/admin/projects')
                }}
              >
                ลบโปรเจกนี้
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-rule">
            {data.members.map((m) => (
              <li key={m.employee.id}>
                <Link to={`/admin/employees/${m.employee.id}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5 hover:bg-sunken/60">
                  <span className="font-medium">
                    {m.employee.nickname}
                    {m.employee.gen && <span className="ml-2 text-sm font-normal text-text-dim">{m.employee.gen}</span>}
                  </span>
                  <span className="tnum text-sm text-text-dim">{describeShifts(m.shifts)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog === 'edit' && (
        <ProjectDialog
          title="แก้โปรเจก"
          initial={{ name: p.name, defaultStart: p.defaultStart, defaultEnd: p.defaultEnd }}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            await api.updateProject(p.id, v)
            setDialog(null)
            load()
          }}
        />
      )}
      {dialog === 'assign' && (
        <AssignDialog
          detail={data}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setToast(message)
            load()
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}

function AssignDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: (message: string) => void }) {
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [entries, setEntries] = useState<ShiftEntry[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.employees().then(setEmployees).catch((e) => setError(e.message))
  }, [])
  const choices = useMemo(
    () => (employees ?? []).filter((e) => !detail.members.some((m) => m.employee.id === e.id)),
    [employees, detail.members],
  )

  const save = async () => {
    if (!employeeId) return setError('เลือกคนที่จะเพิ่ม')
    setBusy(true)
    setError(null)
    try {
      const r = await api.assign(detail.project.id, employeeId, entries!)
      const who = choices.find((e) => e.id === employeeId)!
      const replaced = r.replaced.length
        ? ` (กะเดิมที่ทับกันถูกแทนที่: ${r.replaced.map((x) => `${x.projectName} วัน${WEEKDAYS[x.weekday - 1].short} ${x.startTime}–${x.endTime}`).join(', ')})`
        : ''
      onDone(`เพิ่ม ${displayName(who)} แล้ว${replaced}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`เพิ่มคนเข้า ${detail.project.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" disabled={busy || !entries || !employeeId} onClick={save}>
            เพิ่ม
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      <div className="space-y-5">
        <Field label="คน" hint="คนที่ยังไม่อยู่ในรายชื่อต้องเพิ่มที่หน้าพนักงานก่อน">
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!employees}>
              <option value="">{employees ? 'เลือกคน' : 'กำลังโหลด'}</option>
              {(['staff', 'student'] as const).map((t) => (
                <optgroup key={t} label={t === 'staff' ? 'ประจำ' : 'นักศึกษา'}>
                  {choices
                    .filter((e) => e.type === t)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {displayName(e)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <QuickShiftForm
          defaultStart={detail.project.defaultStart}
          defaultEnd={detail.project.defaultEnd}
          onChange={(en, err) => {
            setEntries(en)
            setFormError(err)
          }}
        />
        {formError && <p className="text-sm text-absent">{formError}</p>}
        <p className="text-[13px] leading-relaxed text-text-dim">
          ถ้าคนนี้มีกะของโปรเจกอื่นที่เวลาทับกัน กะเดิมจะถูกแทนที่ (ใครเขียนทีหลังชนะ) ถ้าแต่ละวันเวลาไม่เท่ากัน แก้ต่อได้ที่หน้าของคนนั้น
        </p>
      </div>
    </Dialog>
  )
}
