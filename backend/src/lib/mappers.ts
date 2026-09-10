import type { Employee, Project, Shift } from '../contract.js'
import type { EmployeeRow, ProjectRow, ShiftRow } from '../db/schema.js'

export function toEmployee(e: EmployeeRow): Employee {
  return {
    id: e.id,
    nickname: e.nickname,
    gen: e.gen,
    email: e.email,
    type: e.type,
    position: e.position,
    isActive: e.isActive,
  }
}

export function toProject(p: ProjectRow): Project {
  return { id: p.id, name: p.name, defaultStart: p.defaultStart, defaultEnd: p.defaultEnd }
}

export function toShift(s: ShiftRow): Shift {
  return {
    id: s.id,
    employeeId: s.employeeId,
    projectId: s.projectId,
    weekday: s.weekday,
    startTime: s.startTime,
    endTime: s.endTime,
  }
}

/** ชื่อที่แสดง ต้องมี Gen กำกับเพราะชื่อเล่นซ้ำกันได้ */
export function displayName(e: { nickname: string; gen: string | null }): string {
  return e.gen ? `${e.nickname} (${e.gen})` : e.nickname
}
