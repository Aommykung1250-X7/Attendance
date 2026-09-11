// นำเข้าตารางจาก Excel พร้อมหน้าสรุปก่อนยืนยัน (spec หัวข้อ 10)

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { ImportPreview } from '../../lib/types'
import { Button, Card, ErrorNote, PageHeader, cx } from '../../components/ui'

type Stage = { kind: 'idle' } | { kind: 'checking'; name: string } | { kind: 'preview'; name: string; p: ImportPreview } | { kind: 'done'; applied: number }

export default function ImportExcel() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setStage({ kind: 'checking', name: file.name })
    try {
      const p = await api.importPreview(file)
      setStage({ kind: 'preview', name: file.name, p })
    } catch (e) {
      setError((e as Error).message)
      setStage({ kind: 'idle' })
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const commit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.importCommit()
      setStage({ kind: 'done', applied: r.applied })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    await api.importCancel().catch(() => {})
    setStage({ kind: 'idle' })
  }

  return (
    <>
      <PageHeader
        title="นำเข้าตารางจาก Excel"
        sub="ใช้ตอนเริ่มเทอมใหม่หรือเพิ่มนักศึกษารุ่นใหม่ ระบบจะแสดงสรุปให้ตรวจก่อนบันทึกจริงเสมอ"
        actions={
          <a href={api.templateUrl} download className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 text-[15px] font-medium hover:bg-sunken">
            ดาวน์โหลดไฟล์ตัวอย่าง
          </a>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorNote message={error} />
        </div>
      )}

      {(stage.kind === 'idle' || stage.kind === 'checking') && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              upload(e.dataTransfer.files[0])
            }}
            className={cx(
              'flex min-h-60 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              drag ? 'border-ink bg-sunken' : 'border-rule-strong bg-surface hover:bg-sunken/50',
            )}
          >
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} disabled={stage.kind === 'checking'} />
            {stage.kind === 'checking' ? (
              <>
                <p className="display text-xl font-semibold">กำลังตรวจ {stage.name}</p>
                <p className="mt-1 text-[15px] text-text-dim">ตรวจทุกแถวก่อน แล้วรายงานทีเดียว</p>
              </>
            ) : (
              <>
                <p className="display text-xl font-semibold">ลากไฟล์ .xlsx มาวาง หรือกดเพื่อเลือกไฟล์</p>
                <p className="mt-1 text-[15px] text-text-dim">ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดยืนยันในหน้าถัดไป</p>
              </>
            )}
          </label>
          <Card className="p-5 text-[15px] leading-relaxed">
            <h2 className="font-medium">กฎของไฟล์</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-text-dim">
              <li>หัวตารางอยู่แถวแรก หนึ่งแถว = หนึ่งคนต่อหนึ่งโปรเจก</li>
              <li>ติ๊กวันในคอลัมน์ จ ถึง อา เวลาใช้รูปแบบ 09:30</li>
              <li>คนที่มาสองรอบใช้ช่องรอบ 2</li>
              <li>แถวในไฟล์จะแทนที่กะเดิมของคนนั้นในโปรเจกนั้นทั้งหมด</li>
              <li>คนที่ไม่อยู่ในไฟล์จะไม่ถูกแตะต้อง การนำเข้าไม่ลบใคร</li>
              <li>ช่องอีเมลเว้นว่างได้ ระบบจะจับคู่คนนั้นด้วยชื่อเล่น + Gen แต่เจ้าตัวจะเช็กชื่อเองไม่ได้จนกว่าจะกรอกอีเมล</li>
              <li>ถ้ามีปัญหาแม้แถวเดียว จะไม่บันทึกอะไรเลย</li>
            </ul>
          </Card>
        </div>
      )}

      {stage.kind === 'preview' && !stage.p.ok && <Problems p={stage.p} name={stage.name} onRetry={() => setStage({ kind: 'idle' })} />}
      {stage.kind === 'preview' && stage.p.ok && <Summary p={stage.p} name={stage.name} busy={busy} onConfirm={commit} onCancel={reset} />}

      {stage.kind === 'done' && (
        <Card className="p-8 text-center">
          <p className="display animate-stamp text-2xl font-semibold text-ontime">นำเข้าเรียบร้อย {stage.applied} แถว</p>
          <p className="mt-2 text-[15px] text-text-dim">ตารางใหม่มีผลตั้งแต่วันนี้ ประวัติของวันก่อนหน้าไม่เปลี่ยน</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/admin/employees" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 font-medium text-chalk">
              ดูรายชื่อพนักงาน
            </Link>
            <Button onClick={() => setStage({ kind: 'idle' })}>นำเข้าไฟล์อื่น</Button>
          </div>
        </Card>
      )}
    </>
  )
}

