# Backend

Node 20+ · Fastify 5 · Drizzle ORM · PostgreSQL · google-auth-library · exceljs

วิธีติดตั้ง รัน และ deploy อยู่ใน `README.md` ที่โฟลเดอร์บนสุด ไฟล์นี้อธิบายโค้ด

## คำสั่ง

```bash
pnpm dev          # รันพร้อม reload อัตโนมัติ (อ่าน .env)
pnpm start        # รันแบบ production
pnpm test         # test ทั้งหมด (ต้องมี Postgres, database attendance_test)
pnpm typecheck
pnpm db:generate  # หลังแก้ src/db/schema.ts เพื่อสร้างไฟล์ migration ใหม่ใน ./drizzle
pnpm db:migrate   # รัน migration เอง (ปกติ server รันให้ตอนเริ่มอยู่แล้ว)
pnpm db:seed      # ข้อมูลตัวอย่าง อีเมลสมมติ (ห้ามรันบน production)
pnpm sync-types   # คัดลอก frontend/src/lib/types.ts มาเป็น src/contract.ts
```

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | บังคับ | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✓ | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | ✓ | สุ่มยาว ≥ 32 ตัว ใช้เซ็น QR token ด้วย เปลี่ยนแล้ว QR เดิมใช้ไม่ได้ |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✓ | จาก Google Auth Platform → Clients |
| `APP_ORIGIN` | ✓ | ที่อยู่เว็บ เช่น `https://attendance.example.com` ใช้ตรวจ Origin และสร้าง redirect URI |
| `ADMIN_EMAILS` | ✓ | อีเมลแอดมิน คั่นด้วย comma |
| `GOOGLE_REDIRECT_URI` | | ค่าเริ่มต้น `APP_ORIGIN/api/auth/google/callback` |
| `PORT` / `HOST` | | ค่าเริ่มต้น `5292` / `127.0.0.1` (ใน Docker เป็น `4802` / `0.0.0.0`) |
| `QR_TOKEN_TTL_SECONDS` | | ค่าเริ่มต้นตอนสร้างแถว settings ครั้งแรก (30) |
| `COOKIE_SECURE` | | ค่าเริ่มต้น `true` ปิดได้เฉพาะตอนพัฒนา production ห้ามปิด |
| `DEV_LOGIN` | | `true` เปิด `/api/auth/dev-login?email=` ทำงานเฉพาะเมื่อ `NODE_ENV` ไม่ใช่ production |

## โครงสร้างโค้ด

```
src/
├── server.ts            เริ่ม server: รัน migration → เปิดพอร์ต
├── app.ts               ประกอบ Fastify, ตรวจ Origin (กัน CSRF), จัดการ error
├── config.ts            อ่าน env ที่เดียว
├── contract.ts          รูป JSON ที่ส่งให้ frontend (สำเนาของ frontend/src/lib/types.ts)
├── db/schema.ts         ตาราง (spec หัวข้อ 6)
├── lib/
│   ├── time.ts          เวลาไทยทั้งหมด ไม่ขึ้นกับ TZ ของเครื่อง
│   ├── status.ts        กฎการคำนวณสถานะ (spec หัวข้อ 7)
│   ├── selection.ts     การเลือกกะตอนสแกน (spec หัวข้อ 8)
│   ├── qr.ts            QR token แบบ HMAC หมุนตามช่วงเวลา
│   ├── day.ts           ประกอบกะของวัน + คำนวณสถานะตอนอ่าน
│   ├── schedule.ts      การเขียนตารางกะ ใช้ร่วมกันทั้งสามทาง (Excel / เพิ่มเข้าโปรเจก / แก้รายคน)
│   └── sessions.ts      session ฝั่งเซิร์ฟเวอร์ + cookie
├── services/            checkin, day-admin, people, report, import, settings, audit
└── routes/              auth, checkin, board, admin
```

## API

รูป JSON ของทุก endpoint อยู่ใน `src/contract.ts` ข้อผิดพลาดตอบเป็น `{ error, message }` โดย `message` เป็นภาษาไทยที่แสดงให้ผู้ใช้ได้เลย

### ไม่ต้องล็อกอิน

```
GET  /api/health
GET  /api/board/:displayKey          → KioskBoard (รหัสผิด → 404)
GET  /api/auth/google?next=/path     → redirect ไป Google (&switch=1 = เปลี่ยนบัญชี)
GET  /api/auth/google/callback       → ตั้ง cookie แล้ว redirect กลับไปที่ next
POST /api/auth/logout
```

### เช็กชื่อ (ยังไม่ล็อกอิน → 401 พร้อม `loginUrl`)

```
GET  /api/checkin?token=...          → CheckInView
POST /api/checkin            {token} → CheckInView (kind: 'done')
POST /api/checkin/early-leave {token} → CheckInView (kind: 'early_leave_done')
GET  /api/me                         → Me
```

