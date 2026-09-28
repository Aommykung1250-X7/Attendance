// การเขียนตารางกะ (spec หัวข้อ 5)
//
// ตารางกะมีสามทางเขียน (นำเข้า Excel / เพิ่มคนเข้าโปรเจก / แก้รายคน) และทั้งหมดใช้ฟังก์ชันในไฟล์นี้
// หน่วยของการเขียนคือ "คนหนึ่งคน + โปรเจกหนึ่งโปรเจก" เขียนทีไรแทนที่กะเดิมของคู่นั้นทั้งหมด
//
// ใครเขียนทีหลังชนะ: ถ้ากะใหม่ทับเวลากับกะของโปรเจกอื่นของคนเดียวกันในวันเดียวกัน กะเก่าจะถูกเอาออก
// จึงไม่มีทางที่คนหนึ่งจะมีสองกะซ้อนกัน และไม่ต้องคำนวณลำดับความสำคัญตอนแสดงผล
//
// กะที่ถูกเอาออกจะไม่ถูกลบจริงถ้ามีประวัติการเช็กชื่อ แต่จะตั้ง valid_to เพื่อให้รายงานย้อนหลังไม่เปลี่ยน

import { and, inArray, isNull, sql } from 'drizzle-orm'
import type { ShiftEntry } from '../contract.js'
import { schema, type Tx } from '../db/index.js'
import type { ShiftRow } from '../db/schema.js'
import { addDays, isHHMM, minutesOf, WEEKDAY_SHORT, weekdayOf } from './time.js'

export interface PlanShift {
  id?: string
  employeeId: string
  projectId: string
  weekday: number
  startTime: string
  endTime: string
}

export function overlaps(a: Omit<ShiftEntry, never>, b: Omit<ShiftEntry, never>): boolean {
  return (
    a.weekday === b.weekday &&
    minutesOf(a.startTime) < minutesOf(b.endTime) &&
    minutesOf(b.startTime) < minutesOf(a.endTime)
  )
}

const sameSlot = (a: ShiftEntry, b: ShiftEntry) =>
  a.weekday === b.weekday && a.startTime === b.startTime && a.endTime === b.endTime

/** ตรวจกะที่จะเขียน คืนรายการข้อความผิดพลาด (ว่าง = ผ่าน) */
export function validateEntries(entries: ShiftEntry[]): string[] {
  const errors: string[] = []
  entries.forEach((e, i) => {
    const label = `แถวที่ ${i + 1}`
    if (!Number.isInteger(e.weekday) || e.weekday < 1 || e.weekday > 7) errors.push(`${label}: วันไม่ถูกต้อง`)
    if (!isHHMM(e.startTime) || !isHHMM(e.endTime)) {
      errors.push(`${label}: เวลาต้องอยู่ในรูป HH:MM เช่น 09:30`)
      return
    }
    if (minutesOf(e.endTime) <= minutesOf(e.startTime)) errors.push(`${label}: เวลาออกต้องอยู่หลังเวลาเข้า`)
  })
  if (errors.length) return errors
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++)
      if (overlaps(entries[i], entries[j]))
        errors.push(
          `วัน${WEEKDAY_SHORT[entries[i].weekday]} ${entries[i].startTime}–${entries[i].endTime} ทับกับ ${entries[j].startTime}–${entries[j].endTime}`,
        )
  return errors
}

/**
 * วางแผนการเขียนกะของคู่ (employee, project) บนตารางปัจจุบัน
 * ฟังก์ชันล้วน ใช้ทั้งตอนแสดงหน้าสรุปก่อนยืนยันและตอนบันทึกจริง ผลจึงตรงกันเสมอ
 */
export function applyAssignment(current: PlanShift[], employeeId: string, projectId: string, entries: ShiftEntry[]) {
  const others = current.filter((s) => s.employeeId !== employeeId)
  const mine = current.filter((s) => s.employeeId === employeeId)
  const samePair = mine.filter((s) => s.projectId === projectId)
  const otherProjects = mine.filter((s) => s.projectId !== projectId)
  const replaced = otherProjects.filter((s) => entries.some((e) => overlaps(s, e)))
  const keptOther = otherProjects.filter((s) => !replaced.includes(s))
  const newPair: PlanShift[] = entries.map(
    (e) => samePair.find((s) => sameSlot(s, e)) ?? { employeeId, projectId, weekday: e.weekday, startTime: e.startTime, endTime: e.endTime },
  )
  return { next: [...others, ...keptOther, ...newPair], replaced }
}

/** ตารางปัจจุบัน = กะที่ยังไม่มีวันสิ้นสุด */
export async function loadCurrentShifts(tx: Tx, employeeIds?: string[]): Promise<ShiftRow[]> {
  if (employeeIds && employeeIds.length === 0) return []
  return tx
    .select()
    .from(schema.shifts)
    .where(and(isNull(schema.shifts.validTo), employeeIds ? inArray(schema.shifts.employeeId, employeeIds) : undefined))
}

