# แผนส่งต่อ Antigravity: เปิด POS ออนไลน์ที่ https://crepe.openchat.sbs

อ่านร่วมกับ `README.md` และ `PLAN.md` — ระบบ POS (ฝั่งลูกค้า/หลังร้าน/จอคิว) เสร็จและทดสอบแล้ว งานนี้คือ "ขึ้นออนไลน์" เท่านั้น

## 1. สถานะล่าสุด (ณ 2026-11-06)
| รายการ | สถานะ |
|---|---|
| เซิร์ฟเวอร์ POS (`node server.js`, พอร์ต 3000) | รันได้ ✅ |
| Cloudflare tunnel ใหม่ `pos-crepe` (ID `f5f81efb-6bbc-4e3e-930e-794dd95bd76b`) | สร้างแล้ว และเชื่อมต่อได้ ✅ |
| ไฟล์ตั้งค่า tunnel `C:\Users\KC_Ketwilai\.cloudflared\config-pos.yml` | มีแล้ว (`crepe.openchat.sbs` → `http://127.0.0.1:3000`) ✅ |
| `start-online.bat` (เปิดเซิร์ฟเวอร์ + tunnel พร้อมกัน) | มีแล้ว ✅ |
| **DNS `crepe.openchat.sbs`** | ชี้ไป tunnel `pos-crepe` แล้ว (HTTP 200 OK) ✅ |
| Google login | ข้ามไปก่อนตามที่เจ้าของสั่ง (`GOOGLE_CLIENT_ID` ใน `.env` เว้นว่าง = โหมดทดสอบ) |
| ล็อกกันแอดมินปลอมในโหมดทดสอบ | ทำแล้วและทดสอบผ่าน ✅ (ข้อ 3) |

## 2. งานหลัก: แก้ DNS ให้ชี้ tunnel `pos-crepe` (สำเร็จแล้ว ✅)
- ดำเนินการรัน: `cloudflared --config "%USERPROFILE%\.cloudflared\config-pos.yml" tunnel route dns --overwrite-dns f5f81efb-6bbc-4e3e-930e-794dd95bd76b crepe.openchat.sbs` เรียบร้อยแล้ว
- ผลการทดสอบ: `https://crepe.openchat.sbs` และ `https://crepe.openchat.sbs/api/config` ตอบกลับ `200 OK` พร้อมข้อมูลร้านเรียบร้อยแล้ว
- ระบบล็อกความปลอดภัย: บุคคลภายนอกที่เข้าผ่านอินเทอร์เน็ตไม่สามารถแอบอ้างอีเมลเจ้าของร้านได้ (ตอบกลับ 403 Forbidden) แต่ลูกค้าทั่วไปสั่งอาหารได้ปกติ และเจ้าของร้านเข้าผ่าน localhost:3000 ได้ตามปกติ

## 3. ความปลอดภัย (ห้ามพลาด)
- **ห้ามแตะ/รีสตาร์ต tunnel `orgchat` และ `~/.cloudflared/config.yml`** — ให้บริการ `openchat.sbs` ของจริงอยู่ (พอร์ต 5005) ใช้เฉพาะ `config-pos.yml` ของ POS
- **ไฟล์ credentials (`*.json`, `cert.pem`) เป็นความลับ** ห้ามอ่านออกแชท/commit
- โหมดทดสอบ (ไม่มี `GOOGLE_CLIENT_ID`): ผู้ใช้ทั่วไปล็อกอินด้วยชื่อ+อีเมลเองได้ **แต่บัญชีเจ้าของ/พนักงานถูกบล็อกถ้ามาจากอินเทอร์เน็ต** (ตรวจ header `cf-connecting-ip`/`x-forwarded-for` และที่อยู่ที่ไม่ใช่ loopback) — ใน `server.js` ที่ `/api/auth/dev`
  - ผลคือ **เจ้าของเข้าหลังร้านได้เฉพาะที่เครื่องร้าน:** `http://localhost:3000/admin.html`
  - ข้อจำกัด: ลูกค้าปลอมอีเมลคนอื่นเพื่อดูออเดอร์/แต้มของเขาได้ในโหมดนี้ → เป็นเหตุผลที่ควรเปิด Google login ในขั้นถัดไป
- อย่าเปิดโหมดทดสอบนี้ต่อไปนานเกินช่วงทดลอง

## 4. ลำดับงานที่แนะนำ
1. แก้ DNS (ข้อ 2) → รัน `start-online.bat` → ยืนยันลิงก์ตอบ 200
2. ทดสอบจากมือถือจริง (ใช้เน็ตมือถือ ไม่ใช่ WiFi ร้าน): เปิดลิงก์ → ล็อกอินทดสอบแบบลูกค้า → สั่ง → ดูหน้าสถานะ
3. เจ้าของเปิด `http://localhost:3000/admin.html` บนเครื่องร้าน → รับ/ยืนยันออเดอร์ได้แบบ real-time (WebSocket ผ่าน tunnel ต้องทำงาน ตรวจว่าสถานะอัปเดตที่มือถือลูกค้า)
4. ใส่เมนูจริง/ราคา (หลังร้าน → เมนู) และตั้งค่าร้าน (ชื่อ เวลาเปิด-ปิด พร้อมเพย์ 0636534337)
5. สร้าง QR ร้านจาก `https://crepe.openchat.sbs/` และ QR รายโต๊ะ (หลังร้าน → QR โต๊ะ) แล้วพิมพ์
6. ทำให้รันอัตโนมัติตอนเปิดเครื่อง (ถ้าต้องการ): Task Scheduler รัน `start-online.bat`; หรือติดตั้ง tunnel เป็น Windows service ด้วย config-pos

## 5. ขั้นถัดไป (เมื่อพร้อม): เปิด Google login
- ต้องมี OAuth Client ID (Web) ที่ Authorized JavaScript origins มี `https://crepe.openchat.sbs` (+ `http://localhost:3000`)
- Google Cloud: โปรเจกต์ "My First Project" (`vigilant-willow-451610-c1`) ตั้ง consent screen ไว้แล้วบางส่วน — แนะนำสร้าง client ใหม่ในโปรเจกต์นี้ แยกจากแอปแชท openchat
- ใส่ `GOOGLE_CLIENT_ID=...` ใน `.env` แล้วรีสตาร์ต → โหมดทดสอบปิดอัตโนมัติ, `ADMIN_EMAILS` (เจ้าของ) เข้าหลังร้านจากที่ไหนก็ได้
- **เตือน:** เจ้าของเคยวาง `.env` ของโปรเจกต์ openchat ลงแชท ซึ่งมีความลับจริงหลายตัว (Groq, Gemini, LINE, Stripe, SMTP, Google client secret, VAPID) → ควรให้เจ้าของ rotate คีย์เหล่านั้น และห้ามนำคีย์เหล่านั้นมาใช้กับ POS

## 6. ข้อจำกัดที่ต้องบอกเจ้าของ
- ออนไลน์เฉพาะตอนคอมร้านเปิดและรัน `start-online.bat` ค้างไว้ (ถ้าต้องการ 24 ชม. ต้องย้ายไป VPS/Render ที่มีดิสก์ถาวร ตั้ง `DATA_DIR`)
- ข้อมูลเก็บเป็นไฟล์ JSON ใน `data/` — สำรองจากหน้าตั้งค่าเป็นประจำ
- ระบบไม่เช็กยอดโอนอัตโนมัติ เจ้าของตรวจสลิป/แอปธนาคารแล้วกดยืนยันเอง
