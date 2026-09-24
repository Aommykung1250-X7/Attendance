// โครงสร้างข้อมูลตาม spec หัวข้อ 6
//
// วันที่เก็บเป็นข้อความ 'YYYY-MM-DD' และเวลาในกะเก็บเป็น 'HH:MM' ตามเวลาไทย
// เพื่อไม่ให้เกิดปัญหา timezone ตอนแปลงไปมา
// ส่วน timestamp จริง (เวลาสแกน) เก็บเป็น timestamptz ซึ่งคือ UTC ในฐานข้อมูล
//
// แก้ไฟล์นี้แล้วให้รัน `pnpm db:generate` เพื่อสร้างไฟล์ migration ใหม่ใน ./drizzle

import { createId } from '../lib/id.js'
import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId())
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const employeeType = pgEnum('employee_type', ['staff', 'student'])
export const overrideStatus = pgEnum('override_status', ['leave', 'present', 'late', 'absent', 'offsite'])
export const offsiteRequestStatus = pgEnum('offsite_request_status', ['pending', 'approved', 'rejected', 'cancelled'])
export const leaveRequestStatus = pgEnum('leave_request_status', ['pending', 'approved', 'rejected', 'cancelled'])
export const leaveDuration = pgEnum('leave_duration', ['full_day', 'morning', 'afternoon'])
export const leaveType = pgEnum('leave_type', ['sick', 'personal'])

export const employees = pgTable('employees', {
  id: id(),
  nickname: text('nickname').notNull(),
  /** แยกจากชื่อเสมอ ว่างได้สำหรับพนักงานประจำ */
  gen: text('gen'),
  /** บัญชี Google เก็บเป็นตัวพิมพ์เล็กเสมอ null = ยังไม่ได้กรอก (คนนี้เช็กชื่อเองไม่ได้) */
  email: text('email').unique(),
  type: employeeType('type').notNull(),
  position: text('position').notNull().default(''),
  /** ลบแบบซ่อน (spec 9.3) */
  isActive: boolean('is_active').notNull().default(true),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(),
})

export const projects = pgTable('projects', {
  id: id(),
  name: text('name').notNull().unique(),
  /** ใช้เป็นค่ากรอกล่วงหน้าในฟอร์มเท่านั้น ไม่ถูกใช้ตอนคำนวณ */
  defaultStart: text('default_start').notNull(),
  defaultEnd: text('default_end').notNull(),
  createdAt: createdAt(),
})

/**
 * หนึ่งแถว = คนนี้ โปรเจกนี้ วันนี้ของสัปดาห์ เวลานี้
 * ห้ามมี unique ที่ (employee_id, weekday) เพราะคนที่มาสองรอบต่อวันมีสองแถว
 *
 * valid_from / valid_to ไม่อยู่ใน spec แต่จำเป็น: ถ้าเปลี่ยนตารางเทอมใหม่แล้วลบแถวเก่าทิ้ง
 * รายงานของเดือนที่ผ่านมาจะถูกคำนวณด้วยตารางใหม่และเปลี่ยนย้อนหลัง
 */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    /** 1 = จันทร์ ... 7 = อาทิตย์ */
    weekday: smallint('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** ใช้ได้ตั้งแต่วันนี้ (รวม) */
    validFrom: text('valid_from').notNull(),
    /** ใช้ไม่ได้ตั้งแต่วันนี้ (ไม่รวม) null = ยังใช้อยู่ */
    validTo: text('valid_to'),
    createdAt: createdAt(),
  },
  (t) => [index('shifts_employee_weekday_idx').on(t.employeeId, t.weekday), index('shifts_weekday_idx').on(t.weekday)],
)

export const attendance = pgTable(
  'attendance',
  {
    id: id(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    /** เวลาที่สแกน QR ไม่ใช่เวลาที่ล็อกอินเสร็จ */
    scannedAt: timestamp('scanned_at', { withTimezone: true, mode: 'date' }).notNull(),
    earlyLeaveAt: timestamp('early_leave_at', { withTimezone: true, mode: 'date' }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true, mode: 'date' }),
    checkinLatitude: doublePrecision('checkin_latitude'),
    checkinLongitude: doublePrecision('checkin_longitude'),
    checkinAccuracyMeters: doublePrecision('checkin_accuracy_meters'),
    checkinDistanceMeters: doublePrecision('checkin_distance_meters'),
    /** ทำงานนอกสถานที่หรือไม่ */
    isOffsite: boolean('is_offsite').notNull().default(false),
    /** 'self' หรืออีเมลของแอดมินที่กดแทน */
    recordedBy: text('recorded_by').notNull(),
    /** 'self' หรืออีเมลของแอดมินที่กดแจ้งกลับก่อนแทน */
    earlyLeaveBy: text('early_leave_by'),
    /** 'self' หรืออีเมลของแอดมินที่กดออกงานแทน */
    checkedOutBy: text('checked_out_by'),
    createdAt: createdAt(),
  },
  (t) => [
    // กันการบันทึกซ้ำจากการกดสองครั้ง
    unique('attendance_shift_date_uq').on(t.shiftId, t.date),
    index('attendance_employee_date_idx').on(t.employeeId, t.date),
    index('attendance_date_idx').on(t.date),
  ],
)