/**
 * บันทึกผลจากแผนลงฐานข้อมูล
 * - กะที่หายไปจากแผน: ลบจริงถ้ายังไม่เคยถูกใช้ ไม่งั้นปิดด้วย valid_to
 *   ถ้าวันนี้มีการเช็กชื่อในกะนั้นแล้ว ให้กะเดิมอยู่ถึงสิ้นวันนี้ (valid_to = พรุ่งนี้)
 * - กะใหม่: ใช้ได้ตั้งแต่วันนี้ ยกเว้นเป็นวันเดียวกับกะของพนักงานที่ถูกใช้งานแล้ววันนี้ ให้เริ่มพรุ่งนี้
 */
export async function reconcile(tx: Tx, before: PlanShift[], after: PlanShift[], today: string) {
  const keepIds = new Set(after.filter((s) => s.id).map((s) => s.id!))
  const removed = before.filter((s) => s.id && !keepIds.has(s.id))
  const added = after.filter((s) => !s.id)
  const tomorrow = addDays(today, 1)
  const keptToday: PlanShift[] = []
  let deferredBecauseTodayUsed = false

  if (removed.length) {
    const ids = removed.map((s) => s.id!)
    const used = await tx.execute<{ shift_id: string; today: boolean }>(sql`
      select shift_id, bool_or(date = ${today}) as today from (
        select shift_id, date from ${schema.attendance} where shift_id in ${ids}
        union all
        select shift_id, date from ${schema.statusOverrides} where shift_id in ${ids}
      ) x group by shift_id`)
    const usage = new Map(used.rows.map((r) => [r.shift_id, r.today]))
    const del: string[] = []
    const closeToday: string[] = []
    const closeTomorrow: string[] = []
    for (const s of removed) {
      if (!usage.has(s.id!)) del.push(s.id!)
      else if (usage.get(s.id!)) {
        closeTomorrow.push(s.id!)
        keptToday.push(s)
      } else closeToday.push(s.id!)
    }
    if (del.length) await tx.delete(schema.shifts).where(inArray(schema.shifts.id, del))
    // กะที่เริ่มในอนาคตแล้วถูกปิดวันนี้ ให้ valid_to ไม่น้อยกว่า valid_from
    if (closeToday.length)
      await tx
        .update(schema.shifts)
        .set({ validTo: sql`greatest(${schema.shifts.validFrom}, ${today})` })
        .where(inArray(schema.shifts.id, closeToday))
    if (closeTomorrow.length)
      await tx.update(schema.shifts).set({ validTo: tomorrow }).where(inArray(schema.shifts.id, closeTomorrow))
    deferredBecauseTodayUsed = closeTomorrow.length > 0
  }

  const todayWd = weekdayOf(today)
  if (added.length) {
    await tx.insert(schema.shifts).values(
      added.map((s) => ({
        employeeId: s.employeeId,
        projectId: s.projectId,
        weekday: s.weekday,
        startTime: s.startTime,
        endTime: s.endTime,
        validFrom:
          s.weekday === todayWd && keptToday.some((k) => k.employeeId === s.employeeId) ? tomorrow : today,
      })),
    )
  }
  return {
    removed: removed.length,
    added: added.length,
    effectiveFrom: deferredBecauseTodayUsed ? tomorrow : today,
    deferredBecauseTodayUsed,
  }
}

/** เอากะทั้งหมดของคนนี้ออกจากตารางปัจจุบัน (ใช้ตอนซ่อนพนักงาน) */
export async function retireAllShifts(tx: Tx, employeeId: string, today: string) {
  const current = await loadCurrentShifts(tx, [employeeId])
  return reconcile(tx, current, [], today)
}

// ---------------------------------------------------------------------------
// ข้อความสรุปตารางสำหรับคนอ่าน เช่น "จ–ศ 09:00–18:00" หรือ "จ, พ 09:30–12:00 + 17:00–20:00"
// ---------------------------------------------------------------------------

function weekdayRange(days: number[]): string {
  const parts: string[] = []
  let i = 0
  while (i < days.length) {
    let j = i
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++
    if (j - i >= 2) parts.push(`${WEEKDAY_SHORT[days[i]]}–${WEEKDAY_SHORT[days[j]]}`)
    else for (let k = i; k <= j; k++) parts.push(WEEKDAY_SHORT[days[k]])
    i = j + 1
  }
  return parts.join(', ')
}

export function describeSchedule(list: ShiftEntry[]): string {
  if (list.length === 0) return 'ไม่มีกะ'
  const perDay = new Map<number, string>()
  for (let d = 1; d <= 7; d++) {
    const ranges = list
      .filter((s) => s.weekday === d)
      .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime))
      .map((s) => `${s.startTime}–${s.endTime}`)
    if (ranges.length) perDay.set(d, ranges.join(' + '))
  }
  const groups = new Map<string, number[]>()
  for (const [d, r] of perDay) groups.set(r, [...(groups.get(r) ?? []), d])
  return [...groups.entries()].map(([r, days]) => `${weekdayRange(days)} ${r}`).join(' / ')
}
