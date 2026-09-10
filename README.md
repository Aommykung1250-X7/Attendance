# ระบบเช็กชื่อเข้างาน

สร้างตาม `2026-09-11-office-attendance-design.md` (v1) ครบทุกหัวข้อในขอบเขต

```
Attendance/
├── backend/                 Node 20+ · Fastify · Drizzle ORM · PostgreSQL
│   ├── src/lib/             ตรรกะหลัก: เวลา สถานะ การเลือกกะ QR ตารางกะ
│   ├── src/services/        เช็กชื่อ บันทึกประจำวัน พนักงาน รายงาน นำเข้า Excel
│   ├── src/routes/          HTTP endpoint
│   ├── drizzle/             ไฟล์ migration (รันเองตอนเริ่ม server)
│   └── test/                test ตรรกะ + test ทั้งระบบกับ Postgres จริง
├── frontend/                Vite · React 19 · TypeScript · Tailwind v4
│   ├── src/pages/           Kiosk, CheckIn, admin/*
│   ├── src/components/      ปุ่ม ฟอร์ม สถานะ ตารางกะ
│   └── src/lib/             types.ts (สัญญากับ backend), api.ts, mock.ts
├── docker-compose.yml       ขึ้น production: db + backend + frontend
├── docker-compose.dev.yml   Postgres สำหรับพัฒนาบนเครื่อง
└── .env.production.example
```

## หน้าที่มี

| หน้า | URL | ใครใช้ |
|---|---|---|
| จอในออฟฟิศ | `/display/<รหัสสุ่ม>` | จอติดผนัง ไม่ต้องล็อกอิน (ดูลิงก์จริงในหน้าตั้งค่า) |
| เช็กชื่อบนมือถือ | `/checkin?token=...` | พนักงาน เปิดจากการสแกน QR |
| บันทึกประจำวัน | `/admin` | แอดมิน กดลา กดเช็กชื่อแทน แจ้งกลับก่อนแทน แก้ย้อนหลัง |
| พนักงาน | `/admin/employees` | เพิ่ม แก้ ซ่อน ลบถาวร และตารางกะรายคน |
| โปรเจก | `/admin/projects` | สร้างโปรเจก เพิ่มคนเข้าโปรเจก |
| นำเข้า Excel | `/admin/import` | ดาวน์โหลดไฟล์ตัวอย่าง อัปโหลด ตรวจ แล้วยืนยัน |
| รายงานรายเดือน | `/admin/report` | ทีละคน กดตัวเลขเพื่อดูว่าวันไหนบ้าง |
| ตั้งค่า | `/admin/settings` | ลิงก์หน้าจอ อายุ QR วันหยุด |

---

## 1. ตั้งค่า Google Auth Platform (ทำครั้งเดียว)

