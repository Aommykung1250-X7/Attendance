// จัดการพนักงาน (spec 9.3)

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { typeLabel } from '../../lib/format'
import type { Employee } from '../../lib/types'
import { EmployeeForm, emptyEmployee, employeeFormError, type EmployeeInput } from '../../components/EmployeeForm'
import { Button, Card, Checkbox, Dialog, Empty, ErrorNote, Input, Loading, PageHeader, cx } from '../../components/ui'

export default function Employees() {
  const [list, setList] = useState<Employee[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [type, setType] = useState<'all' | Employee['type']>('all')
  const [search, setSearch] = useState('')
  const [noEmailOnly, setNoEmailOnly] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = () => api.employees(showHidden).then(setList).catch((e) => setError(e.message))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (list ?? []).filter(
      (e) =>
        (type === 'all' || e.type === type) &&
        (!noEmailOnly || !e.email) &&
        (!q || `${e.nickname} ${e.gen ?? ''} ${e.email ?? ''} ${e.position}`.toLowerCase().includes(q)),
    )
  }, [list, type, search, noEmailOnly])

  const active = (list ?? []).filter((e) => e.isActive)
  const noEmail = active.filter((e) => !e.email).length
  return (
    <>
      <PageHeader
        title="พนักงาน"
        sub={
          list
            ? `${active.length} คน · ประจำ ${active.filter((e) => e.type === 'staff').length} · นักศึกษา ${active.filter((e) => e.type === 'student').length}${noEmail ? ` · ยังไม่มีอีเมล ${noEmail} คน` : ''}`
            : ' '
        }
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            + เพิ่มพนักงาน
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input placeholder="ค้นหาชื่อ อีเมล หรือ Gen" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-10 max-w-xs text-sm" />
        <div className="flex rounded-lg border border-rule-strong bg-surface p-0.5">
          {(['all', 'staff', 'student'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} aria-pressed={type === t} className={cx('min-h-9 rounded-md px-3 text-sm', type === t ? 'bg-ink text-chalk' : 'text-text-dim hover:text-text')}>
              {t === 'all' ? 'ทั้งหมด' : typeLabel(t)}
            </button>
          ))}
        </div>
        <Checkbox label="แสดงคนที่ถูกซ่อน" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="text-sm" />
        <Checkbox label="เฉพาะคนที่ยังไม่มีอีเมล" checked={noEmailOnly} onChange={(e) => setNoEmailOnly(e.target.checked)} className="text-sm" />
      </div>

      {error && <ErrorNote message={error} onRetry={load} />}
      {!list && !error && <Loading />}
      {list && (
        <Card className="overflow-hidden">
          {shown.length === 0 ? (
            <Empty title={list.length === 0 ? 'ยังไม่มีพนักงาน' : 'ไม่พบคนที่ค้นหา'} body={list.length === 0 ? 'เพิ่มทีละคน หรือนำเข้าทั้งหมดจากไฟล์ Excel' : undefined} action={list.length === 0 ? <Link to="/admin/import" className="text-[15px] font-medium underline underline-offset-4">ไปหน้านำเข้า Excel</Link> : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead className="border-b border-rule bg-sunken/60 text-[13px] text-text-dim">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">ชื่อเล่น</th>
                    <th className="px-4 py-2.5 font-medium">ประเภท</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">ตำแหน่ง</th>
                    <th className="px-4 py-2.5 font-medium">อีเมล Google</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {shown.map((e) => (
                    <tr key={e.id} className={cx('group', !e.isActive && 'text-text-dim')}>
                      <td className="px-4 py-3">
                        <Link to={`/admin/employees/${e.id}`} className="font-medium group-hover:underline underline-offset-4">
                          {e.nickname}
                        </Link>
                        {e.gen && <span className="ml-2 text-sm text-text-dim">{e.gen}</span>}
                        {!e.isActive && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-[12px]">ถูกซ่อน</span>}
                        {!e.email && (
                          <span className="ml-2 rounded bg-late-bg px-1.5 py-0.5 text-[12px] text-late" title="ยังไม่ได้กรอกอีเมล คนนี้สแกน QR เช็กชื่อเองไม่ได้">
                            ยังไม่มีอีเมล
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{typeLabel(e.type)}</td>
                      <td className="hidden px-4 py-3 text-sm text-text-dim md:table-cell">{e.position || '—'}</td>
                      <td className={cx('max-w-[16rem] truncate px-4 py-3 text-sm', e.email ? 'text-text-dim' : 'text-late')}>{e.email ?? 'ยังไม่มีอีเมล'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <AddEmployee open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function AddEmployee({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState<EmployeeInput>(emptyEmployee)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const save = async () => {
    const err = employeeFormError(v)
    if (err) return setError(err)
    setBusy(true)
    setError(null)
    try {
      const e = await api.createEmployee({ ...v, nickname: v.nickname.trim(), email: v.email.trim() || null, gen: v.gen?.trim() || null })
      setV(emptyEmployee)
      onClose()
      navigate(`/admin/employees/${e.id}?new=1`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="เพิ่มพนักงาน"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'กำลังบันทึก' : 'เพิ่ม แล้วไปกำหนดตารางกะ'}
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
