// ตั้งค่า: ลิงก์หน้าจอในออฟฟิศ อายุ QR และวันหยุด (spec 9.8)

import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { shortDate } from '../../lib/format'
import type { AppSettings, Holiday } from '../../lib/types'
import { Button, Card, ErrorNote, Field, Input, Loading, PageHeader } from '../../components/ui'
import { Toast, useNotify } from '../../components/notify'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [ttl, setTtl] = useState('30')
  const notify = useNotify()

  useEffect(() => {
    api
      .settings()
      .then((x) => {
        setS(x)
        setTtl(String(x.qrTokenTtl))
      })
      .catch((e) => setError(e.message))
  }, [])

  const copy = async () => {
    if (!s) return
    try {
      await navigator.clipboard.writeText(s.displayUrl)
      setToast('คัดลอกลิงก์แล้ว')
    } catch {
      notify.toast('คัดลอกไม่ได้', { tone: 'error', detail: 'เบราว์เซอร์ไม่อนุญาต ให้เลือกข้อความในกล่องด้านบนแล้วคัดลอกเอง' })
    }
  }

  const rotate = async () => {
    let next: AppSettings | undefined
    const ok = await notify.confirm({
      title: 'สร้างลิงก์หน้าจอใหม่?',
      body: 'ลิงก์เดิมจะใช้ไม่ได้ทันที จอในออฟฟิศจะขึ้นว่าลิงก์ใช้ไม่ได้จนกว่าจะเปิดลิงก์ใหม่ ใช้เมื่อสงสัยว่าลิงก์หลุดออกไปนอกออฟฟิศ',
      confirmLabel: 'สร้างลิงก์ใหม่',
      busyLabel: 'กำลังสร้าง',
      danger: true,
      action: async () => {
        next = await api.rotateDisplayKey()
      },
    })
    if (!ok || !next) return
    setS(next)
    notify.toast('สร้างลิงก์ใหม่แล้ว', { detail: 'อย่าลืมเปิดลิงก์ใหม่บนจอในออฟฟิศ' })
  }

  return (
    <>
      <PageHeader title="ตั้งค่า" />
      {error && <ErrorNote message={error} />}
      {!s && !error && <Loading />}
      {s && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="p-5">
            <h2 className="display text-lg font-semibold">หน้าจอในออฟฟิศ</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-text-dim">
              หน้าที่แสดง QR ให้พนักงานสแกน พร้อมนาฬิกาและรายชื่อของวันนี้ เปิดลิงก์นี้บนคอมหรือทีวีที่ต่อกับจอในออฟฟิศ
              แล้วกดปุ่ม "เต็มจอ" มุมขวาล่าง ไม่ต้องล็อกอิน คนนอกเดาลิงก์ไม่ได้เพราะมีรหัสสุ่มยาวต่อท้าย
            </p>
            <div className="mt-4 rounded-lg border border-rule bg-sunken px-3 py-2.5 font-mono text-[13px] break-all">{s.displayUrl}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={copy}>
                คัดลอก
              </Button>
              <a href={s.displayUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-on-brand hover:bg-brand-strong">
                เปิดหน้าจอ QR ↗
              </a>
              <Button size="sm" variant="danger" onClick={rotate}>
                สร้างลิงก์ใหม่
              </Button>
            </div>

            <div className="mt-6 border-t border-rule pt-5">
              <Field label="QR เปลี่ยนทุกกี่วินาที" hint="ค่าเริ่มต้น 30 วินาที ยิ่งสั้นยิ่งยากที่จะถ่ายรูป QR ส่งต่อให้คนที่ไม่ได้อยู่ในออฟฟิศ">
                {(id) => (
                  <div className="flex gap-2">
                    <Input id={id} type="number" min={10} max={300} value={ttl} onChange={(e) => setTtl(e.target.value)} className="w-28" />
                    <Button
                      onClick={async () => {
                        try {
                          setS(await api.updateSettings({ qrTokenTtl: Number(ttl) }))
                          setToast('บันทึกแล้ว')
                        } catch (e) {
                          setError((e as Error).message)
                        }
                      }}
                      disabled={String(s.qrTokenTtl) === ttl}
                    >
                      บันทึก
                    </Button>
                  </div>
                )}
              </Field>
            </div>
          </Card>

          <Holidays onToast={setToast} />
        </div>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}

function Holidays({ onToast }: { onToast: (m: string) => void }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [list, setList] = useState<Holiday[] | null>(null)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () => api.holidays(String(year)).then(setList).catch((e) => setError(e.message))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  const add = async () => {
    if (!date || !name.trim()) return setError('เลือกวันที่และใส่ชื่อวันหยุด')
    try {
      await api.addHoliday({ date, name: name.trim() })
      setDate('')
      setName('')
      setError(null)
      onToast('เพิ่มวันหยุดแล้ว')
      if (date.startsWith(String(year))) load()
      else setYear(Number(date.slice(0, 4)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="display text-lg font-semibold">วันหยุด</h2>
        <div className="flex items-center gap-1.5">
          <Button size="sm" aria-label="ปีก่อนหน้า" onClick={() => setYear(year - 1)}>
            ‹
          </Button>
          <span className="tnum w-14 text-center font-medium">{year + 543}</span>
          <Button size="sm" aria-label="ปีถัดไป" onClick={() => setYear(year + 1)}>
            ›
          </Button>
        </div>
      </div>
      <p className="mt-1 text-[15px] leading-relaxed text-text-dim">วันหยุดไม่นับการเช็กชื่อของใครเลย ต้องเพิ่มเอง ไม่งั้นวันสงกรานต์จะขึ้นว่าขาดทั้งออฟฟิศ</p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="วันที่" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อวันหยุด เช่น สงกรานต์" className="min-w-40 flex-1" aria-label="ชื่อวันหยุด" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button variant="primary" onClick={add}>
          เพิ่ม
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-absent">{error}</p>}

      {!list ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="mt-5 text-[15px] text-text-dim">ยังไม่มีวันหยุดในปี {year + 543}</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-t border-rule">
          {list.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-3 py-2.5">
              <span>
                <span className="tnum inline-block w-24 text-sm text-text-dim">{shortDate(h.date)}</span>
                {h.name}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.removeHoliday(h.date)
                  load()
                }}
              >
                ลบ
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
