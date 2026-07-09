# SMR — ระบบลงทะเบียนงานสัมมนา

ระบบลงทะเบียนเข้าร่วมงานสัมมนา (backend + หน้าเว็บ) เก็บข้อมูลรวมศูนย์ที่เซิร์ฟเวอร์
- มี `DATABASE_URL` → เก็บลง **PostgreSQL** (สำหรับใช้งานจริง / บน Railway)
- ไม่มี `DATABASE_URL` → เก็บลงไฟล์ `data/registrations.json` (สำหรับทดสอบในเครื่อง)

## ไฟล์
- `server.js` — เว็บเซิร์ฟเวอร์ + API (Node.js ล้วน ไม่พึ่ง framework)
- `public/index.html` — หน้าฟอร์มลงทะเบียน
- `public/admin.html` — หน้าหลังบ้าน (ดูรายชื่อ / ค้นหา / ลบ / ดาวน์โหลด CSV)
- `package.json` — สคริปต์เริ่มรัน + dependency (`pg`)

## รันในเครื่อง
```bash
npm install        # ติดตั้ง pg (ครั้งแรกครั้งเดียว)
npm start          # หรือ node server.js
```
เปิด:
- ฟอร์มลงทะเบียน → http://localhost:3000
- หน้าหลังบ้าน → http://localhost:3000/admin

## Deploy บน Railway
1. เชื่อม repo นี้กับ Railway (Deploy from GitHub)
2. กด **+ New → Database → Add PostgreSQL**
3. ที่ service ของแอป → **Variables** → เพิ่ม:
   - `DATABASE_URL` = `${{ Postgres.DATABASE_URL }}`
   - `ADMIN_KEY` = รหัสผ่านหน้าหลังบ้านที่ต้องการ
4. Railway จะ build ด้วย Nixpacks (`npm install` + `npm start`) และรันบนพอร์ตที่กำหนดผ่าน `PORT` อัตโนมัติ

## ตัวแปรสภาพแวดล้อม (Environment Variables)
| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|----------|
| `PORT` | `3000` | พอร์ตของเซิร์ฟเวอร์ (Railway กำหนดให้เอง) |
| `DATABASE_URL` | *(ว่าง)* | ถ้ามี → ใช้ PostgreSQL |
| `ADMIN_KEY` | `admin123` | รหัสผ่านเข้าหน้าหลังบ้าน |

## ความสามารถ
- ฟอร์มลงทะเบียนครบ 14 หัวข้อ พร้อมตรวจสอบข้อมูลที่จำเป็น
- ตรวจอีเมล/เบอร์โทรแบบเรียลไทม์ และ**กันข้อมูลซ้ำที่เซิร์ฟเวอร์** (กันข้ามเครื่องได้จริง)
- หน้าหลังบ้าน (ใส่รหัสผ่าน) ดูรายชื่อทั้งหมด ค้นหา ลบ และดาวน์โหลด CSV (รองรับภาษาไทยใน Excel)
