# แผนทำต่อ (ฉบับล่าสุด) — จากออนไลน์ → เปิดขายจริง

ตรวจสถานะจริงเมื่อ 2026-11-06 ~23:00 ด้วย `node check-live.js` (สคริปต์นี้ใช้ยืนยันผลทุกขั้น รันซ้ำได้ ไม่สร้างข้อมูล)
รายละเอียดเชิงลึก/เหตุผล ดู `NEXT_PLAN.md` · เรื่อง tunnel ดู `ONLINE_PLAN.md`

## 1. สถานะจริง (ไม่อิงคำบอกเล่า — อิงผลตรวจ)
| รายการ | ผล |
|---|---|
| `https://crepe.openchat.sbs` ออนไลน์ผ่าน tunnel `pos-crepe` | ✅ 200 |
| ระบบ POS ครบ + UI มือถือ + จอคิว + manifest + header ความปลอดภัย | ✅ |
| API หลังร้านต้องล็อกอิน (401) | ✅ |
| **Google login** (`GOOGLE_CLIENT_ID` ใน `.env`) | ❌ ว่าง |
| **โหมดทดสอบปิดหรือยัง** (`devMode:false`, `/api/auth/dev`=404) | ❌ ยังเปิด (ได้ 400) |
| เมนูจริง / รูปเมนู | ⚠️ ยังเป็นเมนูตัวอย่าง 8 รายการ ไม่มีรูป |
| ตั้งรันอัตโนมัติ (Task Scheduler) | ❌ ไม่พบงานที่ตั้งไว้ |
| ข้อมูลทดสอบค้าง | ⚠️ `data/users.json` มี `cus@test.com`, `customera@gmail.com`, `x@x.com` (อันหลังเกิดจาก probe ของผมเมื่อกี้ — ผมตรวจ `/api/auth/dev` บนลิงก์จริงด้วยอีเมลปลอม ขออภัย; สคริปต์ `check-live.js` ใหม่ใช้ probe แบบไม่สร้างผู้ใช้แล้ว) |
| orders / coupons | 0 / 0 (สะอาด) |

> หมายเหตุ: หากมีงานที่ทำไปแล้วแต่ไม่สะท้อนในผลข้างบน (เช่น ทำใน Google Console แล้วแต่ยังไม่ใส่ `.env`) ให้ระบุในขั้นนั้นว่าค้างอยู่ตรงไหน
> เบราว์เซอร์ในแอป Claude มี popup ค้าง (หน้าล็อกอิน Google) — ปิดก่อนถ้าจะให้ Claude ช่วยเปิดหน้า Google Cloud

## 2. ลำดับงาน (ทำตามนี้ ทีละข้อ)

### ขั้น 1 — เปิด Google login  *(เจ้าของต้องมีส่วนร่วม)*
เจ้าของ: Google Cloud → โปรเจกต์ "My First Project" (`vigilant-willow-451610-c1`) → Google Auth Platform
1. consent screen (External) ให้เสร็จ; **Audience → Publish app → In production** (สโคป email/profile ไม่ต้องรีวิว) *หรือ* เพิ่ม Test users ถ้ายังทดลอง
2. Clients → Create → Web application → Authorized JavaScript origins: `https://crepe.openchat.sbs` และ `http://localhost:3000` → คัดลอก Client ID (ไม่ลับ; **ไม่ต้องใช้ client secret**)
Antigravity:
3. ใส่ `.env`: `GOOGLE_CLIENT_ID=<id>` และ `ADMIN_EMAILS=<อีเมล Google ที่เจ้าของใช้ล็อกอินจริง>` (ตอนนี้เป็นอีเมลมหาวิทยาลัย — ยืนยันว่าล็อกอิน Google ได้)
4. หยุดเซิร์ฟเวอร์ → **ล้างข้อมูลทดสอบ**: ลบ `data/users.json` `data/sessions.json` (และ `orders.json` ถ้ามี) → เริ่มใหม่ (`start-online.bat`)
5. ✅ ตรวจรับ: `node check-live.js` ข้อ Google/devMode/auth-dev เป็น ✅ ทั้งหมด + ลองล็อกอินจากมือถือด้วยเน็ตมือถือ + เจ้าของเข้า `https://crepe.openchat.sbs/admin.html` ได้ + บัญชีทั่วไปเข้า admin ไม่ได้
- ห้ามใช้ Client ID/คีย์ของโปรเจกต์ openchat (คนละแอป) — สร้างใหม่ในโปรเจกต์นี้

