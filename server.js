const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// โหลดไฟล์ .env อัตโนมัติถ้ามี (Node.js 20.12+)
if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  process.loadEnvFile();
}

const { WebSocketServer } = require('ws');
const { OAuth2Client } = require('google-auth-library');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

// ================= config =================
const ENV = {
  PORT: process.env.PORT || 3000,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  // เจ้าของร้าน (owner) = ทำได้ทุกอย่าง; พนักงาน (staff) เพิ่มได้ในหน้าตั้งค่า
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || 's6606021610087@email.kmutnb.ac.th')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};
const DEV_MODE = !ENV.GOOGLE_CLIENT_ID; // ไม่มี client id = ล็อกอินจำลอง (ทดสอบเท่านั้น)

// ================= storage =================
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const SLIPS = path.join(DATA, 'slips');
[DATA, UPLOADS, SLIPS].forEach(d => fs.mkdirSync(d, { recursive: true }));
const RECOVERED = [];   // ไฟล์ที่เสียหายและถูกกู้คืนตอนเริ่มระบบ
function load(name, def) {
  const f = path.join(DATA, name);
  const tryParse = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return e.code === 'ENOENT' ? undefined : null; } };
  const v = tryParse(f);
  if (v === undefined) return def;                       // ยังไม่มีไฟล์ → ค่าเริ่มต้น
  if (v === null) {                                      // ไฟล์เสีย → เก็บไฟล์เสียไว้ดู แล้วกู้จาก .bak
    try { fs.renameSync(f, f + '.corrupt-' + Date.now()); } catch { }
    const b = tryParse(f + '.bak');
    if (b !== undefined && b !== null) { console.warn(`[RECOVER] ${name} เสียหาย → กู้จากไฟล์สำรองล่าสุดแล้ว`); RECOVERED.push(name + ' (กู้จาก .bak)'); return b; }
    console.error(`[CORRUPT] ${name} เสียหายและไม่มีไฟล์สำรอง → ใช้ค่าเริ่มต้น (ไฟล์เดิมเก็บเป็น .corrupt-*)`); RECOVERED.push(name + ' (ไม่มีไฟล์สำรอง ใช้ค่าเริ่มต้น)');
    return def;
  }
  return v;
}
const lastBak = {};
function save(name, obj) {
  const f = path.join(DATA, name), tmp = f + '.tmp';
  const json = JSON.stringify(obj, null, 2);
  JSON.parse(json);                                      // ต้องเป็น JSON ที่อ่านกลับได้เสมอ ก่อนเขียนจริง
  fs.writeFileSync(tmp, json);
  if (fs.existsSync(f) && Date.now() - (lastBak[name] || 0) > 60000) { try { fs.copyFileSync(f, f + '.bak'); lastBak[name] = Date.now(); } catch { } }   // เก็บเวอร์ชันก่อนหน้า
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(tmp, f);
      return;
    } catch (e) {
      if (attempt === 2) {
        try {
          fs.copyFileSync(tmp, f);
          try { fs.unlinkSync(tmp); } catch {}
          return;
        } catch (copyErr) {
          throw e;
        }
      }
      const start = Date.now();
      while (Date.now() - start < (attempt + 1) * 50) {}
    }
  }
}

