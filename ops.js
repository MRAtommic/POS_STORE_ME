// =====================================================================
// ops.js — ความปลอดภัย / บันทึกการใช้งาน / สำรองข้อมูล / ตรวจความถูกต้องของข้อมูล / รายงานยอดขาย
// แยกออกจาก server.js เพื่อให้แก้ส่วนอื่นได้โดยไม่ชนกัน
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function install(ctx) {
  const { app, auth, staffOnly, ownerOnly, DATA, SLIPS, BKK, dayKey, hourOf, str, STATUS_TEXT } = ctx;
  const S = () => ctx.settings;
  const AUDIT_FILE = path.join(DATA, 'audit.jsonl');
  const BACKUPS = path.join(DATA, 'backups');
  fs.mkdirSync(BACKUPS, { recursive: true });

  // ---------- IP จริงของผู้ใช้ (เชื่อ CF-Connecting-IP เฉพาะเมื่อคำขอมาจาก tunnel บนเครื่องเรา) ----------
  const LOOP = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  function clientIp(req) {
    const viaLoop = LOOP.includes(req.socket && req.socket.remoteAddress);
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    return (viaLoop && cf) || req.ip || (req.socket && req.socket.remoteAddress) || '';
  }

  // ---------- บันทึกการใช้งาน (audit log) : เขียนต่อท้ายไฟล์ ไม่แก้ไขของเดิม ----------
  function audit(actor, action, detail = '', req) {
    const rec = {
      at: Date.now(), by: (actor && actor.email) || (typeof actor === 'string' ? actor : 'system'), role: actor && actor.role,
      action, detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700), ip: req ? clientIp(req) : undefined,
    };
    try {
      if (fs.existsSync(AUDIT_FILE) && fs.statSync(AUDIT_FILE).size > 8 * 1024 * 1024) fs.renameSync(AUDIT_FILE, AUDIT_FILE.replace('.jsonl', `-${dayKey(Date.now())}.jsonl`));
      fs.appendFileSync(AUDIT_FILE, JSON.stringify(rec) + '\n');
    } catch (e) { console.warn('audit write failed:', e.message); }
  }
  function readAudit(limit, q, prefix) {
    let text = ''; try { text = fs.readFileSync(AUDIT_FILE, 'utf8'); } catch { return []; }
    const out = []; const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue; let r; try { r = JSON.parse(lines[i]); } catch { continue; }
      if (prefix && !String(r.action).startsWith(prefix)) continue;
      if (q && !(`${r.by} ${r.action} ${r.detail} ${r.ip || ''}`).toLowerCase().includes(q)) continue;
      out.push(r);
    }
    return out;
  }
  const changed = (a, b, mask = []) => {  // เทียบค่าตั้งค่าเก่า/ใหม่ → ข้อความสั้นๆ
    const out = [];
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const x = JSON.stringify(a && a[k]), y = JSON.stringify(b && b[k]);
      if (x !== y) out.push(mask.includes(k) ? `${k}: (เปลี่ยนแล้ว)` : `${k}: ${String(x).slice(0, 60)} → ${String(y).slice(0, 60)}`);
    }
    return out.join(' | ') || '(ไม่มีอะไรเปลี่ยน)';
  };

  // ---------- บันทึกความพยายามที่ถูกบล็อก ----------
  const ABUSE = { since: Date.now(), counters: {}, recent: [] };
  function noteAbuse(kind, req, email) {
    ABUSE.counters[kind] = (ABUSE.counters[kind] || 0) + 1;
    const rec = { at: Date.now(), kind, ip: req ? clientIp(req) : '', email: email || (req && req.user && req.user.email) || '' };
    ABUSE.recent.unshift(rec); if (ABUSE.recent.length > 100) ABUSE.recent.length = 100;
    if (kind !== 'rate_limit') audit('system', 'blocked.' + kind, `${rec.email || '-'} จาก ${rec.ip || '-'}`);
  }

  // ---------- ตรวจขีดจำกัดก่อนรับออเดอร์ (กันเกรียน/สั่งป่วน) ----------
  const SELF_CANCEL = ['ลูกค้ายกเลิก', 'หมดเวลาชำระเงิน', 'ไม่ชำระเงินสดภายในเวลา'];
  function checkOrderLimits(req, p) {
    const u = req.user, now = Date.now(), cfg = S(), fail = (kind, msg) => { noteAbuse(kind, req); throw new Error(msg); };
    const qty = p.items.reduce((s, i) => s + i.qty, 0);
    if (cfg.maxItemsPerOrder && qty > cfg.maxItemsPerOrder) fail('too_many_items', `สั่งได้ไม่เกิน ${cfg.maxItemsPerOrder} ชิ้นต่อออเดอร์ (ถ้าต้องการมากกว่านี้ กรุณาติดต่อร้าน)`);
    if (cfg.maxOrderAmount && p.subtotal > cfg.maxOrderAmount) fail('amount_too_high', `ยอดสั่งต่อออเดอร์สูงสุด ฿${cfg.maxOrderAmount} (ถ้าต้องการมากกว่านี้ กรุณาติดต่อร้าน)`);
    if (cfg.minOrderAmount && p.subtotal < cfg.minOrderAmount) throw new Error(`สั่งขั้นต่ำ ฿${cfg.minOrderAmount} ต่อออเดอร์`);
    const mine = ctx.orders.filter(o => o.email === u.email);
    const pending = mine.filter(o => ['pending_payment', 'payment_claimed'].includes(o.status)).length;
    if (cfg.maxPendingPerUser && pending >= cfg.maxPendingPerUser) fail('too_many_pending', `คุณมีออเดอร์ที่ยังไม่เสร็จขั้นตอนชำระเงิน ${pending} รายการ กรุณาชำระหรือยกเลิกก่อนสั่งเพิ่ม`);
    const today = dayKey(now);
    if (cfg.maxOrdersPerUserPerDay && mine.filter(o => dayKey(o.createdAt) === today).length >= cfg.maxOrdersPerUserPerDay) fail('daily_cap', 'วันนี้คุณสั่งครบจำนวนที่กำหนดแล้ว กรุณาติดต่อร้านหากต้องการสั่งเพิ่ม');
    if (cfg.cancelBlockCount) {
      const recent = mine.filter(o => o.status === 'rejected' && SELF_CANCEL.includes(o.rejectReason) && (o.history[o.history.length - 1] || {}).at > now - 3600e3);
      if (recent.length >= cfg.cancelBlockCount) {
        const until = Math.max(...recent.map(o => o.history[o.history.length - 1].at)) + 30 * 60000;
        if (now < until) fail('cancel_abuse', `คุณยกเลิกออเดอร์บ่อยเกินไป กรุณารอ ${Math.ceil((until - now) / 60000)} นาที หรือติดต่อร้าน`);
      }
    }
    if (cfg.maxOpenOrders && ctx.orders.filter(o => o.status === 'pending_payment').length >= cfg.maxOpenOrders) fail('shop_flood', 'ขณะนี้มีออเดอร์รอชำระเงินจำนวนมาก กรุณาลองใหม่ในอีกสักครู่');
  }

  // ---------- กันกดสั่งซ้ำ (กดสองครั้ง/เน็ตกระตุก) ----------
  const recent = new Map();
  const dedupe = {
    key: (email, p, method) => email + '|' + crypto.createHash('sha1').update(JSON.stringify([p.items.map(i => [i.menuId, i.qty, i.sel, i.note]), method, p.coupon && p.coupon.code, p.pointsUsed])).digest('hex'),
    find: k => { const r = recent.get(k); const o = r && Date.now() - r.at < 20000 ? ctx.orders.find(x => x.id === r.id) : null; return o && o.status !== 'rejected' ? o : null; },
    remember: (k, id) => recent.set(k, { id, at: Date.now() }),
  };
  setInterval(() => { const n = Date.now(); for (const [k, v] of recent) if (n - v.at > 60000) recent.delete(k); }, 60000);

  // ---------- สำรองข้อมูล ----------
  function snapshot(manual) {
    const now = Date.now(), d = dayKey(now), t = new Date(now + BKK).toISOString().slice(11, 19).replace(/:/g, '');
    const name = manual ? `pos-${d}_${t}-manual.json` : `pos-${d}.json`, f = path.join(BACKUPS, name);
    if (!manual && fs.existsSync(f)) return null;
    const data = { exportedAt: now, version: 2, settings: ctx.settings, menu: ctx.menu, orders: ctx.orders, users: ctx.users, coupons: ctx.coupons, bans: ctx.bans };
    fs.writeFileSync(f + '.tmp', JSON.stringify(data)); fs.renameSync(f + '.tmp', f);
    const files = fs.readdirSync(BACKUPS).filter(n => /^pos-.*\.json$/.test(n));
    const man = files.filter(n => n.includes('-manual')).sort().reverse(), auto = files.filter(n => !n.includes('-manual')).sort().reverse();
    [...man.slice(10), ...auto.slice(30)].forEach(n => { try { fs.unlinkSync(path.join(BACKUPS, n)); } catch {} });
    return name;
  }
  const listBackups = () => fs.readdirSync(BACKUPS).filter(n => /^pos-.*\.json$/.test(n)).sort().reverse()
    .map(n => ({ name: n, size: fs.statSync(path.join(BACKUPS, n)).size, at: fs.statSync(path.join(BACKUPS, n)).mtimeMs, manual: n.includes('-manual') }));

  // ---------- ตรวจความถูกต้องของข้อมูล (และซ่อมเรื่องเล็กๆ) ----------
  let lastIntegrity = null;
  function integrity() {
    const issues = []; let repaired = 0;
    const note = m => { if (issues.length < 30) issues.push(m); };
    if (!Array.isArray(ctx.orders)) note('orders.json ไม่ใช่รายการ');
    (Array.isArray(ctx.orders) ? ctx.orders : []).forEach(o => {
      if (!o || typeof o !== 'object') return note('พบออเดอร์ที่ข้อมูลเสีย');
      if (!Array.isArray(o.history)) { o.history = []; repaired++; }
      if (!o.payment || typeof o.payment !== 'object') { o.payment = { method: 'promptpay', slip: false }; repaired++; }
      if (!o.discount) { o.discount = {}; repaired++; }
      if (!Array.isArray(o.items)) note(`ออเดอร์ ${o.id}: ไม่มีรายการสินค้า`);
      if (!(o.total >= 0)) note(`ออเดอร์ ${o.id}: ยอดรวมผิดปกติ`);
      if (!STATUS_TEXT[o.status]) note(`ออเดอร์ ${o.id}: สถานะไม่รู้จัก (${o.status})`);
      if (Array.isArray(o.items) && o.subtotal != null && Math.abs(o.items.reduce((s, i) => s + i.unitPrice * i.qty, 0) - o.subtotal) > 0.5) note(`ออเดอร์ ${o.id}: ยอดไม่ตรงกับรายการ`);
    });
    if (!ctx.menu || !Array.isArray(ctx.menu.items) || !Array.isArray(ctx.menu.categories)) note('menu.json โครงสร้างผิด');
    if (ctx.users && typeof ctx.users === 'object') Object.entries(ctx.users).forEach(([e, u]) => { if (!(u.points >= 0)) { u.points = 0; repaired++; note(`สมาชิก ${e}: แต้มผิดปกติ (แก้เป็น 0)`); } });
    if (repaired) { ctx.saveOrders(); ctx.saveUsers(); audit('system', 'integrity.repair', `ซ่อมข้อมูลอัตโนมัติ ${repaired} จุด`); }
    lastIntegrity = { at: Date.now(), orders: (ctx.orders || []).length, users: Object.keys(ctx.users || {}).length, issues, repaired, recovered: ctx.recovered || [] };
    return lastIntegrity;
  }

  // ---------- งานเบื้องหลังทุกนาที ----------
  let lastSlipClean = 0;
  function sweep() {
    const cfg = S(), now = Date.now();
    if (cfg.cashHoldMinutes) {   // เงินสดที่ร้านไม่ยืนยันภายในเวลา → ยกเลิก (คืนสต็อก/แต้ม/คูปอง)
      ctx.orders.filter(o => o.status === 'payment_claimed' && o.payment.method === 'cash' && o.createdAt < now - cfg.cashHoldMinutes * 60000)
        .forEach(o => ctx.setStatus(o, 'rejected', 'system', 'ไม่ชำระเงินสดภายในเวลา'));
    }
    if (cfg.slipRetentionDays && now - lastSlipClean > 3600e3) {   // ลบรูปสลิปเก่า (ความเป็นส่วนตัว)
      lastSlipClean = now; const cutoff = now - cfg.slipRetentionDays * 864e5; let n = 0;
      ctx.orders.forEach(o => {
        if (o.payment && typeof o.payment.slip === 'string' && o.createdAt < cutoff && !['pending_payment', 'payment_claimed'].includes(o.status)) {
          try { fs.unlinkSync(path.join(SLIPS, o.payment.slip)); } catch {} o.payment.slip = false; o.payment.slipDeleted = true; n++;
        }
      });
      if (n) { ctx.saveOrders(); audit('system', 'slip.cleanup', `ลบสลิปเก่า ${n} รูป (เกิน ${cfg.slipRetentionDays} วัน)`); }
    }
  }
  setInterval(() => { try { snapshot(false); } catch (e) { console.warn('backup failed:', e.message); } }, 30 * 60000);
  try { snapshot(false); integrity(); } catch (e) { console.warn('startup check failed:', e.message); }

  // ---------- รายงานยอดขาย ----------
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const dayMs = s => Date.parse(s + 'T00:00:00Z');
  const addDays = (s, n) => new Date(dayMs(s) + n * 864e5).toISOString().slice(0, 10);
  const itemCat = i => { if (i.cat) return i.cat; const m = ctx.menu.items.find(x => x.id === i.menuId); const c = m && ctx.menu.categories.find(x => x.id === m.category); return c ? c.name : 'ไม่ระบุหมวด'; };
  const factor = o => (o.subtotal ? o.total / o.subtotal : 1);   // สัดส่วนหลังหักส่วนลดทั้งออเดอร์
  const rng = (from, to) => ctx.orders.filter(o => { const d = dayKey(o.createdAt); return d >= from && d <= to; });
  function normRange(q) {
    let to = isDate(q.to) ? q.to : dayKey(Date.now()), from = isDate(q.from) ? q.from : addDays(to, -6);
    if (from > to) [from, to] = [to, from];
    if (dayMs(to) - dayMs(from) > 366 * 864e5) from = addDays(to, -366);
    return { from, to };
  }
  function buildReport(from, to) {
    const rows = rng(from, to), done = rows.filter(o => o.status === 'done');
    const byDay = {}, byHour = Array(24).fill(0), hourRev = Array(24).fill(0), byWeekday = Array.from({ length: 7 }, () => ({ orders: 0, revenue: 0 }));
    const pay = { promptpay: 0, cash: 0 }, cat = {}, item = {}, cust = {};
    let discount = 0, gross = 0, qty = 0, revenue = 0;
    done.forEach(o => {
      const d = dayKey(o.createdAt), h = hourOf(o.createdAt), w = new Date(o.createdAt + BKK).getUTCDay(), f = factor(o);
      revenue += o.total; byDay[d] = byDay[d] || { day: d, orders: 0, revenue: 0 }; byDay[d].orders++; byDay[d].revenue += o.total;
      byHour[h]++; hourRev[h] += o.total; byWeekday[w].orders++; byWeekday[w].revenue += o.total;
      pay[o.payment.method] = (pay[o.payment.method] || 0) + o.total;
      discount += (o.discount && o.discount.couponAmt || 0) + (o.discount && o.discount.pointsAmt || 0);
      (cust[o.email] = cust[o.email] || { email: o.email, name: o.name, orders: 0, spent: 0 }); cust[o.email].orders++; cust[o.email].spent += o.total;
      o.items.forEach(i => {
        const c = itemCat(i), g = i.unitPrice * i.qty, n = g * f; gross += g; qty += i.qty;
        const C = (cat[c] = cat[c] || { name: c, qty: 0, gross: 0, net: 0, ids: new Set() }); C.qty += i.qty; C.gross += g; C.net += n; C.ids.add(o.id);
        const k = c + '\u0001' + i.name, I = (item[k] = item[k] || { name: i.name, cat: c, qty: 0, gross: 0, net: 0 }); I.qty += i.qty; I.gross += g; I.net += n;
      });
    });
    const firstDone = {}; ctx.orders.forEach(o => { if (o.status === 'done' && (!firstDone[o.email] || o.createdAt < firstDone[o.email])) firstDone[o.email] = o.createdAt; });
    const customers = Object.values(cust), isNew = c => { const d = dayKey(firstDone[c.email] || 0); return d >= from && d <= to; };
    const reasons = {}; rows.filter(o => o.status === 'rejected').forEach(o => { const r = o.rejectReason || 'ไม่ระบุเหตุผล'; reasons[r] = (reasons[r] || 0) + 1; });
    const len = Math.round((dayMs(to) - dayMs(from)) / 864e5) + 1, pTo = addDays(from, -1), pFrom = addDays(pTo, -(len - 1)), pd = rng(pFrom, pTo).filter(o => o.status === 'done');
    const r0 = n => Math.round(n);
    const items = Object.values(item).map(i => ({ ...i, gross: r0(i.gross), net: r0(i.net) })).sort((a, b) => b.qty - a.qty || b.net - a.net);
    return {
      from, to, days: len, orders: done.length, revenue, gross: r0(gross), qty, avg: done.length ? Math.round(revenue / done.length) : 0, discount,
      cancelled: rows.filter(o => o.status === 'rejected').length, cancelReasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      pay, byHour, hourRev, byWeekday, byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
      categories: Object.values(cat).map(c => ({ name: c.name, qty: c.qty, gross: r0(c.gross), net: r0(c.net), orders: c.ids.size })).sort((a, b) => b.net - a.net),
      items, top: items.slice(0, 10).map(i => ({ name: i.name, qty: i.qty, revenue: i.net })),
      customers: { count: customers.length, fresh: customers.filter(isNew).length, returning: customers.filter(c => !isNew(c)).length, top: customers.sort((a, b) => b.spent - a.spent).slice(0, 10) },
      prev: { from: pFrom, to: pTo, orders: pd.length, revenue: pd.reduce((s, o) => s + o.total, 0) },
    };
  }
  function salesLines(from, to) {
    const out = [];
    rng(from, to).filter(o => o.status === 'done').sort((a, b) => a.createdAt - b.createdAt).forEach(o => {
      const f = factor(o), t = new Date(o.createdAt + BKK).toISOString();
      o.items.forEach(i => out.push({ date: t.slice(0, 10), time: t.slice(11, 16), queueNo: o.queueNo, orderId: o.id, item: i.name, category: itemCat(i), options: (i.options || []).map(x => x.name).join(' '),
        qty: i.qty, unitPrice: i.unitPrice, gross: i.unitPrice * i.qty, net: Math.round(i.unitPrice * i.qty * f * 100) / 100, payment: o.payment.method, customer: o.name, email: o.email }));
    });
    return out;
  }

  // ---------- เส้นทาง API ----------
  app.get('/api/admin/report', auth, ownerOnly, (req, res) => { const { from, to } = normRange(req.query); res.json(buildReport(from, to)); });
  app.get('/api/admin/sales-lines', auth, ownerOnly, (req, res) => { const { from, to } = normRange(req.query); audit(req.user, 'export.sales', `${from} → ${to}`, req); res.json(salesLines(from, to)); });

  app.get('/api/admin/audit', auth, ownerOnly, (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    res.json(readAudit(limit, str(req.query.q, 60).toLowerCase(), str(req.query.type, 30)));
  });

  app.get('/api/admin/security', auth, ownerOnly, (req, res) => {
    const cfg = S(), keys = Object.keys(LIMITS).concat(['requirePhone', 'ticketFooter', 'weekHours', 'closedDates']);
    res.json({
      limits: Object.fromEntries(keys.map(k => [k, cfg[k]])),
      bans: Object.entries(ctx.bans).map(([email, b]) => ({ email, name: (ctx.users[email] || {}).name || '', ...b })).sort((a, b) => b.at - a.at),
      abuse: ABUSE, integrity: lastIntegrity || integrity(), backups: listBackups(), devMode: ctx.DEV_MODE,
    });
  });

  const LIMITS = { maxItemsPerOrder: [1, 200], maxOrderAmount: [0, 100000], minOrderAmount: [0, 100000], maxPendingPerUser: [0, 20], maxOrdersPerUserPerDay: [0, 200],
    maxOpenOrders: [0, 1000], cancelBlockCount: [0, 20], busyExtraMinutes: [0, 120], cashHoldMinutes: [0, 240], slipRetentionDays: [0, 3650] };
  app.put('/api/admin/limits', auth, ownerOnly, (req, res) => {
    const b = req.body || {}, old = { ...S() }, s = ctx.settings;
    try {
      const next = {};
      for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
        const v = parseInt(b[k], 10); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`ค่า "${k}" ต้องอยู่ระหว่าง ${lo}–${hi}`); next[k] = v;
      }
      next.requirePhone = !!b.requirePhone; next.ticketFooter = str(b.ticketFooter, 100);
      if (b.weekHours == null) next.weekHours = null;
      else {
        if (!Array.isArray(b.weekHours) || b.weekHours.length !== 7) throw new Error('เวลาเปิดรายวันต้องมี 7 วัน');
        next.weekHours = b.weekHours.map(d => { if (!/^\d{2}:\d{2}$/.test(d.from) || !/^\d{2}:\d{2}$/.test(d.to)) throw new Error('รูปแบบเวลาไม่ถูกต้อง'); return { open: !!d.open, from: d.from, to: d.to }; });
      }
      const seen = new Set();
      next.closedDates = (Array.isArray(b.closedDates) ? b.closedDates : []).slice(0, 200).filter(c => isDate(c.date) && !seen.has(c.date) && seen.add(c.date)).map(c => ({ date: c.date, reason: str(c.reason, 60) })).sort((a, c) => a.date.localeCompare(c.date));
      Object.assign(s, next); ctx.saveSettings(); ctx.broadcastAll({ type: 'menu' });
      audit(req.user, 'settings.limits', changed(old, s), req);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/admin/bans', auth, ownerOnly, (req, res) => {
    const email = str(req.body.email, 100).toLowerCase();
    if (!ctx.users[email]) return res.status(404).json({ error: 'ไม่พบสมาชิกนี้' });
    if (ctx.roleOf(email) !== 'customer') return res.status(400).json({ error: 'ระงับบัญชีเจ้าของร้าน/พนักงานไม่ได้' });
    ctx.bans[email] = { at: Date.now(), by: req.user.email, reason: str(req.body.reason, 100) || 'ไม่ระบุเหตุผล' };
    ctx.saveBans(); audit(req.user, 'ban.add', `${email}: ${ctx.bans[email].reason}`, req); res.json({ ok: true });
  });
  app.post('/api/admin/bans/remove', auth, ownerOnly, (req, res) => {
    const email = str(req.body.email, 100).toLowerCase();
    if (!ctx.bans[email]) return res.status(404).json({ error: 'ไม่พบในรายชื่อที่ถูกระงับ' });
    delete ctx.bans[email]; ctx.saveBans(); audit(req.user, 'ban.remove', email, req); res.json({ ok: true });
  });

  app.post('/api/admin/backups', auth, ownerOnly, (req, res) => {
    try { const name = snapshot(true); audit(req.user, 'backup.create', name, req); res.json({ name, backups: listBackups() }); }
    catch (e) { res.status(500).json({ error: 'สำรองข้อมูลไม่สำเร็จ: ' + e.message }); }
  });
  app.get('/api/admin/backups/:name', auth, ownerOnly, (req, res) => {
    const n = req.params.name; if (!/^pos-[\d-]+(_\d{6}-manual)?\.json$/.test(n)) return res.status(400).json({ error: 'ชื่อไฟล์ไม่ถูกต้อง' });
    const f = path.join(BACKUPS, n); if (!fs.existsSync(f)) return res.status(404).json({ error: 'ไม่พบไฟล์สำรอง' });
    audit(req.user, 'backup.download', n, req); res.download(f, n);
  });

  return { clientIp, audit, noteAbuse, checkOrderLimits, dedupe, sweep, changed, integrity, snapshot };
};