function Problems({ p, name, onRetry }: { p: ImportPreview; name: string; onRetry: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <p className="display text-xl font-semibold text-absent">พบปัญหา {p.problems.length} จุด ยังไม่ได้บันทึกอะไร</p>
          <p className="text-[15px] text-text-dim">แก้ใน {name} ให้ครบทุกจุดแล้วอัปโหลดใหม่</p>
        </div>
        <Button variant="primary" onClick={onRetry}>
          อัปโหลดไฟล์ที่แก้แล้ว
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[15px]">
          <thead className="bg-sunken/60 text-[13px] text-text-dim">
            <tr>
              <th className="w-16 px-5 py-2.5 font-medium">แถว</th>
              <th className="px-3 py-2.5 font-medium">คอลัมน์</th>
              <th className="px-3 py-2.5 font-medium">ผิดอะไร</th>
              <th className="px-3 py-2.5 font-medium">ต้องแก้เป็น</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {p.problems.map((x, i) => (
              <tr key={i} className="align-top">
                <td className="tnum px-5 py-3 font-semibold">{x.row}</td>
                <td className="px-3 py-3 whitespace-nowrap">{x.column}</td>
                <td className="px-3 py-3">{x.message}</td>
                <td className="px-3 py-3 text-ontime">{x.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Summary({ p, name, busy, onConfirm, onCancel }: { p: ImportPreview; name: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const nothing = p.newEmployees.length === 0 && p.newAssignments.length === 0 && p.changedShifts.length === 0
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <p className="display text-xl font-semibold">{nothing ? 'ไฟล์นี้ตรงกับข้อมูลในระบบแล้ว' : 'ตรวจก่อนยืนยัน'}</p>
        <p className="mt-1 text-[15px] text-text-dim">
          {name} ผ่านการตรวจทุกแถว{p.unchangedCount ? ` · ${p.unchangedCount} แถวไม่มีอะไรเปลี่ยน` : ''}
        </p>
        <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-rule bg-rule text-center">
          {[
            ['คนใหม่', p.newEmployees.length],
            ['คนเดิมได้โปรเจกเพิ่ม', p.newAssignments.length],
            ['คนเดิมเวลาเปลี่ยน', p.changedShifts.length],
          ].map(([l, n]) => (
            <div key={l as string} className="bg-surface px-3 py-4">
              <p className="display tnum text-3xl font-semibold">{n}</p>
              <p className="mt-1 text-[13px] text-text-dim">{l}</p>
            </div>
          ))}
        </div>
      </Card>

      {p.newEmployees.length > 0 && (
        <Section title={`จะสร้างคนใหม่ ${p.newEmployees.length} คน`} hint="ตรวจอีเมลอีกครั้ง ต้องเป็นบัญชีที่ล็อกอิน Google ได้ คนที่ยังไม่มีอีเมลจะเช็กชื่อเองไม่ได้จนกว่าจะกรอกในหน้าพนักงาน">
          {p.newEmployees.map((e, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-x-6 px-5 py-3">
              <span className="font-medium">{e.nickname}</span>
              <span className="text-sm text-text-dim">
                <span className={cx(!e.email && 'text-late')}>{e.email ?? 'ยังไม่มีอีเมล'}</span> · {e.projectName}
              </span>
            </li>
          ))}
        </Section>
      )}
      {p.newAssignments.length > 0 && (
        <Section title={`คนเดิมที่จะได้โปรเจกเพิ่ม ${p.newAssignments.length} คน`}>
          {p.newAssignments.map((e, i) => (
            <li key={i} className="flex justify-between gap-6 px-5 py-3">
              <span className="font-medium">{e.nickname}</span>
              <span className="text-sm text-text-dim">+ {e.projectName}</span>
            </li>
          ))}
        </Section>
      )}
      {p.changedShifts.length > 0 && (
        <Section title={`คนเดิมที่เวลาจะเปลี่ยน ${p.changedShifts.length} รายการ`} hint="การแก้ที่เคยทำในเว็บจะถูกแทนที่ด้วยค่าจากไฟล์ ตรวจให้แน่ใจ">
          {p.changedShifts.map((c, i) => (
            <li key={i} className="grid gap-1 px-5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
              <span>
                <span className="font-medium">{c.nickname}</span>
                <span className="block text-sm text-text-dim">{c.projectName}</span>
              </span>
              <span className="tnum text-sm leading-relaxed">
                <span className="text-text-dim line-through decoration-rule-strong">{c.before}</span>
                <span className="mx-2 text-text-dim">→</span>
                <span className="font-medium">{c.after}</span>
              </span>
            </li>
          ))}
        </Section>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-rule bg-paper/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy || nothing}>
          {busy ? 'กำลังบันทึก' : 'ยืนยันนำเข้า'}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-rule px-5 py-3">
        <h2 className="font-medium">{title}</h2>
        {hint && <p className="text-sm text-text-dim">{hint}</p>}
      </div>
      <ul className="divide-y divide-rule">{children}</ul>
    </Card>
  )
}
