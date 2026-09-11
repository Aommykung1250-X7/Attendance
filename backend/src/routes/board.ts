// จอในออฟฟิศ (spec 9.1) — ไม่ต้องล็อกอิน ใช้ URL ที่มีรหัสสุ่มยาวต่อท้าย

import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import type { DayLogRow, KioskBoard } from '../contract.js'
import { loadDay, summarize } from '../lib/day.js'
import { issueQrToken } from '../lib/qr.js'
import { getSettings } from '../lib/settings.js'
import { localParts, minutesOf, thaiDateLabel } from '../lib/time.js'

function sameKey(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const ORDER: Record<string, number> = { ontime: 0, late: 0, pending: 1, leave: 2, absent: 3 }

/**
 * แสดงเฉพาะกะที่กำลังดำเนินอยู่และกะถัดไป เพราะถ้าแสดงทุกคนทุกกะพร้อมกันจะล้นจอ
 */
export function boardGroups(rows: DayLogRow[], nowTime: string): KioskBoard['groups'] {
  const [h, m, s] = nowTime.split(':').map(Number)
  const now = h * 3600 + m * 60 + s
  const byStart = new Map<string, DayLogRow[]>()
  for (const r of rows) byStart.set(r.startTime, [...(byStart.get(r.startTime) ?? []), r])

  const starts = [...byStart.keys()].sort((a, b) => minutesOf(a) - minutesOf(b))
  const ongoing = starts.filter(
    (st) => minutesOf(st) * 60 <= now && byStart.get(st)!.some((r) => minutesOf(r.endTime) * 60 > now),
  )
  const next = starts.find((st) => minutesOf(st) * 60 > now)

  const sortRows = (list: DayLogRow[]) =>
    [...list].sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        (a.scannedAt ?? '').localeCompare(b.scannedAt ?? '') ||
        a.nickname.localeCompare(b.nickname, 'th'),
    )
  const strip = ({ overridden: _o, historyCount: _h, ...r }: DayLogRow) => r

  const groups: KioskBoard['groups'] = ongoing.map((st) => ({
    startTime: st,
    label: `เข้า ${st}`,
    rows: sortRows(byStart.get(st)!.filter((r) => minutesOf(r.endTime) * 60 > now)).map(strip),
  }))
  if (next) groups.push({ startTime: next, label: `ถัดไป ${next}`, rows: sortRows(byStart.get(next)!).map(strip) })
  return groups
}

export async function boardRoutes(app: FastifyInstance) {
  app.get('/api/board/:displayKey', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    const { displayKey } = req.params as { displayKey: string }
    const s = await getSettings()
    if (!sameKey(displayKey, s.displayKey)) return reply.code(404).send({ error: 'not_found', message: 'ไม่พบหน้าจอนี้' })

    const now = new Date()
    const { date, time } = localParts(now)
    const { holiday, records } = await loadDay(date, { now })
    const rows = records.map((r) => r.row)
    const qr = issueQrToken(config.sessionSecret, s.displayKey, s.qrTokenTtl, now.getTime())

    const board: KioskBoard = {
      serverTime: now.toISOString(),
      dateLabel: holiday ? `${thaiDateLabel(date)} · ${holiday}` : thaiDateLabel(date),
      qrToken: qr.token,
      tokenExpiresIn: s.qrTokenTtl,
      summary: summarize(rows),
      groups: boardGroups(rows, time),
      today: rows.map(({ overridden: _o, historyCount: _h, ...r }) => r),
    }
    return board
  })
}