### แอดมิน (ต้องอยู่ใน ADMIN_EMAILS ไม่งั้น 403)

```
GET    /api/admin/day?date=YYYY-MM-DD         → DayLog
POST   /api/admin/attendance                  {shiftId, date, action, ...} → DayLogRow
GET    /api/admin/attendance/history?shiftId&date → AuditEntry[]

GET    /api/employees?inactive=1              → Employee[]
POST   /api/employees                         → Employee
PATCH  /api/employees/:id                     → Employee
DELETE /api/employees/:id                     → ซ่อน (กะถูกปิด ออกจากระบบทุกเครื่อง)
POST   /api/employees/:id/restore
DELETE /api/employees/:id/purge  {confirmName} → ลบถาวร ต้องพิมพ์ชื่อให้ตรง
GET    /api/employees/:id/schedule            → EmployeeSchedule
PUT    /api/employees/:id/schedule/:projectId {shifts} → ScheduleWriteResult (ว่าง = เอาออกจากโปรเจก)

GET    /api/projects                          → ProjectSummary[]
POST   /api/projects · PATCH /api/projects/:id · DELETE /api/projects/:id (เฉพาะที่ไม่เคยมีกะ)
GET    /api/projects/:id                      → ProjectDetail
POST   /api/projects/:id/assign {employeeId, shifts} → ScheduleWriteResult

GET    /api/report/:employeeId?month=YYYY-MM  → MonthlyReport

GET    /api/import/template                   → ไฟล์ .xlsx ตัวอย่าง
POST   /api/import/preview   (multipart file) → ImportPreview (ผลเก็บใน session ฝั่งเซิร์ฟเวอร์)
POST   /api/import/commit                     → { applied }
POST   /api/import/cancel

GET    /api/settings · PATCH /api/settings {qrTokenTtl} · POST /api/settings/display-key
GET    /api/holidays?year= · POST /api/holidays {date, name} · DELETE /api/holidays/:date
```

`action` ของ `/api/admin/attendance`: `checkin` (+`time`), `undo_checkin`, `early_leave` (+`time`),
`clear_early_leave`, `set_status` (+`status`: leave/present/late/absent), `clear_status` ทุกตัวรับ `note` ได้

## ตรรกะที่พลาดไม่ได้ และมี test คุมอยู่

- **เกณฑ์สาย** สแกนก่อน `เริ่มกะ + 1 นาทีเต็ม` = ปกติ (09:00:59.999 ปกติ, 09:01:00.000 สาย) `test/logic.test.ts`
- **เวลาที่บันทึกคือเวลาที่สแกน** ตอน `GET /api/checkin` บันทึก `scannedAt` ลง session ก่อนพาไปหน้า Google
  test: สแกน 08:59:50 กลับจาก Google 09:01:30 → บันทึก 08:59:50 สถานะปกติ `test/api.test.ts`
- **ใช้เวลาเซิร์ฟเวอร์เสมอ** ไม่มี endpoint ไหนรับเวลาจาก client ยกเว้นแอดมินกดแทน (บันทึกว่าแอดมินกด)
- **คำนวณสถานะตอนอ่าน** ไม่มี cron ถ้าเซิร์ฟเวอร์ล่มข้ามคืน ตัวเลขยังถูก
- **อีเมลต้องอยู่ในตารางพนักงาน** ห้ามสร้างผู้ใช้อัตโนมัติ test: บัญชีแปลกหน้า → `not_registered`
- **Excel** ตรวจครบทุกแถวแล้วรายงานทีเดียว มีปัญหาแม้แถวเดียวไม่บันทึกอะไร คู่ที่ไม่อยู่ในไฟล์ไม่ถูกแตะ
- **ประวัติ** ทุกการกดของแอดมินลง `audit_log` และการแก้สถานะลง `status_overrides` (ต่อท้ายอย่างเดียว)

## ข้อควรรู้เรื่องตาราง

- `employees.email` เก็บตัวพิมพ์เล็กเสมอ
- `shifts` ไม่มี unique ที่ (employee, weekday) เพราะคนที่มาสองรอบมีสองแถว
- `shifts.valid_from / valid_to` = ช่วงวันที่กะนี้ใช้ได้ ตารางปัจจุบันคือแถวที่ `valid_to IS NULL`
  กะที่เคยมีการเช็กชื่อจะถูกปิดด้วย `valid_to` ไม่ถูกลบ รายงานย้อนหลังจึงไม่เปลี่ยน
- `attendance` unique ที่ (shift_id, date) กันกดซ้ำ
- `status_overrides` แถวล่าสุดของ (shift, date) คือค่าที่มีผล `status = null` คือแอดมินล้างค่า
