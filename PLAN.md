# แผนงานต่อ: POS เครป & น้ำ (Handoff สำหรับ Antigravity)

## 0. อัปเดตล่าสุด
ทำระบบเต็มแล้ว (ดูรายการฟีเจอร์ใน README.md): ตั้งค่าร้าน, สต็อก, รูปเมนู, ตัวแก้เมนูแบบฟอร์ม, คูปอง, ใช้แต้ม, เงินสด, สลิป, สถานะพร้อมรับ, รายงาน+CSV, สมาชิก, พนักงาน, จอคิว, QR รายโต๊ะ, พิมพ์ใบออเดอร์, rate limit, session หมดอายุ, Webhook, สำรองข้อมูล ผ่านสคริปต์ทดสอบ API 40 ข้อ
งานที่เหลือจริงมีเพียง P0 ในข้อ 5 (Google Client ID, https, เมนูจริง, QR) — ข้อ P1/P2 ที่เขียนด้านล่างส่วนใหญ่ทำเสร็จแล้ว ที่ยังไม่ทำ: ระบบจ่ายอัตโนมัติผ่าน payment gateway, PWA/offline, หลายภาษา, ย้ายจาก JSON ไป SQLite/DB ถ้าออเดอร์เยอะ

**อัปเดต UI:** ออกแบบ UI/UX ใหม่ทั้งหมด (style.css เป็น design system, common.js มี icon/sheet/toast, app.js = ลูกค้า, admin.js = หลังร้าน) — ไม่ได้แตะ backend

## 1. สถานะปัจจุบัน
ระบบหลักเสร็จและทดสอบ flow ในเครื่องผ่านแล้ว (ลูกค้าสั่ง → QR พร้อมเพย์ → แจ้งโอน → เจ้าของร้านยืนยันรับเงิน → เริ่มทำ → สำเร็จ)

ยังไม่ได้ทำ/ไม่ได้ทดสอบ: Google login จริง, การเปิดให้ลูกค้าเข้าผ่านเน็ต (https), เมนูจริงของร้าน

## 2. Stack และโครงสร้าง
- Backend: Node.js + Express + `ws` (WebSocket), เก็บข้อมูลเป็นไฟล์ JSON ใน `data/`
- Frontend: HTML + JS ล้วน ไม่มี framework (ตามที่ผู้ใช้ต้องการ)
- แพ็กเกจ: express, ws, google-auth-library, promptpay-qr, qrcode

```
server.js          API + auth + WebSocket + คำนวณราคาฝั่งเซิร์ฟเวอร์
default-menu.js    เมนูตัวอย่าง (ใช้ครั้งแรกถ้ายังไม่มี data/menu.json)
public/
  index.html       หน้าลูกค้า: เมนู, popup option, ตะกร้า, ประวัติ, แต้มสมาชิก
  order.html       หน้าสถานะออเดอร์ + QR พร้อมเพย์ (อัปเดต real-time)
  admin.html       หน้าเจ้าของร้าน: ออเดอร์, จัดการเมนู, QR ร้าน, เสียงเตือน
  common.js        api(), login overlay (Google/โหมดทดสอบ), WebSocket
  style.css
data/              menu.json, orders.json, users.json, sessions.json (สร้างอัตโนมัติ)
```

## 3. Flow สถานะออเดอร์
`pending_payment` → (ลูกค้ากด "โอนแล้ว") `payment_claimed` → (ร้านกดยืนยัน) `paid` → `preparing` → `done`
ยกเลิกได้ `rejected` (ลูกค้ายกเลิกได้เฉพาะก่อน paid) — การเปลี่ยนสถานะฝั่งร้านกำหนดใน `TRANSITIONS` ใน server.js

