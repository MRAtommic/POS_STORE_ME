// ตรวจสถานะ POS ที่ออนไลน์ (อ่านอย่างเดียว ไม่สร้างข้อมูลใดๆ)
// ใช้: node check-live.js [https://crepe.openchat.sbs]
const base = (process.argv[2] || 'https://crepe.openchat.sbs').replace(/\/$/, '');
let fail = 0, warn = 0;
const ok = (n, c, hint = '', soft = false) => { console.log((c ? '✅ ' : soft ? '⚠️  ' : '❌ ') + n + (c ? '' : '  → ' + hint)); if (!c) soft ? warn++ : fail++; };
const get = async p => { const r = await fetch(base + p); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, h: r.headers }; };

(async () => {
  console.log('ตรวจ', base, '\n');
  const cfg = await get('/api/config');
  ok('ออนไลน์ (/api/config = 200)', cfg.s === 200, 'ตรวจ tunnel pos-crepe + DNS + เซิร์ฟเวอร์พอร์ต 3000');
  if (cfg.s !== 200) return process.exit(1);
  const c = cfg.j;
  ok('Google login เปิดแล้ว (googleClientId ไม่ว่าง)', !!c.googleClientId, 'ใส่ GOOGLE_CLIENT_ID ใน .env แล้วรีสตาร์ต');
  ok('ปิดโหมดทดสอบแล้ว (devMode=false)', c.devMode === false, 'โหมดทดสอบไม่ยืนยันตัวตน ห้ามเปิดจริง');
  // probe แบบปลอดภัย: อีเมลไม่ถูกต้อง -> ไม่สร้างผู้ใช้; production ต้องได้ 404, dev ได้ 400
  const r = await fetch(base + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x' }) });
  ok('ช่องล็อกอินทดสอบถูกปิด (/api/auth/dev = 404)', r.status === 404, `ได้ ${r.status}`);
  const men = await get('/api/menu');
  const items = (men.j && men.j.items) || [];
  const SAMPLE = ['เครปช็อกโกแลตกล้วย', 'เครปไข่แฮมชีส', 'เครปสตรอว์เบอร์รี่ครีม', 'เครปไส้กรอกชีส', 'ชาไทย', 'ชาเขียวนม', 'โกโก้', 'น้ำส้มคั้น'];
  ok('ใช้เมนูจริงแล้ว (ไม่ใช่เมนูตัวอย่าง)', items.length > 0 && !items.every(i => SAMPLE.includes(i.name)), 'ใส่เมนูจริงที่หลังร้าน > เมนู', true);
  ok('เมนูมีรูปอย่างน้อยบางรายการ', items.some(i => i.image), 'อัปโหลดรูปเมนู (ไม่บังคับ แต่ช่วยยอดขาย)', true);
  ok('ประกาศ/ร้านเปิดรับออเดอร์', c.shop && c.shop.open, 'ร้านปิดรับออเดอร์อยู่ (ถูกต้องถ้านอกเวลา)', true);
  const q = await get('/api/queue'); ok('จอคิวใช้ได้ (/api/queue)', q.s === 200 && Array.isArray(q.j && q.j.ready));
  const adm = await get('/api/admin/orders'); ok('API หลังร้านต้องมีการยืนยันตัวตน (401)', adm.s === 401, `ได้ ${adm.s}`);
  ok('มี X-Content-Type-Options', cfg.h.get('x-content-type-options') === 'nosniff', 'ตรวจ middleware security headers');
  const mf = await get('/manifest.webmanifest'); ok('มี PWA manifest', mf.s === 200);
  console.log(`\nสรุป: ผ่านเงื่อนไขบังคับ ${fail ? 'ไม่ครบ (' + fail + ' ข้อ)' : 'ครบ'} · คำเตือน ${warn}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ตรวจไม่สำเร็จ:', e.message); process.exit(2); });
