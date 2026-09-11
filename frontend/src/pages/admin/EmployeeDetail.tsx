// รายละเอียดพนักงาน: ข้อมูล ตารางกะรายคน และการลบ (spec 9.3, 9.4)

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { WEEKDAYS, describeShifts, displayName, typeLabel } from '../../lib/format'
import type { EmployeeSchedule, ProjectSummary, ScheduleWriteResult, ShiftEntry } from '../../lib/types'
import { EmployeeForm, employeeFormError, type EmployeeInput } from '../../components/EmployeeForm'
import { QuickShiftForm, ShiftRowsEditor, WeekGrid, checkRows } from '../../components/Schedule'
import { Button, Card, Dialog, ErrorNote, Field, Input, Loading, Select, Toast } from '../../components/ui'

export default function EmployeeDetail() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const [data, setData] = useState<EmployeeSchedule | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [replacedNote, setReplacedNote] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'edit' | 'add-project' | 'purge'>(null)
  const navigate = useNavigate()

  const load = () =>
    api
      .schedule(id)
      .then(setData)
      .catch((e) => setError(e.message))
  useEffect(() => {
    load()
    api.projects().then(setProjects).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const afterWrite = (r: ScheduleWriteResult, message: string) => {
    setData(r.schedule)
    setToast(message)
    setReplacedNote(
      r.replaced.length
        ? `กะเดิมที่เวลาทับกันถูกแทนที่: ${r.replaced.map((x) => `${x.projectName} วัน${WEEKDAYS[x.weekday - 1].long} ${x.startTime}–${x.endTime}`).join(', ')}`
        : null,
    )
  }

  if (error) return <ErrorNote message={error} onRetry={load} />
  if (!data) return <Loading />
  const e = data.employee
  const all = data.assignments.flatMap((a) => a.shifts.map((s) => ({ ...s, label: a.projectName })))
  const unassigned = projects.filter((p) => !data.assignments.some((a) => a.projectId === p.id))

  return (
    <>
      <Link to="/admin/employees" className="text-sm text-text-dim hover:text-text">
        ← พนักงานทั้งหมด
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] leading-tight font-semibold">
            {e.nickname}
            {e.gen && <span className="ml-2.5 text-xl font-medium text-text-dim">{e.gen}</span>}
            {!e.isActive && <span className="ml-3 rounded bg-sunken px-2 py-0.5 align-middle text-sm font-normal text-text-dim">ถูกซ่อน</span>}
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">
            {typeLabel(e.type)}
            {e.position && ` · ${e.position}`} ·{' '}
            {e.email ?? <span className="text-late">ยังไม่มีอีเมล — กด "แก้ข้อมูล" เพื่อกรอก ระหว่างนี้เช็กชื่อเองไม่ได้</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/admin/report?employee=${e.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 text-[15px] font-medium hover:bg-sunken">
            ดูรายงาน
          </Link>
          <Button onClick={() => setDialog('edit')}>แก้ข้อมูล</Button>
        </div>
      </div>

      {params.get('new') && data.assignments.length === 0 && (
        <p className="mb-5 rounded-lg bg-leave-bg px-4 py-3 text-[15px] text-leave">เพิ่ม {displayName(e)} แล้ว ขั้นต่อไปคือเพิ่มเข้าโปรเจกและกำหนดวันเวลาที่มา ไม่งั้นระบบจะถือว่าไม่มีตารางงาน</p>
      )}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="display text-lg font-semibold">ตารางกะ</h2>
            <p className="text-sm text-text-dim">เวลาเป็นของรายบุคคล ตารางนี้เป็นตัวตัดสินว่าสายหรือไม่</p>
          </div>
          {e.isActive && unassigned.length > 0 && (
            <Button variant="primary" size="sm" onClick={() => setDialog('add-project')}>
              + เพิ่มเข้าโปรเจก
            </Button>
          )}
        </div>
        <WeekGrid items={all} />
        {replacedNote && <p className="mt-3 rounded-lg bg-late-bg px-4 py-2.5 text-sm text-late">{replacedNote}</p>}
        {data.assignments.length === 0 ? (
          <p className="mt-4 text-[15px] text-text-dim">ยังไม่มีกะ คนนี้จะไม่ปรากฏในบันทึกประจำวันและเช็กชื่อไม่ได้</p>
        ) : (
          <div className="mt-5 space-y-4">
            {data.assignments.map((a) => (
              <AssignmentEditor
                key={a.projectId + a.shifts.map((s) => s.id).join()}
                employeeId={e.id}
                projectId={a.projectId}
                projectName={a.projectName}
                shifts={a.shifts}
                disabled={!e.isActive}
                onSaved={afterWrite}
              />
            ))}
          </div>
        )}
      </Card>

      <DangerZone
        name={e.nickname}
        active={e.isActive}
        onHide={async () => {
          await api.hideEmployee(e.id)
          setToast(`ซ่อน ${displayName(e)} แล้ว`)
          load()
        }}
        onRestore={async () => {
          await api.restoreEmployee(e.id)
          setToast(`กู้คืน ${displayName(e)} แล้ว เพิ่มเข้าโปรเจกอีกครั้งเพื่อให้มีตารางกะ`)
          load()
        }}
        onPurge={() => setDialog('purge')}
      />

      {dialog === 'edit' && (
        <EditDialog
          value={{ nickname: e.nickname, gen: e.gen, email: e.email ?? '', type: e.type, position: e.position }}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            await api.updateEmployee(e.id, { ...v, email: v.email.trim() || null })
            setDialog(null)
            setToast('บันทึกข้อมูลแล้ว')
            load()
          }}
        />
      )}
      {dialog === 'add-project' && (
        <AddToProject
          projects={unassigned}
          onClose={() => setDialog(null)}
          onSave={async (projectId, shifts) => {
            const r = await api.writeSchedule(e.id, projectId, shifts)
            setDialog(null)
            afterWrite(r, 'เพิ่มเข้าโปรเจกแล้ว')
          }}
        />
      )}
      {dialog === 'purge' && (
        <PurgeDialog
          name={e.nickname}
          onClose={() => setDialog(null)}
          onConfirm={async (typed) => {
            await api.purgeEmployee(e.id, typed)
            navigate('/admin/employees')
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}

function AssignmentEditor({
  employeeId,
  projectId,
  projectName,
  shifts,
  disabled,
  onSaved,
}: {
  employeeId: string
  projectId: string
  projectName: string
  shifts: ShiftEntry[]
  disabled: boolean
  onSaved: (r: ScheduleWriteResult, message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<ShiftEntry[]>(shifts.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (next: ShiftEntry[], message: string) => {
    const err = checkRows(next)
    if (err) return setError(err)
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.writeSchedule(employeeId, projectId, next), message)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-rule">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium">{projectName}</p>
          <p className="tnum text-sm text-text-dim">{describeShifts(shifts)}</p>
        </div>
        {!disabled && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            แก้เวลา
          </Button>
        )}
      </div>
      {editing && (
        <div className="border-t border-rule px-4 py-4">
          {error && (
            <div className="mb-3">
              <ErrorNote message={error} />
            </div>
          )}
          <ShiftRowsEditor value={rows} onChange={setRows} />
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-rule pt-4">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => confirm(`เอาออกจาก ${projectName}? กะทั้งหมดในโปรเจกนี้จะหายจากตาราง (ประวัติเดิมยังอยู่)`) && save([], `เอาออกจาก ${projectName} แล้ว`)}>
              เอาออกจากโปรเจกนี้
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                ยกเลิก
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => save(rows, 'บันทึกตารางกะแล้ว')}>
                {busy ? 'กำลังบันทึก' : 'บันทึก'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditDialog({ value, onClose, onSave }: { value: EmployeeInput; onClose: () => void; onSave: (v: EmployeeInput) => Promise<void> }) {
  const [v, setV] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="แก้ข้อมูลพนักงาน"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              const err = employeeFormError(v)
              if (err) return setError(err)
              setBusy(true)
              try {
                await onSave({ ...v, gen: v.gen?.trim() || null })
              } catch (e) {
                setError((e as Error).message)
                setBusy(false)
              }
            }}
          >
            บันทึก
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      <EmployeeForm value={v} onChange={setV} />
    </Dialog>
  )
}

function AddToProject({
  projects,
  onClose,
  onSave,
}: {
  projects: ProjectSummary[]
  onClose: () => void
  onSave: (projectId: string, shifts: ShiftEntry[]) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [entries, setEntries] = useState<ShiftEntry[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const p = projects.find((x) => x.id === projectId)

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="เพิ่มเข้าโปรเจก"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={busy || !entries}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(projectId, entries!)
              } catch (e) {
                setError((e as Error).message)
                setBusy(false)
              }
            }}
          >
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
        <Field label="โปรเจก" hint="เวลาเริ่มต้นของโปรเจกถูกกรอกให้แล้ว แก้ให้ตรงกับเวลาจริงของคนนี้ได้">
          {(id) => (
            <Select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.defaultStart}–{x.defaultEnd})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {p && (
          <QuickShiftForm
            key={p.id}
            defaultStart={p.defaultStart}
            defaultEnd={p.defaultEnd}
            onChange={(en, err) => {
              setEntries(en)
              setFormError(err)
            }}
          />
        )}
        {formError && <p className="text-sm text-absent">{formError}</p>}
        <p className="text-[13px] leading-relaxed text-text-dim">ถ้าเวลาทับกับกะของโปรเจกอื่นของคนนี้ กะเดิมจะถูกแทนที่ (ใครเขียนทีหลังชนะ)</p>
      </div>
    </Dialog>
  )
}

function DangerZone({ name, active, onHide, onRestore, onPurge }: { name: string; active: boolean; onHide: () => Promise<void>; onRestore: () => Promise<void>; onPurge: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mt-8 rounded-xl border border-rule p-5">
      <h2 className="display text-lg font-semibold">ลบพนักงาน</h2>
      {active ? (
        <>
          <p className="mt-1 max-w-[62ch] text-[15px] leading-relaxed text-text-dim">
            ลบแล้ว {name} จะหายจากทุกหน้า ล็อกอินไม่ได้ และไม่ต้องมาเช็กชื่อ แต่ประวัติเดิมยังอยู่ รายงานของเดือนที่ผ่านมาจึงไม่เปลี่ยน (เช่นนักศึกษาที่จบแล้ว)
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy} onClick={() => confirm(`ลบ ${name}? กู้คืนได้ภายหลัง`) && run(onHide)}>
              ลบ (ซ่อน)
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[15px] text-text-dim">คนนี้ถูกซ่อนอยู่ กู้คืนแล้วต้องเพิ่มเข้าโปรเจกใหม่เพื่อให้มีตารางกะ</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => run(onRestore)}>
              กู้คืน
            </Button>
          </div>
        </>
      )}
      <div className="mt-5 border-t border-rule pt-4">
        <p className="text-[15px] text-text-dim">เพิ่มผิดคน? ลบถาวรจะลบประวัติการเช็กชื่อทั้งหมดของคนนี้ด้วย</p>
        <Button size="sm" variant="ghost" className="mt-2 -ml-3 text-absent" onClick={onPurge}>
          ลบถาวร…
        </Button>
      </div>
    </section>
  )
}

function PurgeDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: (typed: string) => Promise<void> }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog
      open
      onClose={onClose}
      title="ลบถาวร"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="danger-solid" disabled={typed !== name} onClick={() => onConfirm(typed).catch((e) => setError(e.message))}>
            ลบถาวร
          </Button>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed">
        ใช้เฉพาะกรณีเพิ่มผิดคนเท่านั้น ประวัติการเช็กชื่อทั้งหมดของ <strong>{name}</strong> จะหายไปและกู้คืนไม่ได้
      </p>
      <div className="mt-4">
        <Field label={`พิมพ์ "${name}" เพื่อยืนยัน`} error={error}>
          {(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
        </Field>
      </div>
    </Dialog>
  )
}
