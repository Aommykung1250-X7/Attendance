// โปรเจก (spec 9.4) — ชื่อโปรเจกเป็นชื่องาน ไม่ใช่สถานที่ เวลาของโปรเจกใช้เป็นค่ากรอกล่วงหน้าเท่านั้น

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Project, ProjectSummary } from '../../lib/types'
import { Button, Card, Dialog, Empty, ErrorNote, Field, Input, Loading, PageHeader } from '../../components/ui'

export default function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const load = () => api.projects().then(setList).catch((e) => setError(e.message))
  useEffect(() => {
    load()
  }, [])

  return (
    <>
      <PageHeader
        title="โปรเจกและตารางกะ"
        sub="เวลาของโปรเจกใช้กรอกให้ล่วงหน้าตอนเพิ่มคนเท่านั้น เวลาจริงเป็นของแต่ละคน"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            + สร้างโปรเจก
          </Button>
        }
      />
      {error && <ErrorNote message={error} onRetry={load} />}
      {!list && !error && <Loading />}
      {list &&
        (list.length === 0 ? (
          <Card>
            <Empty title="ยังไม่มีโปรเจก" body="สร้างโปรเจกก่อน แล้วค่อยเพิ่มคนหรือนำเข้าตารางจาก Excel" />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <Link key={p.id} to={`/admin/projects/${p.id}`} className="group rounded-xl border border-rule bg-surface p-5 transition-colors hover:border-rule-strong hover:bg-sunken/40">
                <p className="display text-lg font-semibold group-hover:underline underline-offset-4">{p.name}</p>
                <p className="tnum mt-1 text-sm text-text-dim">
                  เวลาเริ่มต้น {p.defaultStart}–{p.defaultEnd}
                </p>
                <p className="mt-4 text-[15px]">
                  <span className="display tnum text-2xl font-semibold">{p.memberCount}</span> <span className="text-text-dim">คน</span>
                </p>
              </Link>
            ))}
          </div>
        ))}
      {adding && (
        <ProjectDialog
          title="สร้างโปรเจก"
          onClose={() => setAdding(false)}
          onSave={async (v) => {
            await api.createProject(v)
            setAdding(false)
            load()
          }}
        />
      )}
    </>
  )
}

export function ProjectDialog({
  title,
  initial = { name: '', defaultStart: '09:00', defaultEnd: '18:00' },
  onClose,
  onSave,
}: {
  title: string
  initial?: Omit<Project, 'id'>
  onClose: () => void
  onSave: (v: Omit<Project, 'id'>) => Promise<void>
}) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!v.name.trim()) return setError('กรอกชื่อโปรเจก')
    if (!v.defaultStart || !v.defaultEnd || v.defaultEnd <= v.defaultStart) return setError('เวลาเลิกต้องอยู่หลังเวลาเริ่ม')
    setBusy(true)
    try {
      await onSave({ ...v, name: v.name.trim() })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
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
      <div className="space-y-4">
        <Field label="ชื่อโปรเจก" hint="ต้องตรงกับชื่อในคอลัมน์ โปรเจก ของไฟล์ Excel">
          {(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus placeholder="เช่น LU-Phuket" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เวลาเริ่มต้น">{(id) => <Input id={id} type="time" value={v.defaultStart} onChange={(e) => setV({ ...v, defaultStart: e.target.value })} />}</Field>
          <Field label="เวลาเลิก">{(id) => <Input id={id} type="time" value={v.defaultEnd} onChange={(e) => setV({ ...v, defaultEnd: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  )
}