### ขั้น 2 — ใส่เมนูจริง + ตั้งค่าร้าน  *(ต้องการข้อมูลจากเจ้าของ)*
ขอจากเจ้าของ: รายการเมนู+ราคา, ท็อปปิ้ง/ตัวเลือก (ขนาด ความหวาน น้ำแข็ง), รูป (ถ้ามี), เวลาเปิด-ปิด
ทำที่หลังร้าน: เมนู (หมวด/เมนู/ตัวเลือก/รูป, ลบของตัวอย่าง) → ตั้งค่า (ชื่อร้าน, พร้อมเพย์ 0636534337, เวลาเปิด-ปิด, ยกเลิกถ้าไม่จ่าย 15–20 นาที, แต้ม, เงินสด/สลิป, พนักงาน)
✅ ตรวจรับ: `check-live.js` ไม่เหลือคำเตือนเมนูตัวอย่าง

### ขั้น 3 — ทดสอบจริงก่อนเปิดขาย (UAT)
ใช้มือถือจริง + เน็ตมือถือ ตามเช็กลิสต์ใน `NEXT_PLAN.md` เฟส D โดยต้องมี: สั่ง → จ่ายพร้อมเพย์จริงยอดเล็ก → แนบสลิป → เจ้าของยืนยัน → สถานะลูกค้าอัปเดตเอง → ได้แต้ม, เงินสด, ยกเลิกแล้วคืนสต็อก/แต้ม/คูปอง, ปิดรับออเดอร์
จบด้วย: หยุดเซิร์ฟเวอร์ → ลบ `orders.json` และบัญชีทดสอบ → เริ่มใหม่

### ขั้น 4 — ให้ทนทานตอนร้านเปิดจริง
1. Task Scheduler รัน `start-online.bat` ตอนล็อกอิน/เปิดเครื่อง (+ restart on failure)
2. ตั้ง Power & sleep ไม่หลับ, ใช้สายแลน
3. สำรอง `data/` รายวัน (copy ไป OneDrive/USB)
4. uptime monitor ที่ `https://crepe.openchat.sbs/api/config` (เช่น UptimeRobot)
5. **มี cloudflared ซ้ำได้** (ระบบเดิมของ openchat + pos-crepe) — ระวังอย่าเปิด `pos-crepe` สองตัวชนกัน และห้ามแตะ tunnel `orgchat` / `~/.cloudflared/config.yml`

### ขั้น 5 — พิมพ์ QR แล้วเปิดขาย 🎉
หลังร้าน → QR โต๊ะ: ใส่ `https://crepe.openchat.sbs/` → QR ร้าน + QR รายโต๊ะ (`?table=N`) → พิมพ์/ลามิเนต · เปิดจอคิว `https://crepe.openchat.sbs/queue.html` บนทีวี/แท็บเล็ต

### ขั้น 6 — หลังเปิดขาย 1–2 สัปดาห์
ดูรายงาน (เมนูขายดี/ช่วงเวลา) → ปรับเมนู/คูปอง → พิจารณาเฟส F ใน `NEXT_PLAN.md` (VPS 24 ชม., SQLite, ตรวจยอดโอนอัตโนมัติ, LINE OA/Web Push)

## 3. สิ่งที่ค้างฝั่งเจ้าของ (ไม่เกี่ยวกับโค้ด)
- **เปลี่ยนคีย์ที่เคยวางในแชท** (Groq, Gemini, LINE token/secret, Stripe secret, VAPID private, รหัสผ่านแอป Gmail SMTP, Google client secret ของ openchat) — ความลับอยู่ในประวัติแชทแล้ว
- ตัดสินใจ PDPA: ข้อความนโยบายความเป็นส่วนตัวสั้นๆ ที่หน้าล็อกอิน

## 4. กฎเหล็ก
- ใช้ `node check-live.js` ยืนยันก่อนบอกว่า "เสร็จ" ทุกขั้น
- แก้ `.env` แล้วต้องรีสตาร์ตเซิร์ฟเวอร์; แก้ `server.js` ต้อง `node --check server.js`
- ห้าม commit/แชร์ `.env`, `data/`, ไฟล์ credentials ใน `~/.cloudflared`
