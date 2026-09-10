# Frontend

Vite · React 19 · TypeScript · Tailwind v4 · react-router · ฟอนต์ IBM Plex Sans Thai + Anuphan (อยู่ในโปรเจก ไม่โหลดจากภายนอก)

วิธีติดตั้งและ deploy อยู่ใน `README.md` ที่โฟลเดอร์บนสุด

```
src/
├── pages/
│   ├── Kiosk.tsx          จอติดผนัง อ่านจากระยะ 3-4 เมตร ดึงข้อมูลทุก 8 วินาที นาฬิกาตามเวลาเซิร์ฟเวอร์
│   ├── CheckIn.tsx        หน้าเช็กชื่อบนมือถือ 10 สถานะ
│   └── admin/             AdminLayout, Today (บันทึกประจำวัน), Employees, EmployeeDetail,
│                          Projects, ProjectDetail, ImportExcel, Report, Settings
├── components/            ui.tsx (ปุ่ม ฟอร์ม dialog), StatusPill, Schedule (ฟอร์มและตารางกะ), EmployeeForm
└── lib/
    ├── types.ts           สัญญากับ backend (backend มีสำเนาที่ src/contract.ts)
    ├── api.ts             ทุกหน้าเรียก backend ผ่าน api ตัวเดียว
    ├── mock.ts            ข้อมูลจำลองเมื่อ VITE_USE_MOCK=true
    └── format.ts          เวลาไทย ชื่อที่แสดง สรุปตาราง
```

## คำสั่ง

```bash
pnpm dev        # http://localhost:5290 ส่ง /api ต่อไปที่ backend (PORT_BACKEND)
pnpm build      # typecheck + build ไปที่ dist/
pnpm preview    # ดูผล build ที่พอร์ต PORT_FRONTEND + 1
```

## ข้อมูลจำลอง

ตั้ง `VITE_USE_MOCK=true` ใน `.env` แล้วดูได้ทุกหน้าโดยไม่ต้องมี backend

| หน้า | URL |
|---|---|
| จอในออฟฟิศ | `/display/demo` |
| เช็กชื่อบนมือถือ | `/checkin?token=demo&demo=0` ถึง `&demo=9` |
| ฝั่งแอดมิน | `/admin` |

```
demo=0 ready · 1 done ปกติ · 2 done สาย · 3 early_leave · 4 early_leave_done
demo=5 too_early · 6 no_shift_today · 7 all_done · 8 not_registered · 9 expired
```

ในหน้านำเข้า Excel ถ้าเลือกไฟล์ที่ชื่อมีคำว่า `error` จะเห็นหน้ารายงานแถวที่ผิด

`mock.ts` ใช้ชื่อเล่นตัวอย่างและอีเมลสมมติ **อย่า commit อีเมลจริงของทีมลง repo** ให้นำเข้าผ่านหน้า import ตอนใช้งานจริง

## แก้สัญญากับ backend

แก้ `src/lib/types.ts` แล้วรัน `pnpm sync-types` ในโฟลเดอร์ backend (มี test ตรวจว่าสองไฟล์ตรงกัน)