const DEFAULT_SETTINGS = {
  shopName: process.env.SHOP_NAME || 'เครป ริมคลอง',
  tagline: 'หอม อร่อย ใส่แน่น กรอบนาน',
  phone: '0987127099',
  facebookName: '',
  facebookUrl: '',
  lineName: 'เครป ริมคลอง',
  lineId: '',
  address: '',
  mapUrl: '',
  hoursText: '',
  promptpayId: process.env.PROMPTPAY_ID || '0636534337',
  accepting: true,            // เปิดรับออเดอร์
  useHours: false,            // ใช้เวลาเปิด-ปิดอัตโนมัติ
  openTime: '09:00', closeTime: '20:00',
  announcement: '',           // ข้อความประกาศบนหน้าลูกค้า
  prepMinutes: 10,            // เวลาทำโดยประมาณต่อออเดอร์
  allowCash: true,            // รับเงินสดที่ร้าน
  requireSlip: false,         // บังคับแนบสลิปก่อนแจ้งโอน
  earnBahtPerPoint: 10,       // ทุกกี่บาทได้ 1 แต้ม
  pointValue: 1,              // 1 แต้ม = กี่บาทตอนใช้ส่วนลด
  maxRedeemPercent: 50,       // ใช้แต้มลดได้สูงสุดกี่ % ของยอด
  autoCancelMinutes: 20,      // ยกเลิกออเดอร์ที่ไม่ชำระภายในกี่นาที (0 = ไม่ยกเลิก)
  webhookUrl: '',             // Discord/Slack webhook แจ้งเตือนออเดอร์ใหม่ (https)
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || '',
  lineAdminUserIds: process.env.LINE_ADMIN_USER_IDS || '',
  lineNotifyEnabled: true,
  staff: [],                  // อีเมลพนักงาน
  // ---- ความปลอดภัย / ขีดจำกัด / ขั้นสูง (เจ้าของปรับในหลังร้าน > ตั้งค่าขั้นสูง) ----
  maxItemsPerOrder: 30,          // จำนวนชิ้นรวมต่อออเดอร์
  maxOrderAmount: 3000,          // ยอดอาหารสูงสุดต่อออเดอร์ (บาท, 0 = ไม่จำกัด)
  minOrderAmount: 0,             // ยอดอาหารขั้นต่ำต่อออเดอร์
  maxPendingPerUser: 2,          // ออเดอร์ที่ยังไม่จ่าย/รอตรวจ ต่อลูกค้า 1 คนพร้อมกัน
  maxOrdersPerUserPerDay: 20,    // ออเดอร์ต่อลูกค้าต่อวัน
  maxOpenOrders: 60,             // ออเดอร์รอชำระรวมทั้งร้าน (กันถูกถล่ม)
  cancelBlockCount: 3,           // ยกเลิก/หมดเวลาครบกี่ครั้งใน 60 นาที จึงพักการสั่ง 30 นาที (0 = ปิด)
  requirePhone: false,           // บังคับกรอกเบอร์โทรตอนสั่ง
  busyExtraMinutes: 0,           // โหมดยุ่ง: บวกเวลารอเพิ่มกี่นาที
  cashHoldMinutes: 30,           // เงินสดที่ร้านไม่ยืนยันภายในกี่นาที → ยกเลิก (0 = ไม่ยกเลิก)
  slipRetentionDays: 90,         // เก็บรูปสลิปกี่วัน (0 = ไม่ลบ)
  weekHours: null,               // เวลาเปิดรายวัน [อา..ส] {open,from,to} (null = ใช้ openTime/closeTime เหมือนกันทุกวัน)
  closedDates: [],               // วันหยุดพิเศษ [{date:'YYYY-MM-DD', reason}]
  ticketFooter: 'ขอบคุณที่อุดหนุน',  // ข้อความท้ายใบพิมพ์
};
let settings = { ...DEFAULT_SETTINGS, ...load('settings.json', {}) };
let menu = load('menu.json', null) || require('./default-menu');
let orders = load('orders.json', []);
let users = load('users.json', {});
let coupons = load('coupons.json', []);
const DEFAULT_INVENTORY = [
  { id: 'inv_sugar', name: 'น้ำตาลทรายขาว', category: 'แป้งและส่วนผสมหลัก', qty: 10, unit: 'กก.', minAlert: 3, cost: 28, note: 'มิตรผล', updatedAt: Date.now() },
  { id: 'inv_flour', name: 'แป้งเครปสำเร็จรูป', category: 'แป้งและส่วนผสมหลัก', qty: 20, unit: 'กก.', minAlert: 5, cost: 65, note: 'ถุงละ 1 กก.', updatedAt: Date.now() },
  { id: 'inv_milk_fresh', name: 'นมสดจืด', category: 'นมและเครื่องดื่ม', qty: 12, unit: 'ลิตร', minAlert: 4, cost: 45, note: 'เมจิ / โฟร์โมสต์', updatedAt: Date.now() },
  { id: 'inv_milk_sweet', name: 'นมข้นหวาน', category: 'นมและเครื่องดื่ม', qty: 18, unit: 'กระป๋อง', minAlert: 5, cost: 24, note: 'คาร์เนชัน', updatedAt: Date.now() },
  { id: 'inv_milk_evap', name: 'นมข้นจืด', category: 'นมและเครื่องดื่ม', qty: 15, unit: 'กระป๋อง', minAlert: 4, cost: 22, note: 'ฟอลคอน / คาร์เนชัน', updatedAt: Date.now() },
  { id: 'inv_egg', name: 'ไข่ไก่ (เบอร์ 2)', category: 'แป้งและส่วนผสมหลัก', qty: 60, unit: 'ฟอง', minAlert: 15, cost: 4.2, note: 'แผงละ 30 ฟอง', updatedAt: Date.now() },
  { id: 'inv_butter', name: 'เนยสดชนิดเค็ม', category: 'แป้งและส่วนผสมหลัก', qty: 5, unit: 'ก้อน (1 กก.)', minAlert: 2, cost: 160, note: '', updatedAt: Date.now() },
  { id: 'inv_cocoa', name: 'ผงโกโก้ 100%', category: 'นมและเครื่องดื่ม', qty: 4, unit: 'ถุง (500g)', minAlert: 2, cost: 120, note: '', updatedAt: Date.now() },
  { id: 'inv_coffee', name: 'เมล็ดกาแฟสด', category: 'นมและเครื่องดื่ม', qty: 4, unit: 'ถุง (500g)', minAlert: 2, cost: 175, note: 'คั่วกลาง-เข้ม', updatedAt: Date.now() },
  { id: 'inv_thai_tea', name: 'ใบชาไทยตรามือ', category: 'นมและเครื่องดื่ม', qty: 5, unit: 'ถุง', minAlert: 2, cost: 75, note: 'สูตรสีทอง/ดั้งเดิม', updatedAt: Date.now() },
  { id: 'inv_sauce_choc', name: 'ซอสช็อกโกแลต', category: 'ท็อปปิ้งและไส้', qty: 4, unit: 'ขวด', minAlert: 2, cost: 85, note: 'ขวดบีบ', updatedAt: Date.now() },
  { id: 'inv_sauce_straw', name: 'ซอสสตรอว์เบอร์รี่', category: 'ท็อปปิ้งและไส้', qty: 4, unit: 'ขวด', minAlert: 2, cost: 85, note: 'ขวดบีบ', updatedAt: Date.now() },
  { id: 'inv_nutella', name: 'นูเทลล่า (Nutella)', category: 'ท็อปปิ้งและไส้', qty: 3, unit: 'กระปุก (680g)', minAlert: 1, cost: 230, note: '', updatedAt: Date.now() },
  { id: 'inv_foithong', name: 'ฝอยทองสด', category: 'ท็อปปิ้งและไส้', qty: 5, unit: 'กล่อง (500g)', minAlert: 2, cost: 70, note: '', updatedAt: Date.now() },
  { id: 'inv_cup16', name: 'แก้วพลาสติก 16/22 oz', category: 'บรรจุภัณฑ์และของใช้', qty: 10, unit: 'แถว (50 ใบ)', minAlert: 3, cost: 75, note: 'PP เรียบใส', updatedAt: Date.now() },
  { id: 'inv_crepe_bag', name: 'ซองใส่เครปกระดาษ', category: 'บรรจุภัณฑ์และของใช้', qty: 8, unit: 'แพ็ค (100 ซอง)', minAlert: 2, cost: 85, note: 'แบบสามเหลี่ยม', updatedAt: Date.now() }
];
let inventory = load('inventory.json', DEFAULT_INVENTORY);
let sessions = load('sessions.json', {});
let bans = load('bans.json', {});   // email -> {at, by, reason} สมาชิกที่ถูกระงับการสั่ง
const SESSION_MS = 30 * 24 * 3600 * 1000;
for (const [t, v] of Object.entries(sessions)) {
  if (typeof v === 'string') sessions[t] = { email: v, exp: Date.now() + SESSION_MS };
  else if (v.exp < Date.now()) delete sessions[t];
}
const saveSettings = () => save('settings.json', settings);
const saveMenu = () => save('menu.json', menu);
const saveOrders = () => save('orders.json', orders);
const saveUsers = () => save('users.json', users);
const saveCoupons = () => save('coupons.json', coupons);
const saveInventory = () => save('inventory.json', inventory);

const lineOA = require('./line-oa');
lineOA.init({
  dataDir: DATA,
  getSettings: () => settings,
  saveSettings,
  onAckOrder: (orderId, queueNo, by = 'LINE') => {
    const o = orders.find(x => x.id === orderId);
    if (o) {
      o.acknowledged = true;
      o.acknowledgedViaLine = true;
      saveOrders();
    }
    broadcastAll({ type: 'order_ack', orderId, queueNo, by });
  }
});
const saveSessions = () => save('sessions.json', sessions);
const saveBans = () => save('bans.json', bans);
saveSettings(); saveMenu(); saveSessions();

// ================= helpers =================
const BKK = 7 * 3600 * 1000; // เวลาไทย
const dayKey = ts => new Date(ts + BKK).toISOString().slice(0, 10);
const hourOf = ts => new Date(ts + BKK).getUTCHours();
const nowMinutes = () => { const d = new Date(Date.now() + BKK); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const uid = (n = 4) => crypto.randomBytes(n).toString('hex');
const BADCHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;   // อักขระควบคุม/ล่องหน/กลับทิศทางข้อความ (ใช้ป่วนหน้าจอ)
const str = (v, max) => String(v == null ? '' : v).replace(BADCHARS, '').trim().slice(0, max);
let ops = null;   // โมดูล ops.js (ความปลอดภัย/audit/สำรอง/รายงาน) ผูกทีหลัง

const hhmm = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
function todayHours() {
  const wd = new Date(Date.now() + BKK).getUTCDay();   // 0 = อาทิตย์
  if (Array.isArray(settings.weekHours) && settings.weekHours.length === 7 && settings.weekHours[wd]) return settings.weekHours[wd];
  return { open: true, from: settings.openTime, to: settings.closeTime };
}
function shopState() {
  if (!settings.accepting) return { open: false, reason: 'ร้านปิดรับออเดอร์ชั่วคราว' };
  const closed = (settings.closedDates || []).find(c => c.date === dayKey(Date.now()));
  if (closed) return { open: false, reason: 'วันนี้ร้านหยุด' + (closed.reason ? ` (${closed.reason})` : '') };
  if (settings.useHours) {
    const h = todayHours();
    if (!h.open) return { open: false, reason: 'วันนี้ร้านหยุด' };
    const n = nowMinutes(), o = hhmm(h.from), c = hhmm(h.to);
    const ok = o <= c ? n >= o && n < c : n >= o || n < c;
    if (!ok) return { open: false, reason: `ร้านเปิดรับออเดอร์ ${h.from}-${h.to} น.` };
  }
  return { open: true };
}

const googleClient = new OAuth2Client(ENV.GOOGLE_CLIENT_ID);
const roleOf = email => ENV.ADMIN_EMAILS.includes(email) ? 'owner' : (settings.staff || []).includes(email) ? 'staff' : 'customer';

function newSession(email) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { email, exp: Date.now() + SESSION_MS };
  saveSessions();
  return token;
}
function userFromToken(token) {
  const s = sessions[token];
  if (!s || s.exp < Date.now() || !users[s.email]) return null;
  const u = users[s.email], role = roleOf(s.email);
  return {
    email: s.email, name: u.name, picture: u.picture, phone: u.phone || '', points: u.points || 0,
    orderCount: u.orderCount || 0, log: (u.log || []).slice(-20).reverse(), role, isAdmin: role !== 'customer', isOwner: role === 'owner', banned: !!bans[s.email], isGuest: !!u.isGuest
  };
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const u = userFromToken(token);
  if (!u) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  req.user = u; req.token = token;
  next();
}
const staffOnly = (req, res, next) => req.user.isAdmin ? next() : ((ops && ops.noteAbuse('forbidden_admin', req)), res.status(403).json({ error: 'เฉพาะเจ้าของร้าน/พนักงาน' }));
const ownerOnly = (req, res, next) => req.user.isOwner ? next() : ((ops && ops.noteAbuse('forbidden_admin', req)), res.status(403).json({ error: 'เฉพาะเจ้าของร้าน' }));