## 4. ค่าคอนฟิก (ไฟล์ .env หรือ environment variables)
ระบบรองรับการอ่านไฟล์ `.env` อัตโนมัติ (มีไฟล์ [.env](file:///c:/Users/KC_Ketwilai/OneDrive/Desktop/pos/.env) และ [.env.example](file:///c:/Users/KC_Ketwilai/OneDrive/Desktop/pos/.env.example))
| ตัวแปร | ค่า |
|---|---|
| `PROMPTPAY_ID` | 0636534337 (หรือเบอร์พร้อมเพย์ร้าน) |
| `GOOGLE_CLIENT_ID` | ว่าง = โหมดทดสอบ (เมื่อใส่ Client ID จะเปลี่ยนเป็น Google Login จริงอัตโนมัติ) |
| `ADMIN_EMAILS` | อีเมล Google ของเจ้าของร้านคั่นด้วย `,` (ค่าเริ่มต้น s6606021610087@email.kmutnb.ac.th) |
| `SHOP_NAME`, `PORT` | ชื่อร้าน / พอร์ต (3000) |
| `TRUST_PROXY` | 1 (เมื่อเปิดใช้งานผ่าน Cloudflare Tunnel หรือ Reverse Proxy) |

## 5. งานที่เหลือ (เรียงตามลำดับ)
### P0 — ต้องทำก่อนเปิดใช้งานจริง
1. **Google login จริง**: สร้าง OAuth Client ID (Web) ใน Google Cloud Console ใส่ Authorized JavaScript origins เป็นโดเมน https ของร้าน + `http://localhost:3000` นำ Client ID มาใส่ใน `.env` ที่บรรทัด `GOOGLE_CLIENT_ID=`
2. **เปิดให้ลูกค้าสั่งผ่านเน็ต (https)**:
   - มีไฟล์ [start-tunnel.bat](file:///c:/Users/KC_Ketwilai/OneDrive/Desktop/pos/start-tunnel.bat) ให้ดับเบิ้ลคลิกเปิดใช้งาน Cloudflare Tunnel ได้ทันที จะได้ URL https สำหรับทดสอบบนมือถือ
   - หรือ deploy บน Render/Railway (ต้อง mount disk ที่ `data/`)
3. **ใส่เมนูจริง** (ชื่อ ราคา ท็อปปิ้ง) แทนเมนูตัวอย่าง ผ่านหน้า admin > จัดการเมนู
4. **สร้าง QR ร้าน** จากลิงก์ https จริง (หน้า admin > QR ร้าน) แล้วพิมพ์ติดหน้าร้าน

### P1 — ความปลอดภัย/ความเสถียร
5. เพิ่ม rate limit บน `/api/orders` และ `/api/auth/*` (เช่น `express-rate-limit`) กัน spam ออเดอร์
6. ใส่ session หมดอายุ (ตอนนี้ token ใน `sessions.json` ไม่หมดอายุ) และ helmet/security headers
7. เมื่อมีโดเมน https ให้ตั้ง CORS/origin ให้ตรง และเปิด `trust proxy` ถ้าอยู่หลัง proxy

### P2 — ฟีเจอร์เสริม (ถามผู้ใช้ก่อนทำ)
8. UI แก้เมนูแบบฟอร์ม (ตอนนี้แก้ผ่าน JSON textarea) + อัปโหลดรูปเมนู
9. ใช้แต้มสมาชิกเป็นส่วนลด (ตอนนี้สะสมอย่างเดียว: 10 บาท = 1 แต้ม เมื่อ `done`)
10. แจ้งเตือนเจ้าของร้านผ่าน LINE Notify/Push, พิมพ์ใบออเดอร์/ใบคิว
11. หน้ารายงานยอดขายรายวัน/สัปดาห์ (ตอนนี้มีแค่ยอดรวมวันนี้)

## 6. ข้อควรระวัง
- ไม่มีการเช็กยอดโอนอัตโนมัติ (พร้อมเพย์ส่วนบุคคลไม่มี API) เจ้าของร้านต้องตรวจในแอปธนาคารแล้วกดยืนยันเอง — ถ้าต้องการอัตโนมัติ ต้องใช้ payment gateway เช่น Omise/2C2P/SCB
- ราคาคำนวณฝั่งเซิร์ฟเวอร์เสมอ (`buildItems`) ห้ามเชื่อราคาจากไคลเอนต์
- ข้อความที่ผู้ใช้กรอกต้อง escape (`esc()`) ก่อนใส่ `innerHTML` ทุกครั้ง
- โหมดทดสอบ (`/api/auth/dev`) เปิดเฉพาะเมื่อไม่มี `GOOGLE_CLIENT_ID` — ห้ามปล่อยโหมดนี้ไว้บนเซิร์ฟเวอร์จริง
- ห้ามใส่ Client Secret/คีย์ลงในโค้ดหรือ commit; ใช้ environment variable

## 7. วิธีรัน/ทดสอบ
```
npm install
npm start          # http://localhost:3000  และ /admin.html
```
ทดสอบ flow: ล็อกอิน (โหมดทดสอบ) → สั่ง → กด "โอนเงินแล้ว" → เปิด /admin.html ด้วยอีเมลใน `ADMIN_EMAILS` → ยืนยันจนสำเร็จ แล้วเช็กว่าแต้มสมาชิกเพิ่ม