ที่ [console.cloud.google.com](https://console.cloud.google.com) เลือกหรือสร้างโปรเจก แล้วเข้าเมนู **Google Auth Platform**

1. **Branding** ใส่ชื่อแอป (เช่น "เช็กชื่อเข้างาน") และอีเมลติดต่อ
2. **Audience** เลือก **External** แล้วกด **Publish app** ให้สถานะเป็น **In production**
   (spec หัวข้อ 11: โหมด Testing จำกัดให้ใช้ได้เฉพาะคนที่ถูกเพิ่มเป็น test user)
   ระบบขอแค่ `openid email profile` ซึ่งไม่ต้องผ่านการตรวจสอบของ Google
3. **Clients** → **Create client** → ประเภท **Web application**
   - Authorized JavaScript origins: `https://attendance.yourdomain.com`
   - Authorized redirect URIs: `https://attendance.yourdomain.com/api/auth/google/callback`
   - ถ้าจะลองบนเครื่องตัวเองด้วย เพิ่ม `http://localhost:5290` และ `http://localhost:5290/api/auth/google/callback`
4. คัดลอก **Client ID** และ **Client secret** ไปใส่ใน env

ขั้นตอนล็อกอินใช้ Authorization Code + PKCE ฝั่งเซิร์ฟเวอร์ ตรวจ ID token ทุกครั้ง
แล้ว **นำอีเมลไปเทียบกับตารางพนักงานเสมอ ไม่เคยสร้างผู้ใช้ใหม่อัตโนมัติ**

## 2. กำหนดแอดมิน

แอดมินกำหนดที่ env ตัวเดียว คั่นด้วย comma ไม่สนตัวพิมพ์

```
ADMIN_EMAILS=admin1@gmail.com,admin2@gmail.com
```

- แอดมินไม่จำเป็นต้องอยู่ในรายชื่อพนักงาน ถ้าอยู่ด้วยก็เช็กชื่อได้ตามปกติ
- เพิ่มหรือเอาแอดมินออก = แก้ env แล้วรีสตาร์ท backend
- ทุกการกดของแอดมินบันทึกอีเมลของคนกด เวลา และค่าเดิม

## 3. รันบนเครื่องตัวเอง

ต้องมี Node 20.19 ขึ้นไป, pnpm และ PostgreSQL (หรือ Docker)

```bash
# ฐานข้อมูล (ถ้ามี Postgres อยู่แล้วข้ามได้ แก้ DATABASE_URL แทน)
docker compose -f docker-compose.dev.yml up -d

# backend
cd backend
pnpm install
cp .env.example .env        # แก้ ADMIN_EMAILS และ GOOGLE_* (หรือใช้ DEV_LOGIN)
pnpm db:seed                # ข้อมูลตัวอย่าง (อีเมลสมมติ) ไม่บังคับ
pnpm dev                    # http://127.0.0.1:5292

# frontend (อีกหน้าต่าง)
cd frontend
pnpm install
cp .env.example .env
pnpm dev                    # http://localhost:5290
```

- ยังไม่มี Google Client ก็ลองได้: ตั้ง `DEV_LOGIN=true` แล้วเปิด
  `http://localhost:5290/api/auth/dev-login?email=<อีเมลใน ADMIN_EMAILS>&next=/admin`
  (ทางลัดนี้ปิดเสมอเมื่อ `NODE_ENV=production`)
- ดูหน้าตาอย่างเดียวโดยไม่มี backend: ตั้ง `VITE_USE_MOCK=true` ใน `frontend/.env`
  หน้าเช็กชื่อดูได้ทั้ง 10 สถานะที่ `/checkin?token=demo&demo=0` ถึง `9`

test:

```bash
cd backend
pnpm test        # ต้องมี Postgres และ database ชื่อ attendance_test (หรือตั้ง TEST_DATABASE_URL)
pnpm typecheck
```

## 4. Deploy บน VPS ด้วย Docker Compose

> ขั้นตอนละเอียดตั้งแต่เช็กพอร์ตว่างบนเครื่องที่ใช้ร่วมกับโปรเจกอื่น อยู่ใน **[DEPLOY.md](DEPLOY.md)** และมีสคริปต์ตรวจเครื่อง `scripts/check-vps.sh`

```bash
cp .env.production.example .env.production   # แก้ทุกค่า CHANGE_ME
docker compose --env-file .env.production up -d --build
```

- ได้ 3 คอนเทนเนอร์: `db` (Postgres ไม่เปิดออก host), `backend` (4802), `frontend` (nginx 4801)
- ทุกพอร์ตผูกกับ `127.0.0.1` เท่านั้น ต้องมี reverse proxy บน VPS ที่ทำ HTTPS ชี้เข้า `127.0.0.1:4801`
- migration รันเองตอน backend เริ่ม ครั้งแรกระบบจะสร้างรหัสหน้าจอแบบสุ่มให้

ตัวอย่าง nginx บน VPS (ใช้ certbot ทำ HTTPS)

```nginx
server {
    server_name attendance.yourdomain.com;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:4801;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
# แล้วรัน: sudo certbot --nginx -d attendance.yourdomain.com
```

หรือ Caddy (ทำ HTTPS ให้เอง): `attendance.yourdomain.com { reverse_proxy 127.0.0.1:4801 }`

**HTTPS จำเป็น** เพราะ cookie ตั้งเป็น `Secure` และ Google ไม่รับ redirect URI ที่เป็น http (ยกเว้น localhost)

สำรองฐานข้อมูลวันละครั้ง (ใส่ใน crontab ของ VPS)

```bash
0 2 * * * cd /path/to/Attendance && docker compose --env-file .env.production exec -T db \
  pg_dump -U attendance_user attendance_db | gzip > /backup/attendance-$(date +\%F).sql.gz
```

อัปเดตเวอร์ชัน: `git pull && docker compose --env-file .env.production up -d --build`

## 5. เริ่มใช้งานครั้งแรก

1. เข้า `/admin` ด้วยบัญชีใน `ADMIN_EMAILS`
2. **ตั้งค่า** → เพิ่มวันหยุดของปี (ไม่งั้นวันสงกรานต์จะขึ้นว่าขาดทั้งออฟฟิศ)
3. **โปรเจก** → สร้างโปรเจกทุกโปรเจก (ชื่อต้องตรงกับในไฟล์ Excel)
4. **นำเข้า Excel** → ดาวน์โหลดไฟล์ตัวอย่าง กรอกตามรูปแบบใหม่ อัปโหลด ตรวจหน้าสรุป แล้วยืนยัน
5. **ตั้งค่า** → คัดลอกลิงก์หน้าจอ ไปเปิดบนจอในออฟฟิศแบบเต็มจอ

---

## สิ่งที่ตัดสินใจเพิ่มระหว่างสร้าง (ไม่ขัดกับ spec)

| เรื่อง | ทำอย่างไร | เหตุผล |
|---|---|---|
| ORM | Drizzle แทน Prisma ที่ README เดิมแนะนำ | ไม่ต้องดาวน์โหลด engine binary ตอน build ทดสอบได้ครบ และ image เล็กกว่า |
| ตารางกะมีช่วงเวลาใช้งาน | `shifts.valid_from / valid_to` | เปลี่ยนตารางเทอมใหม่แล้วรายงานเดือนก่อนต้องไม่เปลี่ยนตาม กะเก่าถูกปิด ไม่ถูกลบ |
| เปลี่ยนตารางกลางวัน | ถ้าวันนี้เช็กชื่อในกะเดิมไปแล้ว กะเดิมอยู่ถึงสิ้นวัน ตารางใหม่เริ่มครั้งถัดไป | ไม่ให้คนที่เช็กชื่อแล้วกลายเป็น "ยังไม่มา" ในกะใหม่ |
| ใครเขียนทีหลังชนะ | กะใหม่ที่เวลาทับกับกะของโปรเจกอื่นของคนเดียวกัน จะแทนที่กะเดิม และแจ้งให้เห็นทุกครั้ง | คนหนึ่งจึงไม่มีสองกะซ้อนกัน (spec หัวข้อ 5) |
| ในไฟล์ Excel คนเดียวสองโปรเจกเวลาทับ | ถือเป็นแถวผิด | ถ้าให้แถวหลังทับเงียบๆ แอดมินจะไม่รู้ตัว |
| โปรเจกในไฟล์ที่ไม่มีในระบบ | ถือเป็นแถวผิด ต้องสร้างโปรเจกก่อน | กันชื่อพิมพ์ผิดกลายเป็นโปรเจกใหม่ |
| คนที่ไม่มาเลยแล้วมากะถัดไป | กะที่เลยเวลาสิ้นสุดโดยไม่สแกนคือ "ขาด" ระบบข้ามไปเช็กกะถัดไป | เช่นขาดกะเช้าแต่มากะเย็น ต้องเช็กกะเย็นได้ |
| อายุ QR | รหัสบนจอเปลี่ยนทุก 30 วินาที แต่รับรหัสของรอบก่อนหน้าด้วย (ใช้ได้จริง 30–60 วินาที) | จอดึงข้อมูลทุก 8 วินาที คนที่สแกนตอนรหัสเพิ่งเปลี่ยนจะไม่โดนปฏิเสธ |
| หนึ่งการสแกนทำได้หนึ่งอย่าง | กดเช็กชื่อหรือแจ้งกลับแล้ว ต้องสแกนใหม่ถึงจะทำอย่างอื่น | กันกดซ้ำจากหน้าเดิม |
| นาฬิกาบนจอ | ใช้เวลาของเซิร์ฟเวอร์ (ชดเชยส่วนต่างกับเครื่องที่ต่อจอ) | spec หัวข้อ 8: ไม่ให้เกิดข้อโต้แย้งเรื่องเวลา |
| แอดมินกดเช็กชื่อแทน | ใส่เวลาที่มาถึงจริงได้ (ห้ามเป็นเวลาในอนาคต) และติดป้าย "แอดมินกด" | แยกน้ำหนักระหว่างสแกนเองกับแอดมินกดตอนมีคนโต้แย้ง |
| ลบการเช็กชื่อ | ลบได้เฉพาะที่แอดมินกดแทน ที่พนักงานสแกนเองแก้ได้ผ่านการแก้สถานะเท่านั้น | หลักฐานการสแกนจริงไม่หาย |
| ความปลอดภัยเพิ่ม | ตรวจ Origin ของทุกคำขอที่แก้ข้อมูล, PKCE, cookie เก็บแค่รหัสสุ่ม (ในฐานข้อมูลเก็บ sha256) | กัน CSRF และ session รั่ว |
| env เดิมที่ตัดออก | `JWT_SECRET`, `KIOSK_SECRET`, `KIOSK_ID`, `ADMIN_PASSWORD`, `SMTP_*` | ไม่อยู่ใน spec v1 ใช้ `SESSION_SECRET` และ `ADMIN_EMAILS` แทน |

## เรื่องที่ยังต้องไปหาคำตอบ (จาก spec หัวข้อ 13)

1. เวลารอบเย็นจริงของคนที่มาสองรอบ ต้องกรอกในช่องรอบ 2 ของไฟล์
2. อีเมลของ พอใจ และ บอม (Gen 7) ไฟล์นำเข้าจะไม่ผ่านจนกว่าจะมีอีเมล
3. ใครเป็นแอดมินบ้าง → ใส่ใน `ADMIN_EMAILS`
4. โดเมนที่จะใช้ → ใส่ใน `DOMAIN_URL` และใน Google Auth Platform