/**
 * บันทึกแบบต่อท้ายอย่างเดียว แถวล่าสุดของ (shift, date) คือค่าที่มีผล
 * status = null หมายถึงแอดมินล้างค่าที่แก้ไว้ กลับไปใช้ค่าที่คำนวณได้
 */
export const statusOverrides = pgTable(
  'status_overrides',
  {
    id: id(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    status: overrideStatus('status'),
    previousStatus: text('previous_status').notNull(),
    adminEmail: text('admin_email').notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('status_overrides_shift_date_idx').on(t.shiftId, t.date, t.createdAt),
    index('status_overrides_employee_date_idx').on(t.employeeId, t.date),
  ],
)

export const holidays = pgTable('holidays', {
  date: text('date').primaryKey(),
  name: text('name').notNull(),
})

/** มีแถวเดียว id = 1 */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  /** รหัสสุ่มต่อท้าย URL หน้าจอในออฟฟิศ */
  displayKey: text('display_key').notNull(),
  /** อายุของ QR token (วินาที) */
  qrTokenTtl: integer('qr_token_ttl').notNull(),
  /** ลิงก์ LINE OA สำหรับส่งรีเฟล็กซ์รายวัน */
  lineOaUrl: text('line_oa_url'),
  lateGraceMinutes: integer('late_grace_minutes').notNull().default(0),
  /** after_shift_5m = หลังจบกะ 5 นาที, end_of_day = 23:59 ของวัน */
  autoCheckoutMode: text('auto_checkout_mode').notNull().default('after_shift_5m'),
  officeLatitude: doublePrecision('office_latitude').notNull().default(18.800523577253724),
  officeLongitude: doublePrecision('office_longitude').notNull().default(98.95073601100776),
  checkinRadiusMeters: integer('checkin_radius_meters').notNull().default(200),
  maxLocationAccuracyMeters: integer('max_location_accuracy_meters').notNull().default(100),
})

/** session ฝั่งเซิร์ฟเวอร์ cookie เก็บแค่รหัสสุ่ม ส่วน id ในตารางคือ sha256 ของรหัสนั้น */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    /** 'auth' | 'scan' | 'oauth' | 'import' */
    kind: text('kind').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
)

/** ร่องรอยการกดของแอดมินทุกครั้ง (spec 9.6) */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    adminEmail: text('admin_email').notNull(),
    action: text('action').notNull(),
    employeeId: text('employee_id'),
    shiftId: text('shift_id'),
    date: text('date'),
    before: jsonb('before'),
    after: jsonb('after'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('audit_shift_date_idx').on(t.shiftId, t.date), index('audit_created_idx').on(t.createdAt)],
)

/** คำขอทำงานนอกสถานที่ */
export const offsiteRequests = pgTable(
  'offsite_requests',
  {
    id: id(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    taskDescription: text('task_description').notNull(),
    photoPath: text('photo_path').notNull(),
    locationName: text('location_name'),
    status: offsiteRequestStatus('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    rejectReason: text('reject_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('offsite_requests_employee_date_idx').on(t.employeeId, t.date),
    index('offsite_requests_status_date_idx').on(t.status, t.date),
  ],
)

/** คำขอลา 1 รายการ อาจครอบคลุมหลายวัน */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    duration: leaveDuration('duration').notNull(),
    leaveType: leaveType('leave_type'),
    reason: text('reason').notNull(),
    medicalCertificatePath: text('medical_certificate_path'),
    medicalCertificatePending: boolean('medical_certificate_pending').notNull().default(false),
    medicalCertificateReceivedAt: timestamp('medical_certificate_received_at', { withTimezone: true, mode: 'date' }),
    status: leaveRequestStatus('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    rejectReason: text('reject_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('leave_requests_employee_dates_idx').on(t.employeeId, t.startDate, t.endDate),
    index('leave_requests_status_dates_idx').on(t.status, t.startDate, t.endDate),
  ],
)

/** วันที่และกะที่ใบลามีผลจริง (ไม่รวมวันหยุด/วันที่ไม่มีกะ) */
export const leaveRequestDays = pgTable(
  'leave_request_days',
  {
    id: id(),
    leaveRequestId: text('leave_request_id')
      .notNull()
      .references(() => leaveRequests.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    portion: leaveDuration('portion').notNull(),
  },
  (t) => [
    unique('leave_request_days_request_shift_date_uq').on(t.leaveRequestId, t.shiftId, t.date),
    index('leave_request_days_shift_date_idx').on(t.shiftId, t.date),
    index('leave_request_days_employee_date_idx').on(t.employeeId, t.date),
  ],
)

export type EmployeeRow = typeof employees.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type ShiftRow = typeof shifts.$inferSelect
export type AttendanceRow = typeof attendance.$inferSelect
export type OverrideRow = typeof statusOverrides.$inferSelect
export type OffsiteRequestRow = typeof offsiteRequests.$inferSelect
export type LeaveRequestRow = typeof leaveRequests.$inferSelect