// rate limit ในหน่วยความจำ
const hits = new Map();
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const key = name + ':' + (req.user ? req.user.email : (ops ? ops.clientIp(req) : req.ip));
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  if (++h.n > max) { if (h.n === max + 1 && ops) ops.noteAbuse('rate_limit', req); return res.status(429).json({ error: 'ทำรายการถี่เกินไป กรุณารอสักครู่' }); }
  next();
};
setInterval(() => { const n = Date.now(); for (const [k, h] of hits) if (h.reset < n) hits.delete(k); }, 60000);

async function notify(text) {
  if (!/^https:\/\//.test(settings.webhookUrl || '')) return;
  try {
    await fetch(settings.webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text })
    });
  } catch (e) { console.warn('webhook failed:', e.message); }
}

async function promptpayQR(amount) {
  const payload = generatePayload(settings.promptpayId, { amount });
  return QRCode.toDataURL(payload, { margin: 1, width: 360 });
}

function saveImage(dataUrl, dir, name, maxBytes) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw new Error('รองรับเฉพาะรูป PNG/JPG/WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw new Error('ไฟล์ใหญ่เกินไป');
  const magic = buf.subarray(0, 12).toString('hex');
  const okMagic = magic.startsWith('89504e47') || magic.startsWith('ffd8ff') || (magic.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
  if (!okMagic) throw new Error('ไฟล์รูปไม่ถูกต้อง');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const file = `${name}.${ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}

// ================= menu =================
function sanitizeMenu(m) {
  if (!m || !Array.isArray(m.categories) || !Array.isArray(m.items)) throw new Error('รูปแบบเมนูไม่ถูกต้อง');
  const seen = new Set();
  const U = id => { id = str(id, 40) || uid(3); while (seen.has(id)) id = uid(3); seen.add(id); return id; };
  const categories = m.categories.map(c => ({ id: U(c.id), name: str(c.name, 40) || 'หมวด' }));
  if (!categories.length) throw new Error('ต้องมีอย่างน้อย 1 หมวด');
  const catIds = new Set(categories.map(c => c.id));
  const items = m.items.map(i => {
    const id = U(i.id);
    const price = Number(i.price);
    if (!(price >= 0)) throw new Error(`ราคาของ "${i.name}" ไม่ถูกต้อง`);
    if (!catIds.has(i.category)) throw new Error(`"${i.name}" อยู่ในหมวดที่ไม่มี`);
    const stock = i.stock === null || i.stock === '' || i.stock === undefined ? null : Math.max(0, parseInt(i.stock, 10) || 0);
    const image = /^\/uploads\/[\w.-]+$/.test(i.image || '') ? i.image : '';
    const groups = (i.groups || []).map(g => {
      const gid = str(g.id, 40) || uid(3);
      const opts = (g.options || []).map(o => ({ id: str(o.id, 40) || uid(3), name: str(o.name, 40) || '-', price: Math.max(0, Number(o.price) || 0) }));
      if (!opts.length) throw new Error(`กลุ่ม "${g.name}" ต้องมีตัวเลือก`);
      const oseen = new Set();
      opts.forEach(o => { while (oseen.has(o.id)) o.id = uid(3); oseen.add(o.id); });
      return {
        id: gid, name: str(g.name, 40) || 'ตัวเลือก', type: g.type === 'multi' ? 'multi' : 'single',
        required: !!g.required, max: g.type === 'multi' ? Math.max(0, parseInt(g.max, 10) || 0) : 0, options: opts
      };
    });
    return {
      id, category: i.category, name: str(i.name, 60) || 'เมนู', price, available: i.available !== false, stock,
      image, description: str(i.description, 200), recommended: !!i.recommended, groups
    };
  });
  return { categories, items };
}
function menuDiff(a, b) {   // สรุปสิ่งที่เปลี่ยนในเมนู (ไว้เขียน audit log)
  const out = [], old = new Map(a.items.map(i => [i.id, i]));
  b.items.forEach(i => {
    const o = old.get(i.id);
    if (!o) out.push('เพิ่ม ' + i.name);
    else {
      if (o.price !== i.price) out.push(`${i.name}: ราคา ${o.price}→${i.price}`);
      if (o.name !== i.name) out.push(`เปลี่ยนชื่อ ${o.name}→${i.name}`);
      if (o.available !== i.available) out.push(`${i.name}: ${i.available ? 'เปิดขาย' : 'ปิดขาย'}`);
    }
    old.delete(i.id);
  });
  old.forEach(o => out.push('ลบ ' + o.name));
  return out.slice(0, 15).join(' | ') || 'แก้ไขรายละเอียด/ตัวเลือก/หมวด';
}
const publicMenu = () => ({
  categories: menu.categories,
  items: menu.items.map(i => ({ ...i, available: i.available && (i.stock == null || i.stock > 0) })),
});

// ================= pricing =================
function buildItems(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw new Error('ตะกร้าว่าง');
  return raw.map(r => {
    const m = menu.items.find(i => i.id === r.menuId);
    if (!m || !m.available) throw new Error('เมนูบางรายการหมดหรือไม่มีในระบบ');
    const qty = Math.max(1, Math.min(20, parseInt(r.qty, 10) || 1));
    let unit = m.price;
    const chosen = [], sel = {};
    for (const g of m.groups || []) {
      const picks = [...new Set(((r.options || {})[g.id] || []).filter(id => g.options.some(o => o.id === id)))];
      if (g.required && !picks.length) throw new Error(`กรุณาเลือก "${g.name}" ของ ${m.name}`);
      if (g.type === 'single' && picks.length > 1) throw new Error(`"${g.name}" เลือกได้อย่างเดียว`);
      if (g.max && picks.length > g.max) throw new Error(`"${g.name}" เลือกได้ไม่เกิน ${g.max}`);
      if (picks.length) sel[g.id] = picks;
      for (const id of picks) { const o = g.options.find(x => x.id === id); unit += o.price; chosen.push({ group: g.name, name: o.name, price: o.price }); }
    }
    const cat = menu.categories.find(c => c.id === m.category);
    return { menuId: m.id, name: m.name, cat: cat ? cat.name : '', catId: m.category, qty, unitPrice: unit, options: chosen, sel, note: str(r.note, 200) };
  });
}

function applyCoupon(code, subtotal, email) {
  const c = coupons.find(x => x.code === code.trim().toUpperCase());
  if (!c || !c.active) throw new Error('ไม่พบคูปองนี้');
  if (c.expires && c.expires < Date.now()) throw new Error('คูปองหมดอายุแล้ว');
  if (subtotal < (c.minTotal || 0)) throw new Error(`ต้องสั่งขั้นต่ำ ฿${c.minTotal} ถึงจะใช้คูปองนี้ได้`);
  if (c.maxUses && c.usedBy.length >= c.maxUses) throw new Error('คูปองถูกใช้ครบสิทธิ์แล้ว');
  if (c.usedBy.includes(email)) throw new Error('คุณใช้คูปองนี้ไปแล้ว');
  let amount = c.type === 'percent' ? Math.floor(subtotal * Math.max(0, Number(c.value) || 0) / 100) : Math.max(0, Number(c.value) || 0);
  if (c.type === 'percent' && c.maxDiscount) amount = Math.min(amount, Math.max(0, Number(c.maxDiscount) || 0));
  return { code: c.code, amount: Math.max(0, Math.min(amount, subtotal)) };
}

function priceOrder(user, body) {
  const items = buildItems(body.items);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const need = {};
  items.forEach(i => (need[i.menuId] = (need[i.menuId] || 0) + i.qty));
  for (const id in need) {
    const m = menu.items.find(x => x.id === id);
    if (m.stock != null && m.stock < need[id]) throw new Error(`${m.name} เหลือ ${m.stock} ชิ้น`);
  }
  let coupon = null, couponAmt = 0;
  if (body.coupon && String(body.coupon).trim()) { coupon = applyCoupon(String(body.coupon), subtotal, user.email); couponAmt = coupon.amount; }
  const pv = Math.max(1, settings.pointValue);
  const cap = Math.floor((subtotal - couponAmt) * settings.maxRedeemPercent / 100 / pv);
  const userPoints = Math.max(0, parseInt(user.points, 10) || 0);
  const pointsUsed = Math.max(0, Math.min(parseInt(body.points, 10) || 0, userPoints, cap));
  const pointsAmt = pointsUsed * pv;
  return { items, subtotal, coupon, couponAmt, pointsUsed, pointsAmt, total: Math.max(0, subtotal - couponAmt - pointsAmt), need };
}

// ================= orders =================
const STATUS_TEXT = {
  pending_payment: 'รอชำระเงิน', payment_claimed: 'รอร้านตรวจสอบการชำระเงิน', paid: 'ร้านยืนยันรับเงินแล้ว',
  preparing: 'กำลังทำ', ready: 'พร้อมรับแล้ว', done: 'สำเร็จ', rejected: 'ยกเลิก',
};
const TRANSITIONS = {
  pending_payment: ['paid', 'rejected'], payment_claimed: ['paid', 'rejected'], paid: ['preparing', 'rejected'],
  preparing: ['ready', 'done', 'rejected'], ready: ['done', 'rejected'], done: ['rejected'],
};
const ACTIVE = ['pending_payment', 'payment_claimed', 'paid', 'preparing', 'ready'];

function nextQueueNo() {
  const today = dayKey(Date.now());
  return orders.filter(o => dayKey(o.createdAt) === today).reduce((m, o) => Math.max(m, o.queueNo), 0) + 1;
}
function logPoints(email, delta, reason, orderId) {
  const u = users[email]; if (!u) return;
  u.points = Math.max(0, (u.points || 0) + delta);
  u.log = [...(u.log || []), { at: Date.now(), delta, reason, orderId }].slice(-100);
}

function setStatus(o, status, by, reason) {
  o.status = status;
  o.history.push({ status, at: Date.now(), by: by || 'system', ...(reason ? { reason } : {}) });
  if (reason && status === 'rejected') o.rejectReason = reason;
  if (status === 'rejected') {           // คืนสต็อก แต้ม และสิทธิ์คูปอง
    if (!o.restored) {
      o.restored = true;
      o.items.forEach(i => { const m = menu.items.find(x => x.id === i.menuId); if (m && m.stock != null) m.stock += i.qty; });
      saveMenu();
      if (o.discount && o.discount.pointsUsed) logPoints(o.email, o.discount.pointsUsed, 'คืนแต้มจากออเดอร์ยกเลิก', o.id);
      if (o.discount && o.discount.coupon) { const c = coupons.find(x => x.code === o.discount.coupon); if (c) { c.usedBy = c.usedBy.filter(e => e !== o.email); saveCoupons(); } }
    }
    if (o.earned && users[o.email]) {
      if (o.pointsEarned) logPoints(o.email, -o.pointsEarned, 'หักแต้มคืนจากออเดอร์ที่ยกเลิก', o.id);
      users[o.email].orderCount = Math.max(0, (users[o.email].orderCount || 1) - 1);
      o.earned = false;
    }
    saveUsers();
  }
  if (status === 'done' && !o.earned && users[o.email]) {  // สะสมแต้มเมื่อสำเร็จ
    o.earned = true;
    o.pointsEarned = Math.floor(o.total / Math.max(1, settings.earnBahtPerPoint));
    users[o.email].orderCount = (users[o.email].orderCount || 0) + 1;
    if (o.pointsEarned) logPoints(o.email, o.pointsEarned, 'ได้รับจากออเดอร์', o.id);
    saveUsers();
  }
  saveOrders();
  broadcast(o);
  if (ops && by && by !== 'customer' && by !== 'system') ops.audit({ email: by }, 'order.' + status, `#${o.queueNo} ฿${o.total}${reason ? ' — ' + reason : ''}`);
  if (status === 'payment_claimed') {
    notify(`🔔 ออเดอร์ #${o.queueNo} ฿${o.total} (${o.payment.method === 'cash' ? 'เงินสด' : 'โอน'}) รอตรวจสอบ — ${o.name}`);
    const payTitle = o.payment && o.payment.method === 'cash' ? 'มีออเดอร์ใหม่! (ชำระเงินสดหน้าร้าน)' : 'ลูกค้าแจ้งชำระเงิน (รอตรวจสลิป)';
    lineOA.notifyOrder(o, payTitle).catch(err => console.warn('[LINE OA] status notify error:', err.message));
  }
}

function ordersView(o) { return { ...o, payment: o.payment }; }

// ================= app =================
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({
  limit: '4mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'รูปแบบ JSON ไม่ถูกต้อง' });
  }
  next(err);
});
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(js|css|html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/api', rateLimit('api', 600, 60000));

// ความปลอดภัย / audit / สำรองข้อมูล / รายงาน (ดู ops.js) — ติดตั้งก่อนเส้นทางอื่นเพื่อให้ /api/admin/report ใหม่ถูกใช้
ops = require('./ops')({
  app, auth, staffOnly, ownerOnly, DATA, SLIPS, BKK, dayKey, hourOf, str, STATUS_TEXT, DEV_MODE, roleOf, setStatus, broadcastAll,
  get settings() { return settings; }, get orders() { return orders; }, get users() { return users; }, get menu() { return menu; },
  get coupons() { return coupons; }, get bans() { return bans; }, get recovered() { return RECOVERED; },
  saveSettings, saveOrders, saveUsers, saveBans,
});

const publicConfig = () => ({
  shopName: settings.shopName,
  tagline: settings.tagline || '',
  coverImage: settings.coverImage || '/img/cover.jpg',
  phone: settings.phone || '',
  facebookName: settings.facebookName || '',
  facebookUrl: settings.facebookUrl || '',
  lineName: settings.lineName || '',
  lineId: settings.lineId || '',
  address: settings.address || '',
  mapUrl: settings.mapUrl || '',
  hoursText: settings.hoursText || '',
  googleClientId: ENV.GOOGLE_CLIENT_ID, devMode: DEV_MODE, statusText: STATUS_TEXT,
  shop: shopState(), announcement: settings.announcement, allowCash: settings.allowCash, requireSlip: settings.requireSlip,
  pointValue: settings.pointValue, earnBahtPerPoint: settings.earnBahtPerPoint, maxRedeemPercent: settings.maxRedeemPercent,
  prepMinutes: settings.prepMinutes + (settings.busyExtraMinutes || 0), autoCancelMinutes: settings.autoCancelMinutes,
  requirePhone: settings.requirePhone, minOrderAmount: settings.minOrderAmount, maxOrderAmount: settings.maxOrderAmount, busyExtraMinutes: settings.busyExtraMinutes || 0,
});
app.get('/api/config', (req, res) => res.json(publicConfig()));
app.get('/api/menu', (req, res) => res.json(publicMenu()));

app.get('/api/queue', (req, res) => {
  const today = dayKey(Date.now());
  const t = orders.filter(o => dayKey(o.createdAt) === today);
  const nums = sts => t.filter(o => sts.includes(o.status)).map(o => o.queueNo).sort((a, b) => a - b);
  res.json({ shopName: settings.shopName, phone: settings.phone || '', preparing: nums(['paid', 'preparing']), ready: nums(['ready']) });
});

// ---- auth ----
function upsertUser(email, data) {
  users[email] = { points: 0, orderCount: 0, createdAt: Date.now(), ...users[email], ...data };
  saveUsers();
}
app.post('/api/auth/google', rateLimit('auth', 30, 10 * 60000), async (req, res) => {
  if (DEV_MODE) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: ENV.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) throw new Error('email not verified');
    const email = p.email.toLowerCase();
    upsertUser(email, { name: p.name, picture: p.picture });
    const token = newSession(email);
    if (roleOf(email) !== 'customer') ops.audit({ email, role: roleOf(email) }, 'login', 'เข้าสู่ระบบ (Google)', req);
    res.json({ token, user: userFromToken(token) });
  } catch { res.status(401).json({ error: 'ล็อกอิน Google ไม่สำเร็จ' }); }
});
app.post('/api/auth/dev', rateLimit('auth', 30, 10 * 60000), (req, res) => {
  if (!DEV_MODE) return res.status(404).end(); // ปิดอัตโนมัติเมื่อตั้ง GOOGLE_CLIENT_ID
  const email = str(req.body.email, 100).toLowerCase();
  if (!/^\S+@\S+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  // ความปลอดภัย: ในโหมดทดสอบ บัญชีเจ้าของร้าน/พนักงานเข้าได้เฉพาะจากเครื่องที่รันเซิร์ฟเวอร์ (localhost)
  // ไม่ให้คนนอกพิมพ์อีเมลเจ้าของร้านผ่านอินเทอร์เน็ตแล้วเข้าหลังร้านได้
  const viaProxy = !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (roleOf(email) !== 'customer' && (viaProxy || !loopback)) { ops.noteAbuse('admin_login_blocked', req, email); }
  if (roleOf(email) !== 'customer' && (viaProxy || !loopback))
    return res.status(403).json({ error: 'บัญชีเจ้าของร้าน/พนักงานต้องเข้าจากเครื่องที่ร้าน (http://localhost:3000/admin.html) หรือเปิดใช้ Google login' });
  upsertUser(email, { name: str(req.body.name, 50) || email });
  const token = newSession(email);
  if (roleOf(email) !== 'customer') ops.audit({ email, role: roleOf(email) }, 'login', 'เข้าสู่ระบบ (โหมดทดสอบ)', req);
  res.json({ token, user: userFromToken(token) });
});
app.post('/api/auth/guest', rateLimit('auth', 60, 10 * 60000), (req, res) => {
  const name = str(req.body.name, 50) || 'ลูกค้าทั่วไป';
  const phone = str(req.body.phone, 15).replace(/[^\d+]/g, '');
  const guestId = uid(6);
  const email = `guest_${guestId}@guest.local`;
  upsertUser(email, { name, phone, picture: '', isGuest: true });
  const token = newSession(email);
  res.json({ token, user: userFromToken(token) });
});
app.get('/api/me', auth, (req, res) => res.json(req.user));
app.put('/api/me', auth, (req, res) => {
  if (req.body.name) users[req.user.email].name = str(req.body.name, 50) || users[req.user.email].name;
  users[req.user.email].phone = str(req.body.phone, 15).replace(/[^\d+]/g, '');
  saveUsers();
  res.json(userFromToken(req.token));
});
app.post('/api/logout', auth, (req, res) => { delete sessions[req.token]; saveSessions(); res.json({ ok: true }); });

// ---- customer ----
app.post('/api/quote', auth, (req, res) => {
  try {
    const p = priceOrder(req.user, req.body);
    res.json({ subtotal: p.subtotal, couponAmt: p.couponAmt, coupon: p.coupon && p.coupon.code, pointsUsed: p.pointsUsed, pointsAmt: p.pointsAmt, total: p.total });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', auth, rateLimit('order', 15, 10 * 60000), async (req, res) => {
  try {
    const st = shopState();
    if (!st.open) throw new Error(st.reason);
    if (req.user.banned) { ops.noteAbuse('banned_order', req); throw new Error('บัญชีนี้ถูกระงับการสั่งซื้อชั่วคราว กรุณาติดต่อร้าน'); }
    const p = priceOrder(req.user, req.body);
    const method = req.body.method === 'cash' && settings.allowCash ? 'cash' : 'promptpay';
    const name = str(req.body.name, 50) || req.user.name || 'ลูกค้าทั่วไป';
    const phone = str(req.body.phone, 15).replace(/[^\d+]/g, '');
    if (settings.requirePhone && !(phone || req.user.phone)) throw new Error('กรุณากรอกเบอร์โทรศัพท์เพื่อให้ร้านติดต่อได้');
    const dk = ops.dedupe.key(req.user.email, p, method);   // กันกดสั่งซ้ำ/เน็ตกระตุก
    const dup = ops.dedupe.find(dk);
    if (dup) { ops.noteAbuse('duplicate_submit', req); return res.json({ ...dup, deduped: true, qr: dup.status === 'pending_payment' && dup.total > 0 && dup.payment.method === 'promptpay' ? await promptpayQR(dup.total) : null }); }
    ops.checkOrderLimits(req, p);   // ขีดจำกัด: จำนวนชิ้น/ยอด/ค้างจ่าย/ต่อวัน/ยกเลิกบ่อย/ถูกถล่ม

    // ---- commit ----
    for (const id in p.need) { const m = menu.items.find(x => x.id === id); if (m.stock != null) m.stock -= p.need[id]; }
    saveMenu();
    if (p.coupon) { coupons.find(c => c.code === p.coupon.code).usedBy.push(req.user.email); saveCoupons(); }
    if (name && users[req.user.email]) users[req.user.email].name = name;
    if (phone && users[req.user.email]) users[req.user.email].phone = phone;
    const ahead = orders.filter(o => ['payment_claimed', 'paid', 'preparing'].includes(o.status)).length;
    const o = {
      id: uid(4), queueNo: nextQueueNo(), email: req.user.email, name, phone: phone || req.user.phone,
      items: p.items, subtotal: p.subtotal,
      discount: { coupon: p.coupon && p.coupon.code, couponAmt: p.couponAmt, pointsUsed: p.pointsUsed, pointsAmt: p.pointsAmt },
      total: p.total, payment: { method, slip: false }, status: 'pending_payment', createdAt: Date.now(),
      etaMin: Math.min(120, settings.prepMinutes + (settings.busyExtraMinutes || 0) + ahead * 2), history: [],
    };
    if (p.pointsUsed) logPoints(req.user.email, -p.pointsUsed, 'ใช้เป็นส่วนลด', o.id);
    saveUsers();
    orders.push(o); ops.dedupe.remember(dk, o.id);
    o.history.push({ status: 'pending_payment', at: Date.now(), by: 'customer' });
    if (p.total === 0) setStatus(o, 'paid', 'system');
    else if (method === 'cash') setStatus(o, 'payment_claimed', 'customer');
    else {
      saveOrders();
      broadcast(o);
      lineOA.notifyOrder(o, 'มีออเดอร์ใหม่! (รอชำระเงิน)').catch(err => console.warn('[LINE OA] new order notify error:', err.message));
    }
    res.json({ ...o, qr: o.status === 'pending_payment' ? await promptpayQR(o.total) : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/orders/mine', auth, (req, res) =>
  res.json(orders.filter(o => o.email === req.user.email).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)));

function findOrderFor(req) {
  const o = orders.find(x => x.id === req.params.id);
  return o && (o.email === req.user.email || req.user.isAdmin) ? o : null;
}
app.get('/api/orders/:id', auth, async (req, res) => {
  const o = findOrderFor(req);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  res.json({ ...o, qr: o.status === 'pending_payment' && o.total > 0 && o.payment.method === 'promptpay' ? await promptpayQR(o.total) : null });
});
app.post('/api/orders/:id/slip', auth, rateLimit('slip', 10, 10 * 60000), (req, res) => {
  const o = orders.find(x => x.id === req.params.id && x.email === req.user.email);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (!['pending_payment', 'payment_claimed'].includes(o.status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  try {
    const rawData = req.body.image;
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(rawData || '');
    if (!m) throw new Error('รองรับเฉพาะรูป PNG/JPG/WEBP');
    const buf = Buffer.from(m[2], 'base64');
    const slipHash = crypto.createHash('sha256').update(buf).digest('hex');

    // ตรวจสอบการใช้สลิปซ้ำ: ไม่ให้อัปโหลดสลิปเดิมที่เคยใช้กับออเดอร์อื่นที่ไม่ถูกยกเลิก
    const dup = orders.find(x => x.id !== o.id && x.payment && x.payment.slipHash === slipHash && x.status !== 'rejected');
    if (dup) {
      if (ops) ops.noteAbuse('duplicate_slip', req, `reused slip from #${dup.queueNo}`);
      throw new Error(`สลิปนี้เคยถูกใช้กับออเดอร์ #${dup.queueNo} แล้ว กรุณาแนบสลิปการโอนจริง`);
    }

    o.payment.slip = saveImage(rawData, SLIPS, o.id, 2.5 * 1024 * 1024);
    o.payment.slipHash = slipHash;
    if (o.status === 'pending_payment') setStatus(o, 'payment_claimed', 'customer'); else { saveOrders(); broadcast(o); }
    res.json(o);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/orders/:id/slip', auth, (req, res) => {
  const o = findOrderFor(req);
  if (!o || !o.payment.slip) return res.status(404).end();
  res.sendFile(path.join(SLIPS, o.payment.slip));
});
app.post('/api/orders/:id/claim', auth, (req, res) => {
  const o = orders.find(x => x.id === req.params.id && x.email === req.user.email);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (o.status !== 'pending_payment') return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  if (settings.requireSlip && !o.payment.slip) return res.status(400).json({ error: 'กรุณาแนบสลิปการโอนก่อน' });
  setStatus(o, 'payment_claimed', 'customer');
  res.json(o);
});
app.post('/api/orders/:id/cancel', auth, (req, res) => {
  const o = orders.find(x => x.id === req.params.id && x.email === req.user.email);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  if (!['pending_payment', 'payment_claimed'].includes(o.status)) return res.status(400).json({ error: 'ยกเลิกไม่ได้แล้ว' });
  setStatus(o, 'rejected', 'customer', 'ลูกค้ายกเลิก');
  res.json(o);
});
app.get('/api/orders/:id/ack', (req, res) => {
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).send('ไม่พบออเดอร์');
  o.acknowledged = true;
  o.acknowledgedViaLine = true;
  saveOrders();
  broadcastAll({ type: 'order_ack', orderId: o.id, queueNo: o.queueNo, by: 'LINE' });
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>รับทราบออเดอร์ #${o.queueNo}</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #121212; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; text-align: center; }
.card { background: #1e1e1e; border: 1px solid #333; padding: 32px 24px; border-radius: 20px; max-width: 360px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.icon { font-size: 56px; margin-bottom: 12px; }
h2 { margin: 0 0 8px; font-size: 24px; color: #fff; }
p { color: #aaa; margin: 0 0 24px; font-size: 15px; line-height: 1.5; }
.btn { display: block; padding: 12px 20px; background: #2D5A4B; color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔕</div>
  <h2>รับทราบคิว #${o.queueNo} แล้ว</h2>
  <p>ระบบปิดเสียงแจ้งเตือนที่หน้าเว็บหน้าร้านเรียบร้อยแล้วครับ</p>
  <a class="btn" href="/admin.html#orders">ไปที่ระบบหลังร้าน</a>
</div>
</body>
</html>`);
});
app.post('/api/orders/:id/ack', (req, res) => {
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  o.acknowledged = true;
  o.acknowledgedViaLine = true;
  saveOrders();
  broadcastAll({ type: 'order_ack', orderId: o.id, queueNo: o.queueNo, by: req.body.by || 'LINE' });
  res.json({ ok: true, orderId: o.id, queueNo: o.queueNo });
});

// ---- staff (พนักงาน + เจ้าของ) ----
app.get('/api/admin/orders', auth, staffOnly, (req, res) => {
  const { from, to } = req.query;
  if (from || to) {
    return res.json(orders.filter(o => (!from || dayKey(o.createdAt) >= from) && (!to || dayKey(o.createdAt) <= to))
      .sort((a, b) => b.createdAt - a.createdAt));
  }
  const since = Date.now() - 2 * 24 * 3600 * 1000;
  res.json(orders.filter(o => o.createdAt > since || ACTIVE.includes(o.status)).sort((a, b) => b.createdAt - a.createdAt));
});
app.post('/api/admin/orders/:id/status', auth, staffOnly, (req, res) => {
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
  const next = req.body.status;
  if (!(TRANSITIONS[o.status] || []).includes(next)) return res.status(400).json({ error: 'เปลี่ยนสถานะไม่ได้' });
  setStatus(o, next, req.user.email, str(req.body.reason, 100));
  res.json(o);
});
app.get('/api/admin/stats', auth, staffOnly, (req, res) => {
  const today = dayKey(Date.now());
  const t = orders.filter(o => dayKey(o.createdAt) === today);
  const done = t.filter(o => o.status === 'done');
  res.json({
    doneCount: done.length, revenue: done.reduce((s, o) => s + o.total, 0),
    active: t.filter(o => ACTIVE.includes(o.status)).length, waitingPay: t.filter(o => o.status === 'payment_claimed').length
  });
});
// พนักงานปรับสต็อก/เปิดปิดขายได้
app.post('/api/admin/stock', auth, staffOnly, (req, res) => {
  const m = menu.items.find(i => i.id === req.body.id);
  if (!m) return res.status(404).json({ error: 'ไม่พบเมนู' });
  if ('available' in req.body) m.available = !!req.body.available;
  if ('stock' in req.body) m.stock = req.body.stock === null || req.body.stock === '' ? null : Math.max(0, parseInt(req.body.stock, 10) || 0);
  saveMenu(); broadcastAll({ type: 'menu' });
  ops.audit(req.user, 'menu.stock', `${m.name}: ${'available' in req.body ? (m.available ? 'เปิดขาย' : 'ปิดขาย') : ''} ${'stock' in req.body ? 'สต็อก=' + (m.stock == null ? 'ไม่จำกัด' : m.stock) : ''}`.trim(), req);
  res.json(m);
});

// ================= จัดการสต็อกสินค้าและวัตถุดิบ (Inventory) =================
app.get('/api/admin/inventory', auth, staffOnly, (req, res) => {
  res.json({ items: inventory });
});

app.post('/api/admin/inventory', auth, staffOnly, (req, res) => {
  const { name, category, qty, unit, minAlert, cost, note, image } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อสินค้า/วัตถุดิบ' });
  const item = {
    id: 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    category: (category || 'แป้งและส่วนผสมหลัก').trim(),
    qty: Math.max(0, parseFloat(qty) || 0),
    unit: (unit || 'ชิ้น').trim(),
    minAlert: minAlert === '' || minAlert == null ? 0 : Math.max(0, parseFloat(minAlert) || 0),
    cost: cost === '' || cost == null ? 0 : Math.max(0, parseFloat(cost) || 0),
    image: (image || '').trim(),
    note: (note || '').trim(),
    updatedAt: Date.now(),
    updatedBy: req.user.name || req.user.email
  };
  inventory.push(item);
  saveInventory();
  broadcastAll({ type: 'inventory', items: inventory });
  ops.audit(req.user, 'inventory.create', `เพิ่มวัตถุดิบ: ${item.name} (${item.qty} ${item.unit})`, req);
  res.json({ ok: true, item });
});

app.put('/api/admin/inventory/:id', auth, staffOnly, (req, res) => {
  const item = inventory.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบรายการสต็อก' });
  const { name, category, qty, unit, minAlert, cost, note, image } = req.body || {};
  if (name !== undefined) item.name = name.trim() || item.name;
  if (category !== undefined) item.category = category.trim() || item.category;
  if (qty !== undefined) item.qty = Math.max(0, parseFloat(qty) || 0);
  if (unit !== undefined) item.unit = unit.trim() || item.unit;
  if (minAlert !== undefined) item.minAlert = minAlert === '' || minAlert == null ? 0 : Math.max(0, parseFloat(minAlert) || 0);
  if (cost !== undefined) item.cost = cost === '' || cost == null ? 0 : Math.max(0, parseFloat(cost) || 0);
  if (image !== undefined) item.image = (image || '').trim();
  if (note !== undefined) item.note = (note || '').trim();
  item.updatedAt = Date.now();
  item.updatedBy = req.user.name || req.user.email;
  saveInventory();
  broadcastAll({ type: 'inventory', items: inventory });
  ops.audit(req.user, 'inventory.update', `แก้ไขวัตถุดิบ: ${item.name} (คงเหลือ ${item.qty} ${item.unit})`, req);
  res.json({ ok: true, item });
});

app.post('/api/admin/inventory/:id/adjust', auth, staffOnly, (req, res) => {
  const item = inventory.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบรายการสต็อก' });
  const { delta, newQty, reason } = req.body || {};
  const prev = item.qty;
  if (delta !== undefined) {
    item.qty = Math.max(0, Math.round((item.qty + parseFloat(delta)) * 100) / 100);
  } else if (newQty !== undefined) {
    item.qty = Math.max(0, parseFloat(newQty) || 0);
  }
  item.updatedAt = Date.now();
  item.updatedBy = req.user.name || req.user.email;
  saveInventory();
  broadcastAll({ type: 'inventory', items: inventory });
  const diff = Math.round((item.qty - prev) * 100) / 100;
  const diffStr = (diff >= 0 ? '+' : '') + diff;
  ops.audit(req.user, 'inventory.adjust', `ปรับสต็อก: ${item.name} (${diffStr} ${item.unit} เป็น ${item.qty}) ${reason ? `[${reason}]` : ''}`.trim(), req);
  res.json({ ok: true, item, prevQty: prev });
});

app.delete('/api/admin/inventory/:id', auth, staffOnly, (req, res) => {
  const idx = inventory.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการสต็อก' });
  const removed = inventory.splice(idx, 1)[0];
  saveInventory();
  broadcastAll({ type: 'inventory', items: inventory });
  ops.audit(req.user, 'inventory.delete', `ลบวัตถุดิบ: ${removed.name}`, req);
  res.json({ ok: true, removed });
});

app.get('/api/admin/menu', auth, staffOnly, (req, res) => res.json(menu));
app.get('/api/admin/settings', auth, staffOnly, (req, res) => res.json({ ...settings, isOwner: req.user.isOwner, owners: ENV.ADMIN_EMAILS }));
// ร้านเปิด/ปิดรับออเดอร์ ให้พนักงานกดได้
app.post('/api/admin/accepting', auth, staffOnly, (req, res) => {
  settings.accepting = !!req.body.accepting; saveSettings(); broadcastAll({ type: 'menu' });
  ops.audit(req.user, 'shop.accepting', settings.accepting ? 'เปิดรับออเดอร์' : 'ปิดรับออเดอร์', req);
  res.json({ accepting: settings.accepting });
});

// ---- menu & upload (owner or staff) ----
app.put('/api/admin/menu', auth, staffOnly, (req, res) => {
  try { const before = menu; menu = sanitizeMenu(req.body); saveMenu(); broadcastAll({ type: 'menu' }); ops.audit(req.user, 'menu.update', menuDiff(before, menu), req); res.json(menu); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/upload', auth, staffOnly, (req, res) => {
  try { const f = saveImage(req.body.image, UPLOADS, uid(6), 1.5 * 1024 * 1024); ops.audit(req.user, 'menu.upload', f, req); res.json({ url: '/uploads/' + f }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/settings', auth, ownerOnly, (req, res) => {
  const b = req.body, s = { ...settings };
  try {
    s.shopName = str(b.shopName, 60) || s.shopName;
    s.coverImage = str(b.coverImage, 255) || '';
    s.tagline = str(b.tagline, 100);

    const ph = str(b.phone, 20).replace(/[^0-9]/g, '');
    if (ph && !/^0\d{8,9}$/.test(ph)) throw new Error('เบอร์โทรศัพท์ร้านต้องเป็นตัวเลข 9–10 หลัก (ขึ้นต้นด้วย 0)');
    s.phone = ph;

    s.hoursText = str(b.hoursText, 100);
    s.address = str(b.address, 300);

    const mapUrl = str(b.mapUrl, 300);
    if (mapUrl && !/^https:\/\//.test(mapUrl)) throw new Error('ลิงก์แผนที่ต้องขึ้นต้นด้วย https://');
    s.mapUrl = mapUrl;

    s.facebookName = str(b.facebookName, 100);
    const fbUrl = str(b.facebookUrl, 300);
    if (fbUrl && !/^https:\/\//.test(fbUrl)) throw new Error('ลิงก์ Facebook ต้องขึ้นต้นด้วย https://');
    s.facebookUrl = fbUrl;

    s.lineName = str(b.lineName, 100);
    const lid = str(b.lineId, 60);
    if (lid && !/^@?[a-zA-Z0-9._-]+$/.test(lid)) throw new Error('LINE ID ไม่ถูกต้อง (อนุญาต @ ตัวอักษร ตัวเลข . _ -)');
    s.lineId = lid;

    if (!/^(\d{10}|\d{13})$/.test(String(b.promptpayId))) throw new Error('พร้อมเพย์ต้องเป็นเบอร์โทร 10 หลัก หรือเลขบัตร 13 หลัก');
    s.promptpayId = String(b.promptpayId);
    s.accepting = !!b.accepting; s.useHours = !!b.useHours;
    for (const k of ['openTime', 'closeTime']) { if (!/^\d{2}:\d{2}$/.test(b[k])) throw new Error('รูปแบบเวลาไม่ถูกต้อง'); s[k] = b[k]; }
    s.announcement = str(b.announcement, 200);
    s.prepMinutes = Math.max(1, Math.min(120, parseInt(b.prepMinutes, 10) || 10));
    s.allowCash = !!b.allowCash; s.requireSlip = !!b.requireSlip;
    s.earnBahtPerPoint = Math.max(1, parseInt(b.earnBahtPerPoint, 10) || 10);
    s.pointValue = Math.max(1, parseInt(b.pointValue, 10) || 1);
    s.maxRedeemPercent = Math.max(0, Math.min(100, parseInt(b.maxRedeemPercent, 10) || 0));
    s.autoCancelMinutes = Math.max(0, Math.min(240, parseInt(b.autoCancelMinutes, 10) || 0));
    const wh = str(b.webhookUrl, 300);
    if (wh && !/^https:\/\//.test(wh)) throw new Error('Webhook ต้องขึ้นต้นด้วย https://');
    s.webhookUrl = wh;
    s.lineChannelAccessToken = str(b.lineChannelAccessToken, 500);
    s.lineChannelSecret = str(b.lineChannelSecret, 100);
    s.lineAdminUserIds = str(b.lineAdminUserIds, 1000);
    s.lineNotifyEnabled = b.lineNotifyEnabled !== false;
    s.staff = [...new Set((b.staff || []).map(e => str(e, 100).toLowerCase()).filter(e => /^\S+@\S+$/.test(e)))];
    const before = settings; settings = s; saveSettings(); broadcastAll({ type: 'menu' });
    ops.audit(req.user, 'settings.update', ops.changed(before, s, ['webhookUrl']), req);
    res.json({ ...settings, isOwner: true, owners: ENV.ADMIN_EMAILS });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/coupons', auth, ownerOnly, (req, res) => res.json(coupons));
app.put('/api/admin/coupons', auth, ownerOnly, (req, res) => {
  try {
    const old = Object.fromEntries(coupons.map(c => [c.code, c]));
    const seen = new Set();
    coupons = (req.body || []).map(c => {
      const code = str(c.code, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!code || seen.has(code)) throw new Error('รหัสคูปองว่างหรือซ้ำ');
      seen.add(code);
      const type = c.type === 'percent' ? 'percent' : 'fixed', value = Number(c.value);
      if (!(value > 0) || (type === 'percent' && value > 100)) throw new Error(`ค่าส่วนลดของ ${code} ไม่ถูกต้อง`);
      return {
        code, type, value, minTotal: Math.max(0, Number(c.minTotal) || 0), maxDiscount: Math.max(0, Number(c.maxDiscount) || 0),
        maxUses: Math.max(0, parseInt(c.maxUses, 10) || 0), expires: c.expires ? Number(c.expires) : null, active: c.active !== false,
        usedBy: old[code] ? old[code].usedBy : []
      };
    });
    saveCoupons(); ops.audit(req.user, 'coupons.update', coupons.map(c => c.code + (c.active ? '' : '(ปิด)')).join(', ') || '(ไม่มีคูปอง)', req); res.json(coupons);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/members', auth, ownerOnly, (req, res) => {
  const spent = {}, last = {};
  orders.filter(o => o.status === 'done').forEach(o => { spent[o.email] = (spent[o.email] || 0) + o.total; last[o.email] = Math.max(last[o.email] || 0, o.createdAt); });
  res.json(Object.entries(users).map(([email, u]) => ({
    email, name: u.name, phone: u.phone || '', points: u.points || 0,
    orderCount: u.orderCount || 0, spent: spent[email] || 0, lastOrder: last[email] || 0, role: roleOf(email), createdAt: u.createdAt || 0, banned: !!bans[email]
  }))
    .sort((a, b) => b.spent - a.spent));
});
app.post('/api/admin/members/adjust', auth, ownerOnly, (req, res) => {
  const email = str(req.body.email, 100).toLowerCase(), delta = parseInt(req.body.delta, 10);
  if (!users[email] || !delta) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  logPoints(email, delta, 'เจ้าของร้านปรับแต้ม: ' + str(req.body.reason, 60), null); saveUsers();
  ops.audit(req.user, 'member.points', `${email} ${delta > 0 ? '+' : ''}${delta} (${str(req.body.reason, 60)})`, req);
  res.json({ points: users[email].points });
});
// (รายงานยอดขายย้ายไปอยู่ใน ops.js: GET /api/admin/report, /api/admin/sales-lines)
app.get('/api/admin/backup', auth, ownerOnly, (req, res) => {
  ops.audit(req.user, 'backup.download', 'ไฟล์สำรองทั้งระบบ', req);
  res.setHeader('Content-Disposition', `attachment; filename="pos-backup-${dayKey(Date.now())}.json"`);
  res.json({ exportedAt: Date.now(), settings, menu, orders, users, coupons, inventory });
});
app.get('/api/admin/siteqr', auth, staffOnly, async (req, res) => {
  const url = str(req.query.url, 300);
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'ลิงก์ไม่ถูกต้อง' });
  res.json({ qr: await QRCode.toDataURL(url, { margin: 2, width: 520 }) });
});

// ---- LINE Official Account (Webhook & APIs) ----
app.post('/api/line/webhook', (req, res) => lineOA.handleWebhook(req, res));
app.post('/webhook/line', (req, res) => lineOA.handleWebhook(req, res));
app.get('/api/admin/line/subscribers', auth, staffOnly, (req, res) => res.json(lineOA.getSubscribers()));
app.delete('/api/admin/line/subscribers/:userId', auth, staffOnly, (req, res) => {
  const ok = lineOA.removeSubscriber(req.params.userId);
  res.json({ ok });
});
app.post('/api/admin/line/test', auth, staffOnly, async (req, res) => {
  try {
    const result = await lineOA.sendTest(req.body.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= websocket =================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const u = userFromToken(new URL(req.url, 'http://x').searchParams.get('token'));
  if (!u) return ws.close();
  let same = 0; wss.clients.forEach(c => { if (c.user && c.user.email === u.email) same++; });
  if (same >= 8) { ops.noteAbuse('ws_flood', req, u.email); return ws.close(1008, 'too many connections'); }
  ws.user = u; ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
function broadcast(order) {
  const msg = JSON.stringify({ type: 'order', order });
  wss.clients.forEach(ws => { if (ws.readyState === 1 && (ws.user.isAdmin || ws.user.email === order.email)) ws.send(msg); });
}
function broadcastAll(m) { const msg = JSON.stringify(m); wss.clients.forEach(ws => ws.readyState === 1 && ws.send(msg)); }

// ยกเลิกออเดอร์ที่ไม่ชำระเงินตามเวลา
setInterval(() => {
  if (settings.autoCancelMinutes) {
    const limit = Date.now() - settings.autoCancelMinutes * 60000;
    orders.filter(o => o.status === 'pending_payment' && o.createdAt < limit).forEach(o => setStatus(o, 'rejected', 'system', 'หมดเวลาชำระเงิน'));
  }
  try { ops.sweep(); } catch (e) { console.warn('sweep failed:', e.message); }   // เงินสดค้างเกินเวลา + ลบสลิปเก่า
}, 60000);

app.use((err, req, res, next) => {
  console.error('[EXPRESS ERROR]', err);
  if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

process.on('uncaughtException', err => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));

server.listen(ENV.PORT, () => {
  console.log(`POS running: http://localhost:${ENV.PORT}   (admin: /admin.html, จอคิว: /queue.html)`);
  console.log(DEV_MODE ? 'โหมดทดสอบ: ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID (ล็อกอินจำลอง — ห้ามใช้ตอนเปิดจริง)' : 'Google login: เปิดใช้งาน');
  console.log('Owner emails:', ENV.ADMIN_EMAILS.join(', '));
  if (RECOVERED.length) { console.warn('⚠ มีไฟล์ข้อมูลเสียหายที่ถูกกู้คืนตอนเริ่มระบบ:', RECOVERED.join(', ')); ops.audit('system', 'data.recovered', RECOVERED.join(', ')); }
});
