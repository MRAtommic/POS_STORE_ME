// ================= หลังร้าน =================
let orders = [], MENU = null, SET = null, STATS = null, tab = 'orders', ofilter = 'all', liveQ = '';
let soundOn = (() => { try { return localStorage.getItem('pos_sound') !== '0'; } catch { return true; } })();
let compactOrders = (() => { try { return localStorage.getItem('pos_compact') === '1'; } catch { return false; } })();
const FRESH = new Set();
let _wasDisconnected = false;
let _wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator && soundOn && !document.hidden) {
    try {
      if (!_wakeLock) {
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
      }
    } catch {}
  }
}
function releaseWakeLock() {
  if (_wakeLock) {
    try { _wakeLock.release(); } catch {}
    _wakeLock = null;
  }
}

async function syncOrders() {
  try {
    const freshOrders = await api('/api/admin/orders');
    const oldIds = new Set(orders.map(o => o.id));
    freshOrders.forEach(o => {
      if (!oldIds.has(o.id)) {
        onOrder(o);
      }
    });
    orders = freshOrders;
    await refreshStats();
    if (tab === 'orders') renderOrderList();
  } catch {}
}

const ymd = d => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const today = () => ymd(new Date());
const daysAgo = n => ymd(new Date(Date.now() - n * 864e5));
const isActive = o => !['done', 'rejected'].includes(o.status);
const view = () => $('#view');

const NAV = [
  { id: 'orders', label: 'ออเดอร์', icon: 'receipt' }, { id: 'stock', label: 'สต็อก', icon: 'box' },
  { id: 'menu', label: 'เมนู', icon: 'utensils', owner: true }, { id: 'report', label: 'รายงาน', icon: 'chart', owner: true },
  { id: 'history', label: 'ประวัติ', icon: 'history' }, { id: 'coupons', label: 'คูปอง', icon: 'tag', owner: true },
  { id: 'members', label: 'สมาชิก', icon: 'users', owner: true }, { id: 'qr', label: 'QR ร้าน', icon: 'qr' },
  { id: 'settings', label: 'ตั้งค่า', icon: 'settings', owner: true },
];
const VIEWS = { orders: viewOrders, stock: viewStock, menu: viewMenu, report: viewReport, history: viewHistory, coupons: viewCoupons, members: viewMembers, qr: viewQR, settings: viewSettings };

(async function boot() {
  await initAuth();
  if (!ME.isAdmin) {
    document.body.innerHTML = `<div class="page"><div class="empty"><div class="e"></div><div class="b">บัญชี ${esc(ME.email)} ไม่ใช่เจ้าของร้าน/พนักงาน</div><p class="small muted mt-s">ให้เจ้าของเพิ่มอีเมลนี้เป็นพนักงานในหน้าตั้งค่า</p>
      <a class="btn primary mt" href="index.html">กลับหน้าลูกค้า</a> <button class="btn ghost mt" onclick="logout()">เปลี่ยนบัญชี</button></div></div>`;
    return;
  }
  [orders, MENU, SET] = await Promise.all([api('/api/admin/orders'), api('/api/admin/menu'), api('/api/admin/settings')]);
  buildNav(); renderTop(); await refreshStats();
  const h = location.hash.slice(1); show(NAV.some(n => n.id === h && (!n.owner || ME.isOwner)) ? h : 'orders');
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== tab && VIEWS[t]) show(t); });
  $('#soundBtn').onclick = toggleSound; renderSound();
  const updAdmTheme = () => {
    const atb = $('#admThemeBtn');
    if (!atb) return;
    const isDark = getTheme() === 'dark';
    atb.innerHTML = icon(isDark ? 'sun' : 'moon', 20);
    atb.title = isDark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด';
  };
  const atb = $('#admThemeBtn');
  if (atb) {
    updAdmTheme();
    atb.onclick = () => { toggleTheme(); updAdmTheme(); };
    document.addEventListener('themechange', updAdmTheme);
  }
  if (soundOn) { unlockAudio(); requestWakeLock(); }
  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => { unlockAudio(); if (soundOn) requestWakeLock(); }, { passive: true });
  });
  $('#accSw').onchange = async e => { try { await api('/api/admin/accepting', { method: 'POST', body: { accepting: e.target.checked } }); SET.accepting = e.target.checked; renderTop(); toast(SET.accepting ? 'เปิดรับออเดอร์แล้ว' : 'ปิดรับออเดอร์แล้ว', 'ok'); } catch (err) { toast(err.message, 'err'); renderTop(); } };
  connectWS(onOrder, async m => {
    if (m.type === 'menu') { [MENU, SET] = await Promise.all([api('/api/admin/menu'), api('/api/admin/settings')]); renderTop(); if (['stock'].includes(tab)) show(tab, true); }
    if (m.type === 'order_ack') { handleOrderAck(m.orderId, m.queueNo, m.by); }
    if (m.type === 'inventory') {
      invItems = m.items || [];
      if (tab === 'stock' && stockSub === 'raw') drawInventory();
    }
  },
    async ok => {
      $('#conn').classList.toggle('off', !ok);
      $('#connTxt').textContent = ok ? 'เชื่อมต่อแบบเรียลไทม์' : 'หลุดการเชื่อมต่อ กำลังต่อใหม่…';
      if (ok) {
        if (_wasDisconnected) {
          toast('เชื่อมต่อสำเร็จ ดึงข้อมูลใหม่แล้ว', 'ok');
          await syncOrders();
          _wasDisconnected = false;
        }
      } else {
        _wasDisconnected = true;
      }
    });
  setInterval(async () => { if (tab === 'orders' && !document.hidden && !$('.overlay')) await syncOrders(); }, 30000);
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { if (soundOn) requestWakeLock(); await syncOrders(); } });
})();

// ---------- โครงหน้า ----------
function navItems() { return NAV.filter(n => !n.owner || ME.isOwner); }
function buildNav() {
  const items = navItems();
  $('#side').innerHTML = `<div class="brand"><div>${esc(CFG.shopName)}<div class="tiny muted">${ME.isOwner ? 'เจ้าของร้าน' : 'พนักงาน'}</div></div></div>` +
    items.map(n => `<button class="nav" data-t="${n.id}">${icon(n.icon, 20)}${n.label}${n.id === 'orders' ? `<span class="n zero" data-badge="orders">0</span>` : ''}</button>`).join('') +
    `<div class="grow"></div><a class="nav" href="index.html">${icon('home', 20)}หน้าลูกค้า</a><a class="nav" href="queue.html" target="_blank">${icon('grid', 20)}จอคิว</a><button class="nav" id="lo">${icon('logout', 20)}ออกจากระบบ</button>`;
  const main = items.length <= 5 ? items : items.slice(0, 4), more = items.length <= 5 ? [] : items.slice(4);
  $('#tabbar').innerHTML = main.map(n => `<button data-t="${n.id}">${icon(n.icon, 22)}${n.label}${n.id === 'orders' ? `<span class="dot zero" data-badge="orders">0</span>` : ''}</button>`).join('') + (more.length ? `<button id="moreBtn">${icon('more', 22)}เพิ่มเติม</button>` : '');
  $$('[data-t]').forEach(b => (b.onclick = () => show(b.dataset.t)));
  $('#lo').onclick = async () => { if (await confirmSheet({ title: 'ออกจากระบบ?', ok: 'ออกจากระบบ', danger: true })) logout(); };
  const mb = $('#moreBtn');
  if (mb) mb.onclick = () => {
    const s = openSheet({ title: 'เมนูเพิ่มเติม', body: more.map(n => `<button class="mrow" style="width:100%;background:none;border:0;text-align:left" data-go="${n.id}"><span class="icon-btn">${icon(n.icon)}</span><b class="grow">${n.label}</b>${icon('chevR', 18, 'faint')}</button>`).join('') +
      `<a class="mrow" href="queue.html" target="_blank" style="text-decoration:none;color:inherit"><span class="icon-btn">${icon('grid')}</span><b class="grow">จอแสดงคิว</b>${icon('chevR', 18, 'faint')}</a>
       <a class="mrow" href="index.html" style="text-decoration:none;color:inherit"><span class="icon-btn">${icon('home')}</span><b class="grow">หน้าลูกค้า</b>${icon('chevR', 18, 'faint')}</a>
       <button class="mrow" style="width:100%;background:none;border:0;text-align:left" id="lo2"><span class="icon-btn">${icon('logout')}</span><b class="grow">ออกจากระบบ</b></button>` });
    s.qa('[data-go]').forEach(b => (b.onclick = () => { s.close(); show(b.dataset.go); }));
    s.q('#lo2').onclick = () => { s.close(); $('#lo').click(); };
  };
}
function renderTop() {
  $('#shopName').textContent = CFG.shopName; $('#accSw').checked = SET.accepting;
  $('#accTxt').textContent = SET.accepting ? 'รับออเดอร์' : 'ปิดรับ'; $('#accTxt').style.color = SET.accepting ? 'var(--ok)' : 'var(--bad)';
}
function renderSound() {
  const btn = $('#soundBtn');
  if (!btn) return;
  btn.textContent = soundOn ? 'ปิดเสียง' : 'เปิดเสียง';
  btn.classList.toggle('soft', soundOn);
  btn.classList.toggle('ghost', !soundOn);
}
function toggleSound() {
  soundOn = !soundOn; try { localStorage.setItem('pos_sound', soundOn ? '1' : '0'); } catch {}
  renderSound(); toast(soundOn ? 'เปิดเสียงแจ้งเตือนแล้ว' : 'ปิดเสียงแจ้งเตือนแล้ว', soundOn ? 'ok' : '');
  if (soundOn) {
    requestWakeLock();
    ding(2);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } else {
    releaseWakeLock();
  }
  if (tab === 'orders') renderSoundBanner();
}
function setBadges() {
  const pendingPay = orders.filter(o => o.status === 'payment_claimed').length;
  const activeOrders = orders.filter(o => ['pending_payment', 'payment_claimed', 'paid', 'preparing', 'ready'].includes(o.status)).length;
  $$('[data-badge=orders]').forEach(b => {
    b.hidden = false;
    b.textContent = activeOrders;
    b.classList.toggle('zero', activeOrders === 0);
    b.classList.toggle('active', activeOrders > 0 && pendingPay === 0);
    b.classList.toggle('alert', pendingPay > 0);
    b.setAttribute('title', activeOrders ? `${activeOrders} ออเดอร์ที่กำลังดำเนินการ (${pendingPay} รอตรวจเงิน)` : 'ไม่มีออเดอร์ค้าง (0 ออเดอร์)');
  });
  document.title = (activeOrders ? `(${activeOrders}) ` : '') + 'หลังร้าน · ' + (CFG.shopName || 'เครป ริมคลอง');
}
function show(t, keep) {
  tab = t; if (!keep) { if (location.hash.slice(1) !== t) history.replaceState(null, '', '#' + t); window.scrollTo(0, 0); }
  $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  const mb = $('#moreBtn'); if (mb) mb.classList.toggle('on', !$('#tabbar [data-t].on'));
  setBadges(); view().onclick = null; view().onchange = null; VIEWS[t]();
}
async function refreshStats() { try { STATS = await api('/api/admin/stats'); } catch {} setBadges(); if (tab === 'orders') renderKpis(); }

function onOrder(o) {
  const i = orders.findIndex(x => x.id === o.id), prev = i >= 0 ? orders[i].status : null;
  if (i >= 0) orders[i] = o; else orders.unshift(o);
  if (typeof alertEvent === 'function') alertEvent(o, prev);   // admin2.js: เสียงเรียก + เสียงพูด (ดังเมื่อ "แจ้งโอน/เงินสด" ไม่ดังตอนแค่กดสั่ง)
  else if (!prev || (prev !== o.status && o.status === 'payment_claimed')) {
    FRESH.add(o.id); if (soundOn) ding(3); buzz(200);
    toast(`ออเดอร์ใหม่ #${o.queueNo} · ${baht(o.total)}`, 'ok');
    if (soundOn && 'Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(`ออเดอร์ใหม่ #${o.queueNo} ${baht(o.total)}`, { body: o.items.map(x => x.name + '×' + x.qty).join(', ') });
  }
  refreshStats(); if (tab === 'orders') renderOrderList();
}

function handleOrderAck(orderId, queueNo, by = 'LINE') {
  FRESH.delete(orderId);
  const o = orders.find(x => x.id === orderId);
  if (o) {
    o.acknowledged = true;
    o.acknowledgedViaLine = true;
  }
  if (typeof window.stopRing === 'function') window.stopRing();
  if (typeof window.speechSynthesis !== 'undefined') {
    try { window.speechSynthesis.cancel(); } catch {}
  }
  toast(`🔕 ทราบแล้ว คิว #${queueNo} (ปิดเสียงเตือนผ่าน ${by})`, 'ok');
  if (typeof renderNewBar === 'function') renderNewBar();
  if (typeof renderOrderList === 'function' && tab === 'orders') renderOrderList();
}

// ================= ออเดอร์ =================
const PRIMARY = {
  pending_payment: ['paid', 'ยืนยันรับเงินแล้ว', 'ok', 'check'], payment_claimed: ['paid', 'ยืนยันรับเงิน', 'ok', 'check'],
  paid: ['preparing', 'เริ่มทำ', 'primary', 'flame'], preparing: ['ready', 'ทำเสร็จ · เรียกลูกค้า', 'primary', 'bell2'], ready: ['done', 'ลูกค้ารับแล้ว · ปิดออเดอร์', 'ok', 'check'],
};
const PRIO = { payment_claimed: 0, paid: 1, preparing: 2, ready: 3, pending_payment: 4 };
const OFILTERS = [['all', 'ทั้งหมด', o => isActive(o)], ['check', 'รอตรวจเงิน', o => o.status === 'payment_claimed'], ['cook', 'ต้องทำ', o => ['paid', 'preparing'].includes(o.status)],
  ['ready', 'พร้อมรับ', o => o.status === 'ready'], ['wait', 'รอลูกค้าจ่าย', o => o.status === 'pending_payment'], ['closed', 'ปิดแล้ว', o => !isActive(o)]];
const ageText = o => { const m = Math.floor((Date.now() - o.createdAt) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : timeTH(o.createdAt); };

function ocard(o, actions = true) {
  const d = o.discount || {}, p = PRIMARY[o.status], m = Math.floor((Date.now() - o.createdAt) / 60000);
  const late = isActive(o) && o.status !== 'pending_payment' && m >= 10;
  const isClosed = !isActive(o);

  const chips = [
    o.acknowledgedViaLine ? `<span class="ochip" style="background:var(--surface-2);color:var(--ok);border:1px solid var(--ok);font-weight:700">🔕 ทราบผ่าน LINE แล้ว</span>` : '',
    `<span class="ochip">${ORDER_TYPE[o.orderType] || 'สั่งกลับบ้าน'}</span>`,
    o.table ? `<span class="ochip"><b>โต๊ะ ${esc(o.table)}</b></span>` : '',
    o.phone ? `<span class="ochip">${esc(o.phone)}</span>` : '',
    `<span class="ochip ${late ? 'late' : ''}">${ageText(o)}</span>`
  ].filter(Boolean).join('');

  return `<div class="oc st-${o.status} ${FRESH.has(o.id) ? 'fresh' : ''} ${compactOrders ? 'compact' : ''} ${compactOrders && isClosed ? 'oc-closed' : ''}" data-oid="${esc(o.id)}">
    <div class="oc-h">
      <div class="oc-r1"><div class="qn">#${o.queueNo}</div><div class="oc-st">${statusPill(o.status)}</div></div>
      <div class="oc-r2"><div class="b oc-name">${esc(o.name)}</div></div>
      <div class="oc-r3">${chips}</div>
    </div>
    <div class="oc-b">${o.items.map(i => `<div class="li"><div class="q">${i.qty}</div><div class="grow"><div class="b">${esc(i.name)}</div>
        ${optionText(i) ? `<div class="small muted">${esc(optionText(i))}</div>` : ''}${i.note ? `<div class="note">หมายเหตุ: ${esc(i.note)}</div>` : ''}</div></div>`).join('')}
      ${d.couponAmt || d.pointsAmt ? `<div class="small muted mt-s">ส่วนลด: ${d.couponAmt ? `คูปอง ${esc(d.coupon)} −${d.couponAmt}` : ''} ${d.pointsAmt ? `แต้ม −${d.pointsAmt}` : ''}</div>` : ''}
      ${o.rejectReason ? `<div class="small mt-s" style="color:var(--bad)">เหตุผลยกเลิก: ${esc(o.rejectReason)}</div>` : ''}
      <div class="row between mt"><span class="pill">${icon(o.payment.method === 'cash' ? 'cash' : 'phone', 13)}${o.payment.method === 'cash' ? 'เงินสด' : 'พร้อมเพย์'}${o.payment.slip ? ' · มีสลิป' : ''}</span><span class="price" style="font-size:20px">${baht(o.total)}</span></div></div>
    <div class="oc-f">${actions && p ? `<button class="btn ${p[2]} lg block" data-a="status" data-id="${esc(o.id)}" data-s="${p[0]}">${icon(p[3], 20)}${p[1]}</button>` : ''}
      <div class="row">${o.payment.slip ? `<button class="btn sm ghost grow" data-a="slip" data-id="${esc(o.id)}">${icon('image', 15)}ดูสลิป</button>` : ''}
        <button class="btn sm ghost grow" data-a="print" data-id="${esc(o.id)}">${icon('printer', 15)}พิมพ์</button>
        ${(actions && TRANS_REJECT.includes(o.status)) || (!actions && o.status === 'done') ? `<button class="btn sm bad-soft grow" data-a="status" data-id="${esc(o.id)}" data-s="rejected">${icon('x', 15)}${o.status === 'done' ? 'ยกเลิก/โมฆะ' : 'ยกเลิก'}</button>` : ''}</div></div></div>`;
}
const TRANS_REJECT = ['pending_payment', 'payment_claimed', 'paid', 'preparing', 'ready', 'done'];

function viewOrders() {
  view().innerHTML = `<div id="soundBanner"></div><div class="kpis" id="kpis"></div>
    <div class="row mb wrap gap-s between">
      <div class="search grow" style="min-width:220px"><input id="liveQ" type="search" placeholder="ค้นหาเลขคิว / ชื่อลูกค้า" value="${esc(liveQ)}" autocomplete="off">${icon('search', 18)}</div>
      <button class="btn sm ${compactOrders ? 'soft' : 'ghost'}" id="toggleCompact">${compactOrders ? 'มุมมองเต็ม' : 'มุมมองย่อ'}</button>
    </div>
    <div class="chips" id="ochips" style="margin-top:-6px"></div><div class="grid" id="olist"></div>`;
  $('#liveQ').oninput = e => { liveQ = e.target.value.trim().toLowerCase(); renderOrderList(); };
  $('#toggleCompact').onclick = () => {
    compactOrders = !compactOrders;
    try { localStorage.setItem('pos_compact', compactOrders ? '1' : '0'); } catch {}
    viewOrders();
  };
  view().onclick = viewClick;
  renderKpis(); renderSoundBanner(); renderOrderList();
}
function renderSoundBanner() {
  const b = $('#soundBanner'); if (!b) return;
  b.innerHTML = soundOn ? '' : `<div class="banner">${icon('bellOff', 18)}<span class="grow">ยังไม่ได้เปิดเสียงแจ้งเตือน — อาจพลาดออเดอร์ใหม่</span><button class="btn sm primary" id="enSound">เปิดเสียง</button></div>`;
  const e = $('#enSound'); if (e) e.onclick = toggleSound;
}
function renderKpis() {
  const el = $('#kpis'); if (!el || !STATS) return;
  el.innerHTML = [['รอตรวจเงิน', STATS.waitingPay, 'clock', STATS.waitingPay ? 'color:var(--warn)' : ''], ['กำลังดำเนินการ', STATS.active, 'flame', ''], ['สำเร็จวันนี้', STATS.doneCount, 'check', ''], ['ยอดขายวันนี้', baht(STATS.revenue), 'cash', 'color:var(--pri-600)']]
    .map(k => `<div class="kpi"><div class="k">${icon(k[2], 14)}${k[0]}</div><div class="v" style="${k[3]}">${k[1]}</div></div>`).join('');
}
function renderOrderList() {
  const list = $('#olist'); if (!list) return;
  const f = OFILTERS.find(x => x[0] === ofilter) || OFILTERS[0];
  $('#ochips').innerHTML = OFILTERS.map(x => { const n = orders.filter(x[2]).length; return `<button class="chip pri ${x[0] === ofilter ? 'on' : ''}" data-f="${x[0]}">${x[1]}${n && x[0] !== 'closed' ? `<span class="n">${n}</span>` : ''}</button>`; }).join('');
  $$('#ochips .chip').forEach(c => (c.onclick = () => { ofilter = c.dataset.f; renderOrderList(); }));
  let rows = orders.filter(f[2]).filter(o => !liveQ || (`#${o.queueNo} ${o.name}`).toLowerCase().includes(liveQ));
  rows = ofilter === 'closed' ? rows.sort((a, b) => b.createdAt - a.createdAt) : rows.sort((a, b) => (PRIO[a.status] - PRIO[b.status]) || a.createdAt - b.createdAt);
  list.innerHTML = rows.map(o => ocard(o)).join('') || `<div class="empty" style="grid-column:1/-1"><div class="e"></div><div class="b">${ofilter === 'closed' ? 'ยังไม่มีออเดอร์ที่ปิดแล้ว' : 'ไม่มีออเดอร์ที่ต้องทำ'}</div><p class="small muted mt-s">ออเดอร์ใหม่จะเด้งขึ้นที่นี่ทันที</p></div>`;
}
async function viewClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const o = orders.find(x => x.id === b.dataset.id) || (typeof histRows !== 'undefined' && histRows.find(x => x.id === b.dataset.id));
  if (b.dataset.a === 'status') return setStatus(o, b.dataset.s);
  if (b.dataset.a === 'print') return printOrder(o);
  if (b.dataset.a === 'slip') return showSlip(o);
}
async function setStatus(o, status) {
  let reason = '';
  if (status === 'rejected') {
    const isDone = o.status === 'done';
    const r = await formSheet({
      title: `ยกเลิกออเดอร์ #${o.queueNo}`,
      intro: isDone
        ? 'ยกเลิกรายการนี้: ยอดขายจะถูกหักออกทันที ระบบคืนสต็อกและดึงแต้มสะสมคืนให้อัตโนมัติ'
        : 'ลูกค้าจะเห็นเหตุผลนี้ และระบบคืนสต็อก/แต้ม/คูปองให้อัตโนมัติ',
      ok: 'ยืนยันยกเลิก',
      danger: true,
      fields: [{
        id: 'reason',
        label: 'เหตุผล',
        value: isDone ? 'กดสั่งผิด / ผิดพลาด' : 'ไม่ได้รับเงิน',
        chips: ['กดสั่งผิด / ผิดพลาด', 'ลูกค้าขอยกเลิก', 'ไม่ได้รับเงิน', 'ยอดโอนไม่ตรง', 'ของหมด', 'ออเดอร์ทดสอบ']
      }]
    });
    if (!r) return; reason = r.reason;
  }
  FRESH.delete(o.id);
  try {
    const updated = await api(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: { status, reason } });
    buzz(20);
    toast(status === 'rejected' ? 'ยกเลิกออเดอร์และปรับยอดขายแล้ว' : 'อัปเดตสถานะแล้ว', 'ok');
    // อัปเดตใน orders / histRows ทันที
    const idx = orders.findIndex(x => x.id === o.id);
    if (idx >= 0) orders[idx] = updated;
    if (typeof histRows !== 'undefined') {
      const hidx = histRows.findIndex(x => x.id === o.id);
      if (hidx >= 0) histRows[hidx] = updated;
    }
    await refreshStats();
    if (tab === 'orders') renderOrderList();
    else if (tab === 'history') drawHist();
    else if (tab === 'report') viewReport();
  } catch (e) { toast(e.message, 'err'); }
}
async function showSlip(o) {
  const r = await fetch(`/api/orders/${o.id}/slip`, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!r.ok) return toast('ไม่พบสลิป', 'err');
  const canOk = ['payment_claimed', 'pending_payment'].includes(o.status);
  const s = openSheet({ title: `สลิป · ออเดอร์ #${o.queueNo}`, body: `<div class="c mb"><span class="price" style="font-size:28px">${baht(o.total)}</span><div class="small muted">ตรวจยอดและชื่อผู้รับให้ตรงก่อนกดยืนยัน</div></div><img class="slip-prev" src="${URL.createObjectURL(await r.blob())}" alt="สลิป">`,
    footer: canOk ? `<div class="row"><button class="btn bad-soft grow" id="sRej">ปฏิเสธ</button><button class="btn ok grow" id="sOk">${icon('check', 18)}ยืนยันรับเงิน</button></div>` : '' });
  if (canOk) { s.q('#sOk').onclick = () => { s.close(); setStatus(o, 'paid'); }; s.q('#sRej').onclick = () => { s.close(); setStatus(o, 'rejected'); }; }
}
function printOrder(o) {
  const d = o.discount || {};
  const pa = $('#printArea'); pa.className = 'ticket';
  pa.innerHTML = `<div style="text-align:center"><b style="font-size:18px">${esc(CFG.shopName)}</b>${CFG.phone ? `<div style="font-size:14px">โทร ${esc(phoneFormat(CFG.phone))}</div>` : ''}<div style="font-size:32px;font-weight:800">#${o.queueNo}</div><div>${dateTH(o.createdAt)}</div></div>
    <div>${esc(o.name)}</div><hr>
    ${o.items.map(i => `<div><b>${esc(i.name)} ×${i.qty}</b> <span style="float:right">${baht(i.unitPrice * i.qty)}</span></div><div style="font-size:13px">${esc(optionText(i))}${i.note ? ' - ' + esc(i.note) : ''}</div>`).join('')}<hr>
    ${d.couponAmt ? `<div>คูปอง <span style="float:right">-${d.couponAmt}</span></div>` : ''}${d.pointsAmt ? `<div>แต้ม <span style="float:right">-${d.pointsAmt}</span></div>` : ''}
    <div><b>รวม</b> <b style="float:right">${baht(o.total)}</b></div><div>${o.payment.method === 'cash' ? 'เงินสด' : 'พร้อมเพย์'}</div><p style="text-align:center">${esc((SET && SET.ticketFooter) || 'ขอบคุณที่อุดหนุน')}</p>`;
  setTimeout(() => window.print(), 50);
}

// ================= ประวัติ =================
let histRows = [], hRange = [daysAgo(6), today()], hq = '';
async function viewHistory() {
  const [f, t] = hRange;
  view().innerHTML = `<div class="card"><div class="row wrap"><input type="date" id="hf" value="${f}" style="width:auto;flex:1"><span>–</span><input type="date" id="ht" value="${t}" style="width:auto;flex:1"></div>
    <div class="row wrap gap-s mt-s">${[['วันนี้', 0], ['เมื่อวาน', 1], ['7 วัน', 6], ['30 วัน', 29]].map(r => `<button class="chip" data-r="${r[1]}" data-l="${r[0]}">${r[0]}</button>`).join('')}</div>
    <div class="search mt"><input id="hq" type="search" placeholder="ค้นหาเลขคิว / ชื่อ" value="${esc(hq)}">${icon('search', 18)}</div></div><div id="hsum" class="small muted mb"></div><div class="grid" id="hlist"><div class="skel" style="height:160px"></div></div>`;
  const reload = () => { hRange = [$('#hf').value, $('#ht').value]; viewHistory(); };
  $('#hf').onchange = reload; $('#ht').onchange = reload;
  $$('[data-r]').forEach(b => (b.onclick = () => { const n = +b.dataset.r; hRange = [daysAgo(n), b.dataset.l === 'เมื่อวาน' ? daysAgo(1) : today()]; viewHistory(); }));
  $('#hq').oninput = e => { hq = e.target.value.trim().toLowerCase(); drawHist(); };
  view().onclick = viewClick;
  try { histRows = await api(`/api/admin/orders?from=${f}&to=${t}`); } catch (e) { return toast(e.message, 'err'); }
  drawHist();
}
function drawHist() {
  const rows = histRows.filter(o => !hq || (`#${o.queueNo} ${o.name}`).toLowerCase().includes(hq)), done = rows.filter(o => o.status === 'done');
  $('#hsum').textContent = `${rows.length} ออเดอร์ · สำเร็จ ${done.length} · ยอดขาย ${baht(done.reduce((s, o) => s + o.total, 0))}`;
  $('#hlist').innerHTML = rows.map(o => ocard(o, false)).join('') || '<div class="empty" style="grid-column:1/-1"><div class="e"></div>ไม่พบออเดอร์ในช่วงนี้</div>';
}

// ================= สต็อก =================
let stockSub = 'raw'; // 'raw' = สต็อกวัตถุดิบ & สินค้า, 'menu' = สต็อกเมนูขาย
let stockQ = '';
let invItems = [];
let invCat = 'all';
let invQ = '';
let invStatus = 'all'; // 'all', 'low'

const INV_CATEGORIES = [
  'แป้งและส่วนผสมหลัก',
  'นมและเครื่องดื่ม',
  'ท็อปปิ้งและไส้',
  'บรรจุภัณฑ์และของใช้',
  'อื่นๆ'
];

const INV_UNITS = [
  'กก.',
  'กรัม',
  'ลิตร',
  'มล.',
  'ถุง',
  'กระป๋อง',
  'ขวด',
  'กล่อง',
  'ฟอง',
  'ชิ้น',
  'แพ็ค',
  'แถว',
  'ลัง'
];

async function viewStock() {
  try {
    const res = await api('/api/admin/inventory');
    invItems = res.items || [];
  } catch (err) {
    invItems = [];
  }
  renderStockPage();
}

function renderStockPage() {
  view().innerHTML = `
    <div class="row wrap gap mb items-center" style="justify-content:space-between">
      <div class="segmented">
        <button class="seg-btn ${stockSub === 'raw' ? 'active' : ''}" id="stockSubRaw">สต็อกวัตถุดิบ & สินค้า (${invItems.length})</button>
        <button class="seg-btn ${stockSub === 'menu' ? 'active' : ''}" id="stockSubMenu">สต็อกเมนูขายหน้าร้าน (${MENU.items.length})</button>
      </div>
      ${stockSub === 'raw' ? `
        <button class="btn primary" id="addInvBtn">${icon('plus', 18)}เพิ่มรายการสต็อก</button>
      ` : ''}
    </div>
    <div id="stockSubView"></div>
  `;

  $('#stockSubRaw').onclick = () => { stockSub = 'raw'; renderStockPage(); };
  $('#stockSubMenu').onclick = () => { stockSub = 'menu'; renderStockPage(); };
  if ($('#addInvBtn')) $('#addInvBtn').onclick = () => invItemSheet(null);

  if (stockSub === 'raw') {
    drawInventory();
  } else {
    drawMenuStock();
  }
}

function drawInventory() {
  const container = $('#stockSubView');
  if (!container) return;

  const totalCount = invItems.length;
  const emptyCount = invItems.filter(i => i.qty === 0).length;
  const lowCount = invItems.filter(i => i.qty > 0 && i.minAlert > 0 && i.qty <= i.minAlert).length;
  const okCount = totalCount - emptyCount - lowCount;
  const totalCost = invItems.reduce((sum, i) => sum + (i.cost ? i.cost * i.qty : 0), 0);

  const cats = ['all', ...Array.from(new Set([...INV_CATEGORIES, ...invItems.map(i => i.category).filter(Boolean)]))];

  const q = invQ.trim().toLowerCase();
  const filtered = invItems.filter(i => {
    if (invCat !== 'all' && i.category !== invCat) return false;
    if (invStatus === 'low' && !(i.qty === 0 || (i.minAlert > 0 && i.qty <= i.minAlert))) return false;
    if (q && !i.name.toLowerCase().includes(q) && !(i.note && i.note.toLowerCase().includes(q))) return false;
    return true;
  });

  container.innerHTML = `
    <div class="inv-kpi-grid">
      <div class="inv-kpi">
        <div class="inv-kpi-num">${totalCount}</div>
        <div class="inv-kpi-lbl">ทั้งหมด (รายการ)</div>
      </div>
      <div class="inv-kpi">
        <div class="inv-kpi-num" style="color:var(--ok)">${okCount}</div>
        <div class="inv-kpi-lbl">สต็อกพร้อมใช้</div>
      </div>
      <div class="inv-kpi ${lowCount > 0 ? 'warn' : ''}">
        <div class="inv-kpi-num">${lowCount}</div>
        <div class="inv-kpi-lbl">ใกล้หมด (เตือน)</div>
      </div>
      <div class="inv-kpi ${emptyCount > 0 ? 'bad' : ''}">
        <div class="inv-kpi-num">${emptyCount}</div>
        <div class="inv-kpi-lbl">หมดสต็อก</div>
      </div>
      ${totalCost > 0 ? `
        <div class="inv-kpi">
          <div class="inv-kpi-num">฿${Math.round(totalCost).toLocaleString()}</div>
          <div class="inv-kpi-lbl">มูลค่าสต็อกรวม</div>
        </div>
      ` : ''}
    </div>

    <div class="row wrap gap mb items-center">
      <div class="search grow" style="min-width:240px">
        <input id="invSearchInput" type="search" placeholder="ค้นหาวัตถุดิบ / สินค้า..." value="${esc(invQ)}">
        ${icon('search', 18)}
      </div>
      <div class="row gap-s">
        <button class="chip ${invStatus === 'all' ? 'on pri' : ''}" id="invStatusAll">ทั้งหมด</button>
        <button class="chip ${invStatus === 'low' ? 'on' : ''}" id="invStatusLow" style="${invStatus === 'low' ? 'background:var(--bad);border-color:var(--bad)' : ''}">
          ใกล้หมด / หมดแล้ว ${lowCount + emptyCount > 0 ? `<span class="n">${lowCount + emptyCount}</span>` : ''}
        </button>
      </div>
    </div>

    <div class="chips mb">
      ${cats.map(c => `
        <button class="chip ${invCat === c ? 'on pri' : ''}" data-inv-cat="${esc(c)}">
          ${c === 'all' ? 'ทุกหมวดหมู่' : esc(c)}
        </button>
      `).join('')}
    </div>

    <div class="inv-list" id="invCardsList">
      ${filtered.length ? filtered.map(i => {
        const isEmpty = i.qty === 0;
        const isLow = !isEmpty && i.minAlert > 0 && i.qty <= i.minAlert;
        const statusBadge = isEmpty 
          ? `<span class="inv-badge bad">หมดสต็อก</span>`
          : isLow
            ? `<span class="inv-badge warn">ใกล้หมด (≤ ${i.minAlert} ${esc(i.unit)})</span>`
            : `<span class="inv-badge ok">พร้อมใช้</span>`;

        return `
          <div class="inv-card ${isEmpty ? 'is-empty' : isLow ? 'is-low' : ''}" data-inv-id="${esc(i.id)}">
            <div class="inv-row-top">
              <div class="inv-thumb-wrap" data-inv-upload="${esc(i.id)}" title="แตะเพื่อเปลี่ยน/ใส่รูปภาพ">
                ${i.image ? `
                  <img src="${esc(i.image)}" alt="${esc(i.name)}" class="inv-thumb">
                ` : `
                  <div class="inv-thumb-placeholder">
                    ${icon('camera', 20)}
                    <span class="inv-thumb-hint">ใส่รูป</span>
                  </div>
                `}
              </div>
              <div class="inv-name-wrap">
                <div class="inv-name">${esc(i.name)}</div>
                <div class="inv-meta">
                  <span class="ochip">${esc(i.category)}</span>
                  ${i.cost ? `<span>ต้นทุน ฿${i.cost}/${esc(i.unit)}</span>` : ''}
                  ${i.minAlert > 0 ? `<span>เกณฑ์เตือน ≤ ${i.minAlert} ${esc(i.unit)}</span>` : ''}
                  ${i.note ? `<span class="muted">(${esc(i.note)})</span>` : ''}
                </div>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div class="inv-row-actions">
              <div class="inv-qty-display">
                <span class="muted small">คงเหลือ:</span>
                <span class="inv-qty-num" style="${isEmpty ? 'color:var(--bad)' : isLow ? 'color:#ea580c' : ''}">${i.qty}</span>
                <span class="inv-qty-unit">${esc(i.unit)}</span>
              </div>

              <div class="inv-btns">
                <div class="inv-stepper">
                  <button type="button" data-inv-step="-1" data-id="${esc(i.id)}" title="ลด 1" aria-label="ลด">−</button>
                  <input type="number" step="any" min="0" data-inv-input="${esc(i.id)}" value="${i.qty}" aria-label="จำนวนคงเหลือ">
                  <button type="button" data-inv-step="1" data-id="${esc(i.id)}" title="เพิ่ม 1" aria-label="เพิ่ม">+</button>
                </div>
                <button type="button" class="btn soft sm" data-inv-restock="${esc(i.id)}" title="เติมสต็อก">
                  ${icon('plus', 16)} เติมของ
                </button>
                <button type="button" class="icon-btn" data-inv-edit="${esc(i.id)}" title="แก้ไขข้อมูล">
                  ${icon('edit', 18)}
                </button>
                <button type="button" class="icon-btn bad" data-inv-del="${esc(i.id)}" title="ลบรายการ">
                  ${icon('trash', 18)}
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('') : `
        <div class="empty">
          <div class="b">ไม่พบรายการสต็อก</div>
          <p class="small muted mt-s">ลองเปลี่ยนคำค้นหา หรือกด "+ เพิ่มรายการสต็อก" เพื่อเพิ่มของใหม่</p>
        </div>
      `}
    </div>
  `;

  $('#invSearchInput').oninput = e => {
    invQ = e.target.value;
    drawInventory();
  };
  $('#invStatusAll').onclick = () => { invStatus = 'all'; drawInventory(); };
  $('#invStatusLow').onclick = () => { invStatus = invStatus === 'low' ? 'all' : 'low'; drawInventory(); };

  $$('[data-inv-cat]').forEach(b => {
    b.onclick = () => {
      invCat = b.dataset.invCat;
      drawInventory();
    };
  });

  container.onclick = async e => {
    const t = e.target;

    // แตะรูปเพื่อเลือก/เปลี่ยนรูปภาพด่วน
    const upBtn = t.closest('[data-inv-upload]');
    if (upBtn) {
      const id = upBtn.dataset.invUpload;
      const it = invItems.find(i => i.id === id);
      if (it) {
        let quickInp = $('#quickInvImgInput');
        if (!quickInp) {
          quickInp = document.createElement('input');
          quickInp.type = 'file';
          quickInp.id = 'quickInvImgInput';
          quickInp.accept = 'image/*';
          quickInp.style.display = 'none';
          document.body.appendChild(quickInp);
        }
        quickInp.onchange = async () => {
          const file = quickInp.files[0];
          quickInp.value = '';
          if (!file) return;
          toast(`กำลังอัปโหลดรูปของ ${it.name}…`);
          try {
            const dataUri = await resizeImage(file, 800, 0.85);
            const up = await api('/api/admin/upload', { method: 'POST', body: { image: dataUri } });
            const res = await api(`/api/admin/inventory/${id}`, { method: 'PUT', body: { image: up.url } });
            it.image = res.item.image;
            toast(`อัปเดตรูปของ "${it.name}" เรียบร้อยแล้ว`, 'ok');
            drawInventory();
          } catch (err) {
            toast(err.message, 'err');
          }
        };
        quickInp.click();
      }
      return;
    }

    const rBtn = t.closest('[data-inv-restock]');
    if (rBtn) {
      const it = invItems.find(i => i.id === rBtn.dataset.invRestock);
      if (it) invRestockSheet(it);
      return;
    }

    const eBtn = t.closest('[data-inv-edit]');
    if (eBtn) {
      const it = invItems.find(i => i.id === eBtn.dataset.invEdit);
      if (it) invItemSheet(it);
      return;
    }

    const dBtn = t.closest('[data-inv-del]');
    if (dBtn) {
      const it = invItems.find(i => i.id === dBtn.dataset.invDel);
      if (it) {
        if (await confirmSheet({ title: `ลบ "${it.name}"?`, text: 'รายการนี้จะถูกลบออกจากระบบสต็อก', ok: 'ลบรายการ', danger: true })) {
          try {
            await api(`/api/admin/inventory/${it.id}`, { method: 'DELETE' });
            invItems = invItems.filter(i => i.id !== it.id);
            toast(`ลบ "${it.name}" แล้ว`, 'ok');
            drawInventory();
          } catch (err) {
            toast(err.message, 'err');
          }
        }
      }
      return;
    }

    const sBtn = t.closest('[data-inv-step]');
    if (sBtn) {
      const id = sBtn.dataset.id;
      const step = parseFloat(sBtn.dataset.invStep) || 0;
      const it = invItems.find(i => i.id === id);
      if (it) {
        const nextQty = Math.max(0, Math.round((it.qty + step) * 100) / 100);
        try {
          const res = await api(`/api/admin/inventory/${id}/adjust`, {
            method: 'POST',
            body: { newQty: nextQty, reason: step > 0 ? 'เพิ่มยอดด่วน' : 'ลดยอดด่วน' }
          });
          it.qty = res.item.qty;
          drawInventory();
        } catch (err) {
          toast(err.message, 'err');
        }
      }
      return;
    }
  };

  container.onchange = async e => {
    const inp = e.target.closest('[data-inv-input]');
    if (!inp) return;
    const id = inp.dataset.invInput;
    const it = invItems.find(i => i.id === id);
    if (!it) return;
    const val = Math.max(0, parseFloat(inp.value) || 0);
    try {
      const res = await api(`/api/admin/inventory/${id}/adjust`, {
        method: 'POST',
        body: { newQty: val, reason: 'ปรับยอดโดยตรง' }
      });
      it.qty = res.item.qty;
      toast(`อัปเดตสต็อก ${it.name} เป็น ${it.qty} ${it.unit} แล้ว`, 'ok');
      drawInventory();
    } catch (err) {
      toast(err.message, 'err');
      inp.value = it.qty;
    }
  };
}

function invItemSheet(item = null) {
  const isEdit = !!item;
  const cats = Array.from(new Set([...INV_CATEGORIES, ...(item ? [item.category] : [])]));
  const units = Array.from(new Set([...INV_UNITS, ...(item ? [item.unit] : [])]));
  let curImg = item ? (item.image || '') : '';

  const body = `
    <div class="field">
      <label class="lbl">รูปภาพสินค้า / วัตถุดิบ</label>
      <div class="inv-upload-box">
        <div class="inv-modal-thumb-wrap" id="invModalThumbWrap">
          ${curImg ? `
            <img src="${esc(curImg)}" class="inv-modal-thumb" id="invPreviewImg">
          ` : `
            <div class="inv-modal-thumb-empty" id="invEmptyPlaceholder">
              ${icon('camera', 28)}
              <span>แตะใส่รูป</span>
            </div>
          `}
        </div>
        <div class="inv-upload-actions">
          <div class="row gap-s">
            <label class="btn soft sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
              ${icon('camera', 16)} เลือก / ถ่ายรูป
              <input type="file" id="invImgInput" accept="image/*" style="display:none">
            </label>
            <button type="button" class="btn ghost sm bad" id="invDelImgBtn" style="${curImg ? '' : 'display:none'}">
              ลบรูป
            </button>
          </div>
          <div class="tiny muted" id="invImgStatus">ภาพสินค้าจริง (JPG/PNG ย่อขนาดให้อัตโนมัติ)</div>
        </div>
      </div>
    </div>

    <div class="field">
      <label class="lbl">ชื่อสินค้า / วัตถุดิบ *</label>
      <input id="inv_name" placeholder="เช่น น้ำตาลทราย, แป้งเครป, นมสด" value="${esc(item ? item.name : '')}">
    </div>

    <div class="row gap">
      <div class="field grow">
        <label class="lbl">หมวดหมู่</label>
        <select id="inv_cat">
          ${cats.map(c => `<option value="${esc(c)}" ${item && item.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="width:130px">
        <label class="lbl">หน่วยนับ</label>
        <input id="inv_unit" list="unit_list" placeholder="เช่น กก., ลิตร" value="${esc(item ? item.unit : 'กก.')}">
        <datalist id="unit_list">
          ${units.map(u => `<option value="${esc(u)}">`).join('')}
        </datalist>
      </div>
    </div>

    <div class="row gap">
      <div class="field grow">
        <label class="lbl">จำนวนคงเหลือ</label>
        <input id="inv_qty" type="number" step="any" min="0" placeholder="0" value="${item ? item.qty : '0'}">
      </div>
      <div class="field grow">
        <label class="lbl">เตือนเมื่อเหลือน้อยกว่า</label>
        <input id="inv_alert" type="number" step="any" min="0" placeholder="เช่น 3 (0 = ไม่เตือน)" value="${item ? (item.minAlert || '') : '3'}">
      </div>
    </div>

    <div class="row gap">
      <div class="field grow">
        <label class="lbl">ต้นทุนต่อหน่วย (บาท)</label>
        <input id="inv_cost" type="number" step="any" min="0" placeholder="เช่น 28 (ไม่บังคับ)" value="${item && item.cost ? item.cost : ''}">
      </div>
      <div class="field grow">
        <label class="lbl">หมายเหตุ / ยี่ห้อ</label>
        <input id="inv_note" placeholder="เช่น ถุงละ 1 กก. / แม็คโคร" value="${esc(item ? item.note : '')}">
      </div>
    </div>
  `;

  const s = openSheet({
    title: isEdit ? 'แก้ไขรายการสต็อก' : 'เพิ่มรายการสต็อกใหม่',
    body,
    footer: `
      <div class="row gap">
        <button class="btn ghost grow" data-close>ยกเลิก</button>
        <button class="btn primary grow" id="saveInvBtn">${isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มลงสต็อก'}</button>
      </div>
    `
  });

  const imgInput = s.q('#invImgInput');
  const imgStatus = s.q('#invImgStatus');
  const thumbWrap = s.q('#invModalThumbWrap');
  const delBtn = s.q('#invDelImgBtn');

  imgInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('กรุณาเลือกไฟล์รูปภาพ', 'err');
    imgStatus.textContent = 'กำลังย่อขนาดและอัปโหลดรูปภาพ…';
    try {
      const dataUri = await resizeImage(file, 800, 0.85);
      const upRes = await api('/api/admin/upload', { method: 'POST', body: { image: dataUri } });
      curImg = upRes.url;
      thumbWrap.innerHTML = `<img src="${esc(curImg)}" class="inv-modal-thumb" id="invPreviewImg">`;
      delBtn.style.display = 'inline-block';
      imgStatus.textContent = 'อัปโหลดรูปสำเร็จแล้ว';
      toast('อัปโหลดรูปเรียบร้อย', 'ok');
    } catch (err) {
      imgStatus.textContent = 'อัปโหลดไม่สำเร็จ: ' + err.message;
      toast(err.message, 'err');
    }
  };

  delBtn.onclick = () => {
    curImg = '';
    thumbWrap.innerHTML = `
      <div class="inv-modal-thumb-empty" id="invEmptyPlaceholder">
        ${icon('camera', 28)}
        <span>แตะใส่รูป</span>
      </div>
    `;
    delBtn.style.display = 'none';
    imgStatus.textContent = 'ลบรูปภาพแล้ว (กดบันทึกเพื่อยืนยัน)';
  };

  s.q('#saveInvBtn').onclick = async () => {
    const name = s.q('#inv_name').value.trim();
    if (!name) return toast('กรุณากรอกชื่อสินค้า/วัตถุดิบ', 'err');
    const category = s.q('#inv_cat').value.trim() || 'แป้งและส่วนผสมหลัก';
    const unit = s.q('#inv_unit').value.trim() || 'ชิ้น';
    const qty = Math.max(0, parseFloat(s.q('#inv_qty').value) || 0);
    const minAlert = s.q('#inv_alert').value === '' ? 0 : Math.max(0, parseFloat(s.q('#inv_alert').value) || 0);
    const cost = s.q('#inv_cost').value === '' ? 0 : Math.max(0, parseFloat(s.q('#inv_cost').value) || 0);
    const note = s.q('#inv_note').value.trim();

    try {
      if (isEdit) {
        const res = await api(`/api/admin/inventory/${item.id}`, {
          method: 'PUT',
          body: { name, category, unit, qty, minAlert, cost, note, image: curImg }
        });
        const idx = invItems.findIndex(i => i.id === item.id);
        if (idx !== -1) invItems[idx] = res.item;
        toast(`บันทึก "${name}" เรียบร้อยแล้ว`, 'ok');
      } else {
        const res = await api('/api/admin/inventory', {
          method: 'POST',
          body: { name, category, unit, qty, minAlert, cost, note, image: curImg }
        });
        invItems.unshift(res.item);
        toast(`เพิ่ม "${name}" ลงในสต็อกแล้ว`, 'ok');
      }
      s.close();
      drawInventory();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function invRestockSheet(item) {
  const body = `
    <div class="card mb" style="padding:14px 16px">
      <div class="row items-center gap">
        ${item.image ? `
          <img src="${esc(item.image)}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;border:1px solid var(--line);flex-shrink:0">
        ` : `
          <div style="width:52px;height:52px;border-radius:8px;background:var(--line-2);border:1px solid var(--line);display:grid;place-items:center;color:var(--ink-2);flex-shrink:0">
            ${icon('box', 22)}
          </div>
        `}
        <div class="grow">
          <div class="b" style="font-size:19px">${esc(item.name)}</div>
          <div class="small muted mt-s">คงเหลือปัจจุบัน: <b style="color:var(--ink)">${item.qty} ${esc(item.unit)}</b> <span class="ochip" style="margin-left:6px">${esc(item.category)}</span></div>
        </div>
      </div>
    </div>

    <div class="field">
      <label class="lbl">เลือกจำนวนที่เติมด่วน (+)</label>
      <div class="row wrap gap-s mb">
        <button type="button" class="btn soft sm" data-add-q="1">+1</button>
        <button type="button" class="btn soft sm" data-add-q="5">+5</button>
        <button type="button" class="btn soft sm" data-add-q="10">+10</button>
        <button type="button" class="btn soft sm" data-add-q="20">+20</button>
        <button type="button" class="btn soft sm" data-add-q="50">+50</button>
      </div>
      <input id="restock_amt" type="number" step="any" min="0.1" placeholder="ระบุจำนวน เช่น 10" value="5">
    </div>

    <div class="field">
      <label class="lbl">เหตุผล / บันทึก</label>
      <input id="restock_reason" placeholder="เช่น ซื้อของเข้าร้าน, ตรวจนับเพิ่ม" value="ซื้อของเข้าร้าน">
    </div>
  `;

  const s = openSheet({
    title: `เติมสต็อก: ${item.name}`,
    body,
    footer: `
      <div class="row gap">
        <button class="btn ghost grow" data-close>ยกเลิก</button>
        <button class="btn primary grow" id="doRestockBtn">${icon('check', 18)} ยืนยันการเติมของ</button>
      </div>
    `
  });

  s.qa('[data-add-q]').forEach(b => {
    b.onclick = () => {
      s.q('#restock_amt').value = b.dataset.addQ;
    };
  });

  s.q('#doRestockBtn').onclick = async () => {
    const amt = parseFloat(s.q('#restock_amt').value);
    if (!amt || amt <= 0) return toast('กรุณาระบุจำนวนที่ต้องการเติม', 'err');
    const reason = s.q('#restock_reason').value.trim() || 'ซื้อของเข้าร้าน';

    try {
      const res = await api(`/api/admin/inventory/${item.id}/adjust`, {
        method: 'POST',
        body: { delta: amt, reason }
      });
      item.qty = res.item.qty;
      toast(`เติม ${item.name} +${amt} ${item.unit} สำเร็จ (รวมเป็น ${item.qty})`, 'ok');
      s.close();
      drawInventory();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function drawMenuStock() {
  const container = $('#stockSubView');
  if (!container) return;
  container.innerHTML = `
    <div class="card mb"><div class="small muted">ปิด/เปิดขายและกำหนดจำนวนคงเหลือเมนูหน้าร้าน (เว้นว่าง = ไม่จำกัด) ระบบตัดสต็อกอัตโนมัติเมื่อมีออเดอร์</div></div>
    <div class="search mb"><input id="sq" type="search" placeholder="ค้นหาเมนูหน้าร้าน..." value="${esc(stockQ)}">${icon('search', 18)}</div>
    <div id="slist"></div>
  `;
  $('#sq').oninput = e => { stockQ = e.target.value.trim().toLowerCase(); drawMenuStockList(); };
  container.onchange = async e => {
    const t = e.target, id = t.dataset.id; if (!id) return;
    const patch = t.dataset.k === 'av' ? { available: t.checked } : { stock: t.value === '' ? null : Math.max(0, +t.value) };
    try { Object.assign(MENU.items.find(i => i.id === id), await api('/api/admin/stock', { method: 'POST', body: { id, ...patch } })); toast('บันทึกแล้ว', 'ok'); drawMenuStockList(); } catch (err) { toast(err.message, 'err'); }
  };
  container.onclick = e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    const it = MENU.items.find(i => i.id === b.dataset.id);
    const v = Math.max(0, (it.stock == null ? 0 : it.stock) + +b.dataset.step);
    const inp = $(`input[data-k=st][data-id="${CSS.escape(b.dataset.id)}"]`);
    inp.value = v;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  drawMenuStockList();
}

function drawMenuStockList() {
  const slist = $('#slist');
  if (!slist) return;
  slist.innerHTML = MENU.categories.map(c => {
    const its = MENU.items.filter(i => i.category === c.id && (!stockQ || i.name.toLowerCase().includes(stockQ)));
    return its.length ? `
      <div class="divider-t">${esc(c.name)} · ${its.length} รายการ</div>
      <div class="card" style="padding:4px 16px">${its.map(i => `
        <div class="stock-item">
          <div class="stock-main">
            <div class="pic">${i.image ? `<img src="${esc(i.image)}" alt="">` : dishEmoji(i.name, c.name)}</div>
            <div class="stock-info">
              <div class="b stock-name">${esc(i.name)}</div>
              <div class="small stock-status ${i.available && (i.stock == null || i.stock > 0) ? 'muted' : ''}" style="${i.stock === 0 ? 'color:var(--bad)' : ''}">
                ${i.stock === 0 ? 'หมดสต็อก' : i.stock != null ? `เหลือ ${i.stock} ชิ้น` : 'ไม่จำกัดสต็อก'}
              </div>
            </div>
            <div class="stock-sw-wrap">
              <label class="sw"><input type="checkbox" data-k="av" data-id="${esc(i.id)}" ${i.available ? 'checked' : ''} aria-label="เปิดขาย"><i></i></label>
            </div>
          </div>
          <div class="stock-controls">
            <span class="stock-lbl small muted">จำนวนสต็อก:</span>
            <div class="stepper sm">
              <button data-step="-1" data-id="${esc(i.id)}" aria-label="ลด">−</button>
              <input data-k="st" data-id="${esc(i.id)}" type="number" min="0" placeholder="∞" value="${i.stock == null ? '' : i.stock}">
              <button data-step="1" data-id="${esc(i.id)}" aria-label="เพิ่ม">+</button>
            </div>
          </div>
        </div>`).join('')}</div>` : '';
  }).join('') || '<div class="empty"><div class="e"></div>ไม่พบเมนู</div>';
}

// ================= เมนู (เจ้าของ) =================
async function saveMenu(m, msg = 'บันทึกเมนูแล้ว') {
  try { MENU = await api('/api/admin/menu', { method: 'PUT', body: m }); toast(msg, 'ok'); return true; } catch (e) { toast(e.message, 'err'); return false; }
}
let _isMenuDragging = false;

function viewMenu() {
  view().innerHTML = `<div class="row mb wrap"><div class="grow"><h2 style="font-size:20px">จัดการเมนู</h2><div class="small muted">แตะที่เมนูเพื่อแก้ไข · ลากการ์ดเพื่อจัดลำดับ · ${MENU.items.length} เมนู</div></div>
    <button class="btn ghost" id="catBtn">${icon('grid', 18)}หมวดหมู่</button><button class="btn primary" id="addItem">${icon('plus', 18)}เพิ่มเมนู</button></div><div id="mlist"></div>`;
  $('#catBtn').onclick = catSheet; $('#addItem').onclick = () => itemSheet(null);
  view().onclick = async e => {
    if (_isMenuDragging) return;
    const mv = e.target.closest('[data-mv]');
    if (mv) { e.stopPropagation(); return moveItem(mv.dataset.id, +mv.dataset.mv); }
    if (e.target.closest('.sw')) return;
    if (e.target.closest('.drag-handle')) return;
    const r = e.target.closest('[data-edit]'); if (r) itemSheet(r.dataset.edit);
  };
  view().onchange = async e => { const t = e.target; if (t.dataset.k === 'av') { try { Object.assign(MENU.items.find(i => i.id === t.dataset.id), await api('/api/admin/stock', { method: 'POST', body: { id: t.dataset.id, available: t.checked } })); toast(t.checked ? 'เปิดขายแล้ว' : 'ปิดขายแล้ว', 'ok'); } catch (err) { toast(err.message, 'err'); } } };
  drawMenuList();
}

function drawMenuList() {
  const gripIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/>
    <circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/>
    <circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/>
  </svg>`;

  $('#mlist').innerHTML = MENU.categories.map(c => {
    const its = MENU.items.filter(i => i.category === c.id);
    return `<div class="divider-t" style="margin:20px 0 10px">${esc(c.name)} · ${its.length}</div>
      <div class="menu-cards-list" data-cat="${esc(c.id)}">${its.map((i, ix) => `
        <div class="menu-card card" data-id="${esc(i.id)}" data-cat="${esc(c.id)}" draggable="true">
          <div class="menu-card-main">
            <div class="drag-handle" title="ลากเพื่อจัดลำดับ" aria-label="ลากเพื่อจัดลำดับ">
              ${gripIcon}
            </div>
            <div class="pic" data-edit="${esc(i.id)}">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}</div>
            <div class="menu-info" data-edit="${esc(i.id)}">
              <div class="b menu-name">${esc(i.name)}${i.recommended ? '<span class="tag">แนะนำ</span>' : ''}</div>
              <div class="small muted">${baht(i.price)} · ${i.groups.length} กลุ่มตัวเลือก${i.stock != null ? ` · สต็อก ${i.stock}` : ''}${i.image ? '' : ' · <b style="color:var(--acc)">ยังไม่มีรูป</b>'}</div>
            </div>
            <div class="menu-sw-wrap">
              <label class="sw"><input type="checkbox" data-k="av" data-id="${esc(i.id)}" ${i.available ? 'checked' : ''} aria-label="เปิดขาย"><i></i></label>
            </div>
          </div>
          <div class="menu-card-actions">
            <span class="menu-lbl small muted" data-edit="${esc(i.id)}">แตะเพื่อแก้ไข</span>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn sm ghost" style="min-height:38px;min-width:44px;padding:0 12px;font-size:16px" data-mv="-1" data-id="${esc(i.id)}" ${ix === 0 ? 'disabled style="opacity:.2"' : ''}>ขึ้น</button>
              <button class="btn sm ghost" style="min-height:38px;min-width:44px;padding:0 12px;font-size:16px" data-mv="1" data-id="${esc(i.id)}" ${ix === its.length - 1 ? 'disabled style="opacity:.2"' : ''}>ลง</button>
            </div>
          </div>
        </div>`).join('') || '<div class="card empty-cat-card small muted" style="text-align:center;padding:20px">ยังไม่มีเมนูในหมวดนี้</div>'}</div>`;
  }).join('');

  setupMenuDragDrop();
}

async function reorderCategory(catId, newOrderedIds) {
  const m = JSON.parse(JSON.stringify(MENU));
  const catItems = m.items.filter(x => x.category === catId);
  const currentIds = catItems.map(x => x.id);
  if (JSON.stringify(currentIds) === JSON.stringify(newOrderedIds)) return;

  const map = new Map(catItems.map(x => [x.id, x]));
  const reordered = newOrderedIds.map(id => map.get(id)).filter(Boolean);

  const newItems = [];
  let idx = 0;
  for (const item of m.items) {
    if (item.category === catId) {
      if (idx < reordered.length) newItems.push(reordered[idx++]);
    } else {
      newItems.push(item);
    }
  }
  m.items = newItems;
  if (await saveMenu(m, 'จัดลำดับเมนูแล้ว')) {
    drawMenuList();
  }
}

async function moveItem(id, dir) {
  const m = JSON.parse(JSON.stringify(MENU)), i = m.items.findIndex(x => x.id === id), cat = m.items[i].category;
  let j = i + dir; while (j >= 0 && j < m.items.length && m.items[j].category !== cat) j += dir;
  if (j < 0 || j >= m.items.length) return;
  [m.items[i], m.items[j]] = [m.items[j], m.items[i]];
  if (await saveMenu(m, 'ย้ายแล้ว')) drawMenuList();
}

function setupMenuDragDrop() {
  const lists = $$('.menu-cards-list');
  if (!lists.length) return;

  // 1. Desktop HTML5 Drag & Drop
  let draggedCard = null;

  $$('.menu-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      if (e.target.closest('button, input, .sw')) {
        e.preventDefault();
        return;
      }
      _isMenuDragging = true;
      draggedCard = card;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch {}
    });

    card.addEventListener('dragend', async () => {
      if (!draggedCard) return;
      draggedCard.classList.remove('is-dragging');
      const cat = draggedCard.dataset.cat;
      const container = $(`.menu-cards-list[data-cat="${cat}"]`);
      if (container) {
        const newIds = [...container.querySelectorAll('.menu-card')].map(c => c.dataset.id);
        await reorderCategory(cat, newIds);
      }
      draggedCard = null;
      setTimeout(() => { _isMenuDragging = false; }, 250);
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (!draggedCard || draggedCard === card || draggedCard.dataset.cat !== card.dataset.cat) return;
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      card.parentNode.insertBefore(draggedCard, next ? card.nextSibling : card);
    });
  });

  // 2. Mobile Touch Drag & Drop (Touch Handle)
  $$('.drag-handle').forEach(handle => {
    let touchCard = null;
    let placeholder = null;
    let offsetY = 0;
    let listContainer = null;
    let cardCat = '';
    let hasMoved = false;

    handle.addEventListener('touchstart', e => {
      if (e.touches.length > 1) return;
      const card = handle.closest('.menu-card');
      if (!card) return;
      touchCard = card;
      cardCat = card.dataset.cat;
      listContainer = card.closest('.menu-cards-list');
      if (!listContainer) return;

      hasMoved = false;
      const touch = e.touches[0];
      const rect = card.getBoundingClientRect();
      offsetY = touch.clientY - rect.top;

      placeholder = document.createElement('div');
      placeholder.className = 'menu-card-placeholder';
      placeholder.style.height = `${rect.height}px`;
      placeholder.innerHTML = '<span>วางตำแหน่งนี้</span>';

      listContainer.insertBefore(placeholder, card.nextSibling);

      card.classList.add('touch-dragging');
      card.style.width = `${rect.width}px`;
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;

      if (navigator.vibrate) try { navigator.vibrate(20); } catch {}
      e.preventDefault();
    }, { passive: false });

    handle.addEventListener('touchmove', e => {
      if (!touchCard || !placeholder || !listContainer) return;
      e.preventDefault();
      hasMoved = true;
      const touch = e.touches[0];
      const curY = touch.clientY;
      touchCard.style.top = `${curY - offsetY}px`;

      const siblings = [...listContainer.querySelectorAll('.menu-card:not(.touch-dragging)')];
      let placed = false;
      for (const sib of siblings) {
        const r = sib.getBoundingClientRect();
        if (curY < r.top + r.height / 2) {
          listContainer.insertBefore(placeholder, sib);
          placed = true;
          break;
        }
      }
      if (!placed && siblings.length) {
        listContainer.appendChild(placeholder);
      }
    }, { passive: false });

    const endTouch = async () => {
      if (!touchCard || !placeholder || !listContainer) return;
      _isMenuDragging = true;

      listContainer.insertBefore(touchCard, placeholder);
      placeholder.remove();

      touchCard.classList.remove('touch-dragging');
      touchCard.style.width = '';
      touchCard.style.left = '';
      touchCard.style.top = '';

      if (hasMoved) {
        const newIds = [...listContainer.querySelectorAll('.menu-card')].map(c => c.dataset.id);
        await reorderCategory(cardCat, newIds);
      }

      touchCard = null;
      placeholder = null;
      listContainer = null;
      setTimeout(() => { _isMenuDragging = false; }, 250);
    };

    handle.addEventListener('touchend', endTouch);
    handle.addEventListener('touchcancel', endTouch);
  });
}
function catSheet() {
  const C = JSON.parse(JSON.stringify(MENU.categories));
  const s = openSheet({ title: 'หมวดหมู่', footer: '<button class="btn primary lg block" id="cSave">บันทึก</button>', body: '' });
  const draw = () => s.setBody(C.map((c, i) => `<div class="row mb"><input data-i="${i}" value="${esc(c.name)}" aria-label="ชื่อหมวด"><button class="btn sm ghost" data-up="${i}" ${i === 0 ? 'disabled style="opacity:.3"' : ''} style="min-height:44px;min-width:44px;padding:0 12px;font-size:18px">ขึ้น</button><button class="btn sm ghost" data-dn="${i}" ${i === C.length - 1 ? 'disabled style="opacity:.3"' : ''} style="min-height:44px;min-width:44px;padding:0 12px;font-size:18px">ลง</button><button class="btn sm bad-soft" data-del="${i}" style="min-height:44px;min-width:44px;padding:0 12px;font-size:18px">ลบ</button></div>`).join('') + `<button class="btn soft block" id="cAdd">เพิ่มหมวด</button>`);
  s.el.addEventListener('input', e => { if (e.target.dataset.i !== undefined) C[+e.target.dataset.i].name = e.target.value; });
  s.el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.up) { const i = +b.dataset.up; [C[i - 1], C[i]] = [C[i], C[i - 1]]; draw(); }
    else if (b.dataset.dn) { const i = +b.dataset.dn; [C[i + 1], C[i]] = [C[i], C[i + 1]]; draw(); }
    else if (b.dataset.del) { const i = +b.dataset.del; if (MENU.items.some(x => x.category === C[i].id)) return toast('ย้ายหรือลบเมนูในหมวดนี้ก่อน', 'err'); if (C.length === 1) return toast('ต้องมีอย่างน้อย 1 หมวด', 'err'); C.splice(i, 1); draw(); }
    else if (b.id === 'cAdd') { C.push({ id: nid(), name: 'หมวดใหม่' }); draw(); }
  });
  s.q('#cSave').onclick = async () => { if (await saveMenu({ ...MENU, categories: C })) { s.close(); viewMenu(); } };
  draw();
}
const nid = () => 'x' + Math.random().toString(36).slice(2, 8);
function setPath(o, path, v) { const p = path.split('.'); while (p.length > 1) o = o[p.shift()]; o[p[0]] = v; }
function itemSheet(id) {
  const isNew = !id;
  const it = isNew ? { id: nid(), category: MENU.categories[0].id, name: '', price: 0, available: true, stock: null, image: '', description: '', recommended: false, groups: [] } : JSON.parse(JSON.stringify(MENU.items.find(i => i.id === id)));
  const s = openSheet({ title: isNew ? 'เพิ่มเมนูใหม่' : 'แก้ไขเมนู', full: true, wide: true, body: '',
    footer: `<div class="row">${isNew ? '' : `<button class="btn bad-soft" id="iDel">ลบเมนู</button>`}<button class="btn primary lg grow" id="iSave">บันทึกเมนู</button></div>` });
  const draw = () => s.setBody(`
    <div class="imgbox" id="imgDrop">
      <div class="imgprev">${it.image ? `<img src="${esc(it.image)}" alt="รูปสินค้า">` : '<span>ยังไม่มีรูป</span>'}</div>
      <div class="grow">
        <div class="b">รูปสินค้า</div>
        <div class="help">ลูกค้าจะเห็นรูปนี้ในหน้าเมนู ระบบย่อขนาดให้อัตโนมัติ (ใช้รูป JPG หรือ PNG ก็ได้)</div>
        <div class="row wrap gap-s mt-s">
          <label class="btn primary sm" style="cursor:pointer">${it.image ? 'เปลี่ยนรูป' : 'เลือกรูปจากเครื่อง'}<input type="file" accept="image/*" hidden data-a="img"></label>
          <label class="btn sm" style="cursor:pointer">ถ่ายรูป<input type="file" accept="image/*" capture="environment" hidden data-a="img"></label>
          ${it.image ? '<button class="btn bad-soft sm" data-a="rmimg">ลบรูป</button>' : ''}
        </div>
        <div class="help" id="imgStatus" role="status">${it.image ? '' : 'หรือลากรูปมาวางที่กล่องนี้ (บนคอมพิวเตอร์)'}</div>
      </div>
    </div>
    <div class="field"><label>ชื่อเมนู (ไม่เกิน 60 ตัวอักษร)</label><input data-p="name" maxlength="60" value="${esc(it.name)}" placeholder="เช่น เครปช็อกโกแลตกล้วย"></div>
    <div class="fgrid"><div class="field"><label>ราคา (บาท)</label><input data-p="price" data-t="n" type="number" inputmode="decimal" min="0" value="${it.price}"></div>
      <div class="field"><label>หมวดหมู่</label><select data-p="category">${MENU.categories.map(c => `<option value="${esc(c.id)}" ${c.id === it.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>สต็อก (ว่าง = ไม่จำกัด)</label><input data-p="stock" data-t="ns" type="number" inputmode="numeric" min="0" value="${it.stock == null ? '' : it.stock}" placeholder="∞"></div></div>
    <div class="field"><label>คำอธิบายสั้นๆ</label><input data-p="description" value="${esc(it.description)}" placeholder="เช่น แป้งบางกรอบ ไส้เยอะ"></div>
    <div class="card" style="box-shadow:none;border:1.5px solid var(--line);padding:4px 14px"><div class="setrow"><div class="grow b">เปิดขาย</div><label class="sw"><input type="checkbox" data-p="available" data-t="b" ${it.available ? 'checked' : ''}><i></i></label></div>
      <div class="setrow"><div class="grow"><div class="b">ติดป้าย “แนะนำ”</div><div class="small muted">แสดงในแถบเมนูแนะนำหน้าแรก</div></div><label class="sw"><input type="checkbox" data-p="recommended" data-t="b" ${it.recommended ? 'checked' : ''}><i></i></label></div></div>
    <div class="divider-t">ตัวเลือกของเมนูนี้ (ท็อปปิ้ง / ขนาด / ความหวาน ฯลฯ)</div>
    ${it.groups.map((g, gi) => `<div class="gcard"><div class="row"><input data-p="groups.${gi}.name" value="${esc(g.name)}" placeholder="ชื่อกลุ่ม เช่น ท็อปปิ้ง"><button class="btn sm bad-soft" data-a="delg" data-gi="${gi}">ลบกลุ่ม</button></div>
      <div class="seg mt-s"><button data-a="gtype" data-gi="${gi}" data-v="single" class="${g.type === 'single' ? 'on' : ''}">เลือก 1 อย่าง</button><button data-a="gtype" data-gi="${gi}" data-v="multi" class="${g.type === 'multi' ? 'on' : ''}">เลือกได้หลายอย่าง</button></div>
      <div class="setrow"><div class="grow b">ลูกค้าต้องเลือก</div><label class="sw"><input type="checkbox" data-p="groups.${gi}.required" data-t="b" ${g.required ? 'checked' : ''}><i></i></label></div>
      ${g.type === 'multi' ? `<div class="field mt-s"><label>เลือกได้สูงสุดกี่อย่าง (0 = ไม่จำกัด)</label><input data-p="groups.${gi}.max" data-t="n" type="number" inputmode="numeric" min="0" value="${g.max || 0}"></div>` : ''}
      ${g.options.map((o, oi) => `<div class="row mb"><input data-p="groups.${gi}.options.${oi}.name" value="${esc(o.name)}" placeholder="ชื่อตัวเลือก"><div style="position:relative;width:96px;flex:none"><input data-p="groups.${gi}.options.${oi}.price" data-t="n" type="number" inputmode="decimal" min="0" value="${o.price}" style="padding-left:26px" aria-label="ราคาที่บวกเพิ่ม"><span class="faint" style="position:absolute;left:12px;top:11px">+฿</span></div><button class="btn sm bad-soft" data-a="delo" data-gi="${gi}" data-oi="${oi}" style="min-height:44px;min-width:44px;padding:0 12px;font-size:18px">ลบ</button></div>`).join('')}
      <button class="btn soft sm" data-a="addo" data-gi="${gi}">เพิ่มตัวเลือก</button></div>`).join('')}
    <div class="row wrap"><button class="btn soft" data-a="addg">เพิ่มกลุ่มตัวเลือก</button>
      ${MENU.items.length > (isNew ? 0 : 1) ? `<select data-a="copyg" style="width:auto;flex:1;min-width:180px"><option value="">คัดลอกตัวเลือกจากเมนูอื่น…</option>${MENU.items.filter(x => x.id !== it.id).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>` : ''}</div>`);
  // อัปโหลดรูปสินค้า: ตรวจไฟล์ → ย่อรูปในเครื่อง → ส่งขึ้นเซิร์ฟเวอร์ → แสดงตัวอย่าง
  const uploadFile = async file => {
    const status = $('#imgStatus', s.el);
    const say = (t, bad) => { if (status) { status.textContent = t; status.style.color = bad ? 'var(--bad)' : ''; } };
    if (!/^image\//.test(file.type)) return say('ไฟล์นี้ไม่ใช่รูปภาพ กรุณาเลือกไฟล์ JPG หรือ PNG', true);
    if (file.size > 25 * 1024 * 1024) return say('ไฟล์ใหญ่เกินไป (เกิน 25 MB) กรุณาเลือกรูปที่เล็กกว่านี้', true);
    $$('[data-a=img]', s.el).forEach(i => (i.disabled = true)); say('กำลังอัปโหลดรูป…');
    try {
      const image = await resizeImage(file, 900, 0.82);
      const r = await api('/api/admin/upload', { method: 'POST', body: { image } });
      it.image = r.url; draw(); toast('อัปโหลดรูปแล้ว กด "บันทึกเมนู" เพื่อใช้งาน', 'ok');
    } catch (err) { $$('[data-a=img]', s.el).forEach(i => (i.disabled = false)); say(err.message === 'ไฟล์ใหญ่เกินไป' ? 'รูปใหญ่เกินไป ลองใช้รูปอื่น' : 'อัปโหลดไม่สำเร็จ: ' + err.message, true); }
  };
  const upd = e => {
    const t = e.target; if (!t.dataset.p) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.t === 'n') v = v === '' ? 0 : +v; else if (t.dataset.t === 'ns') v = v === '' ? null : Math.max(0, +v);
    setPath(it, t.dataset.p, v);
  };
  s.el.addEventListener('input', upd); s.el.addEventListener('change', e => { upd(e); const a = e.target.dataset.a;
    if (a === 'copyg' && e.target.value) { it.groups = JSON.parse(JSON.stringify(MENU.items.find(x => x.id === e.target.value).groups)); draw(); }
    if (a === 'img' && e.target.files[0]) uploadFile(e.target.files[0]); });
  // ลากรูปมาวาง (คอมพิวเตอร์)
  s.el.addEventListener('dragover', e => { if (e.target.closest('#imgDrop')) { e.preventDefault(); $('#imgDrop', s.el).classList.add('over'); } });
  s.el.addEventListener('dragleave', e => { const d = $('#imgDrop', s.el); if (d && !d.contains(e.relatedTarget)) d.classList.remove('over'); });
  s.el.addEventListener('drop', e => { if (!e.target.closest('#imgDrop')) return; e.preventDefault(); $('#imgDrop', s.el).classList.remove('over'); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const gi = +b.dataset.gi, a = b.dataset.a;
    if (a === 'delg') it.groups.splice(gi, 1);
    else if (a === 'gtype') { it.groups[gi].type = b.dataset.v; if (b.dataset.v === 'single') it.groups[gi].max = 0; }
    else if (a === 'addo') it.groups[gi].options.push({ id: nid(), name: '', price: 0 });
    else if (a === 'delo') { if (it.groups[gi].options.length === 1) return toast('ต้องมีอย่างน้อย 1 ตัวเลือก', 'err'); it.groups[gi].options.splice(+b.dataset.oi, 1); }
    else if (a === 'addg') it.groups.push({ id: nid(), name: '', type: 'single', required: false, max: 0, options: [{ id: nid(), name: '', price: 0 }] });
    else if (a === 'rmimg') it.image = '';
    else return;
    draw();
  });
  s.q('#iSave').onclick = async () => {
    if (!it.name.trim()) return toast('กรุณาใส่ชื่อเมนู', 'err');
    if (it.groups.some(g => !g.name.trim() || g.options.some(o => !o.name.trim()))) return toast('กรอกชื่อกลุ่มและตัวเลือกให้ครบ', 'err');
    const m = JSON.parse(JSON.stringify(MENU)); const i = m.items.findIndex(x => x.id === it.id);
    if (i >= 0) m.items[i] = it; else m.items.push(it);
    if (await saveMenu(m)) { s.close(); viewMenu(); }
  };
  const del = s.q('#iDel'); if (del) del.onclick = async () => { if (await confirmSheet({ title: `ลบ “${it.name}”?`, text: 'ลบแล้วกู้คืนไม่ได้ (ออเดอร์เก่ายังเก็บไว้)', ok: 'ลบเมนู', danger: true })) { const m = JSON.parse(JSON.stringify(MENU)); m.items = m.items.filter(x => x.id !== it.id); if (await saveMenu(m, 'ลบเมนูแล้ว')) { s.close(); viewMenu(); } } };
  draw();
}

// ================= คูปอง (เจ้าของ) =================
let CP = null;
async function viewCoupons() {
  view().innerHTML = '<div class="skel" style="height:140px"></div>';
  try { CP = await api('/api/admin/coupons'); } catch (e) { return toast(e.message, 'err'); }
  const desc = c => (c.type === 'percent' ? `ลด ${c.value}%${c.maxDiscount ? ` (สูงสุด ${baht(c.maxDiscount)})` : ''}` : `ลด ${baht(c.value)}`) + (c.minTotal ? ` · ขั้นต่ำ ${baht(c.minTotal)}` : '');
  view().innerHTML = `<div class="row mb"><div class="grow"><h2 style="font-size:20px">คูปองส่วนลด</h2><div class="small muted">ลูกค้าใช้ได้คนละ 1 ครั้งต่อคูปอง</div></div><button class="btn primary" id="addCp">${icon('plus', 18)}สร้างคูปอง</button></div>
    ${CP.map((c, i) => `<div class="card" data-i="${i}" style="cursor:pointer"><div class="row"><div class="grow"><div class="row gap-s"><b style="font-size:18px;letter-spacing:.04em">${esc(c.code)}</b>${c.active ? '' : '<span class="pill">ปิดอยู่</span>'}${c.expires && c.expires < Date.now() ? '<span class="pill bad">หมดอายุ</span>' : ''}</div>
      <div class="muted">${desc(c)}</div><div class="small faint">ใช้แล้ว ${(c.usedBy || []).length}${c.maxUses ? '/' + c.maxUses : ''} ครั้ง${c.expires ? ' · หมดอายุ ' + new Date(c.expires).toLocaleDateString('th-TH') : ''}</div></div>${icon('chevR', 18, 'faint')}</div></div>`).join('') || `<div class="empty"><div class="e"></div><div class="b">ยังไม่มีคูปอง</div><p class="small muted mt-s">สร้างคูปองเพื่อดึงลูกค้า เช่น ลด 10% หรือ ลด ฿5</p></div>`}`;
  $('#addCp').onclick = () => couponSheet(-1);
  $$('[data-i]', view()).forEach(c => (c.onclick = () => couponSheet(+c.dataset.i)));
}
function couponSheet(i) {
  const c = i >= 0 ? JSON.parse(JSON.stringify(CP[i])) : { code: '', type: 'fixed', value: 10, minTotal: 0, maxDiscount: 0, maxUses: 0, expires: null, active: true, usedBy: [] };
  const s = openSheet({ title: i >= 0 ? 'แก้ไขคูปอง' : 'สร้างคูปอง', full: true, body: '', footer: `<div class="row">${i >= 0 ? `<button class="btn bad-soft" id="cDel">ลบคูปอง</button>` : ''}<button class="btn primary lg grow" id="cSave">บันทึก</button></div>` });
  const draw = () => s.setBody(`<div class="field"><label>รหัสคูปอง (A-Z, 0-9)</label><input data-p="code" value="${esc(c.code)}" placeholder="เช่น WELCOME10" style="text-transform:uppercase;letter-spacing:.05em" ${i >= 0 ? 'readonly' : ''}></div>
    <div class="field"><label>ประเภทส่วนลด</label><div class="seg"><button data-v="fixed" class="${c.type === 'fixed' ? 'on' : ''}">ลดเป็นบาท</button><button data-v="percent" class="${c.type === 'percent' ? 'on' : ''}">ลดเป็น %</button></div></div>
    <div class="fgrid"><div class="field"><label>มูลค่า (${c.type === 'percent' ? '%' : 'บาท'})</label><input data-p="value" data-t="n" type="number" inputmode="decimal" value="${c.value}"></div>
      <div class="field"><label>ยอดสั่งขั้นต่ำ (บาท)</label><input data-p="minTotal" data-t="n" type="number" inputmode="decimal" value="${c.minTotal}"></div>
      ${c.type === 'percent' ? `<div class="field"><label>ลดสูงสุด (บาท, 0 = ไม่จำกัด)</label><input data-p="maxDiscount" data-t="n" type="number" inputmode="decimal" value="${c.maxDiscount}"></div>` : ''}
      <div class="field"><label>จำนวนสิทธิ์ (0 = ไม่จำกัด)</label><input data-p="maxUses" data-t="n" type="number" inputmode="numeric" value="${c.maxUses}"></div></div>
    <div class="field"><label>วันหมดอายุ (เว้นว่าง = ไม่หมดอายุ)</label><input id="cExp" type="date" value="${c.expires ? ymd(new Date(c.expires)) : ''}"></div>
    <div class="setrow"><div class="grow b">เปิดใช้งาน</div><label class="sw"><input type="checkbox" data-p="active" data-t="b" ${c.active ? 'checked' : ''}><i></i></label></div>`);
  s.el.addEventListener('input', e => { const t = e.target; if (!t.dataset.p) return; c[t.dataset.p] = t.type === 'checkbox' ? t.checked : t.dataset.t === 'n' ? +t.value : t.value.toUpperCase(); });
  s.el.addEventListener('change', e => { if (e.target.dataset.p === 'active') c.active = e.target.checked; if (e.target.id === 'cExp') c.expires = e.target.value ? new Date(e.target.value + 'T23:59:59+07:00').getTime() : null; });
  s.el.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (b) { c.type = b.dataset.v; draw(); } });
  const put = async list => { try { CP = await api('/api/admin/coupons', { method: 'PUT', body: list }); toast('บันทึกแล้ว', 'ok'); s.close(); viewCoupons(); } catch (e) { toast(e.message, 'err'); } };
  s.q('#cSave').onclick = () => { const l = CP.slice(); if (i >= 0) l[i] = c; else l.push(c); put(l); };
  const d = s.q('#cDel'); if (d) d.onclick = async () => { if (await confirmSheet({ title: `ลบคูปอง ${c.code}?`, ok: 'ลบ', danger: true })) put(CP.filter((_, k) => k !== i)); };
  draw();
}

// ================= รายงาน (เจ้าของ) =================
let REP = [daysAgo(6), today()];
async function viewReport(from, to) {
  if (typeof from === 'string') REP = [from, to];
  const [f, t] = REP;
  view().innerHTML = '<div class="skel" style="height:90px;margin-bottom:12px"></div><div class="skel" style="height:240px"></div>';
  let r; try { r = await api(`/api/admin/report?from=${f}&to=${t}`); } catch (e) { return toast(e.message, 'err'); }
  const maxD = Math.max(1, ...r.byDay.map(d => d.revenue)), maxH = Math.max(1, ...r.byHour), maxT = Math.max(1, ...r.top.map(x => x.qty)), payTot = Math.max(1, r.pay.promptpay + r.pay.cash);
  const mo = today().slice(0, 7) + '-01';
  view().innerHTML = `<div class="card"><div class="row wrap"><input type="date" id="rf" value="${f}" style="width:auto;flex:1"><span>–</span><input type="date" id="rt" value="${t}" style="width:auto;flex:1"></div>
      <div class="row wrap gap-s mt-s">${[['วันนี้', today(), today()], ['7 วัน', daysAgo(6), today()], ['30 วัน', daysAgo(29), today()], ['เดือนนี้', mo, today()]].map(x => `<button class="chip" data-rr="${x[1]}|${x[2]}">${x[0]}</button>`).join('')}<button class="chip" id="csv" style="margin-left:auto">${icon('download', 15)}ส่งออก CSV</button></div></div>
    <div class="kpis"><div class="kpi"><div class="k">${icon('cash', 14)}ยอดขาย</div><div class="v pri">${baht(r.revenue)}</div></div><div class="kpi"><div class="k">${icon('check', 14)}ออเดอร์สำเร็จ</div><div class="v">${r.orders}</div></div>
      <div class="kpi"><div class="k">เฉลี่ย/ออเดอร์</div><div class="v">${baht(r.avg)}</div></div><div class="kpi"><div class="k">${icon('tag', 14)}ส่วนลดที่ให้</div><div class="v">${baht(r.discount)}</div></div><div class="kpi"><div class="k">${icon('x', 14)}ยกเลิก</div><div class="v">${r.cancelled}</div></div></div>
    <div class="card"><h3>${icon('chart', 18)}ยอดขายรายวัน</h3>${r.byDay.length ? `<div style="overflow-x:auto"><div style="min-width:${Math.max(280, r.byDay.length * 26)}px"><div class="bars">${r.byDay.map(d => `<div class="bar" title="${d.day}: ${baht(d.revenue)} (${d.orders} ออเดอร์)"><em>${d.revenue}</em><i style="height:${Math.max(2, d.revenue / maxD * 100)}%"></i></div>`).join('')}</div>
      <div class="bar-lbl">${r.byDay.map(d => `<span>${d.day.slice(8)}</span>`).join('')}</div></div></div>` : '<p class="muted small">ยังไม่มีข้อมูลในช่วงนี้</p>'}</div>
    <div class="card"><h3>${icon('clock', 18)}ช่วงเวลาขายดี (ออเดอร์/ชั่วโมง)</h3><div style="overflow-x:auto"><div style="min-width:320px"><div class="bars">${r.byHour.map((n, h) => `<div class="bar" title="${h}:00 = ${n} ออเดอร์"><em>${n || ''}</em><i style="height:${n ? Math.max(4, n / maxH * 100) : 2}%;opacity:${n ? 1 : .25}"></i></div>`).join('')}</div>
      <div class="bar-lbl">${r.byHour.map((n, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('')}</div></div></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><div class="card"><h3>${icon('star', 18)}เมนูขายดี Top 10</h3>${r.top.map((x, i) => `<div class="mb"><div class="row between"><span><b>${i + 1}.</b> ${esc(x.name)}</span><span class="small muted">${x.qty} ชิ้น · ${baht(x.revenue)}</span></div><div class="hbar"><i style="width:${x.qty / maxT * 100}%"></i></div></div>`).join('') || '<p class="muted small">ยังไม่มีข้อมูล</p>'}</div>
    <div class="card"><h3>${icon('cash', 18)}ช่องทางชำระเงิน</h3><div class="row between"><span>พร้อมเพย์</span><b>${baht(r.pay.promptpay)}</b></div><div class="hbar"><i style="width:${r.pay.promptpay / payTot * 100}%"></i></div>
      <div class="row between mt"><span>เงินสด</span><b>${baht(r.pay.cash)}</b></div><div class="hbar"><i style="width:${r.pay.cash / payTot * 100}%"></i></div>
      </div></div>`;
  $('#rf').onchange = $('#rt').onchange = () => viewReport($('#rf').value, $('#rt').value);
  $$('[data-rr]').forEach(b => (b.onclick = () => { const [a, z] = b.dataset.rr.split('|'); viewReport(a, z); }));
  $('#csv').onclick = exportCSV;
}
async function exportCSV() {
  const [f, t] = REP, rows = await api(`/api/admin/orders?from=${f}&to=${t}`), q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['วันที่', 'คิว', 'ลูกค้า', 'อีเมล', 'ชำระด้วย', 'สถานะ', 'รายการ', 'ค่าอาหาร', 'ส่วนลดคูปอง', 'ส่วนลดแต้ม', 'ยอดรวม'];
  download('﻿' + [head.map(q).join(','), ...rows.map(o => [dateTH(o.createdAt), o.queueNo, o.name, o.email, o.payment.method, CFG.statusText[o.status], o.items.map(i => `${i.name}x${i.qty}`).join('; '), o.subtotal, o.discount?.couponAmt || 0, o.discount?.pointsAmt || 0, o.total].map(q).join(','))].join('\r\n'), `orders_${f}_${t}.csv`, 'text/csv;charset=utf-8');
  toast('ส่งออกไฟล์ CSV แล้ว', 'ok');
}

// ================= สมาชิก (เจ้าของ) =================
async function viewMembers() {
  view().innerHTML = '<div class="skel" style="height:200px"></div>';
  let list; try { list = await api('/api/admin/members'); } catch (e) { return toast(e.message, 'err'); }
  const tot = list.reduce((s, u) => s + u.points, 0);
  view().innerHTML = `<div class="kpis"><div class="kpi"><div class="k">${icon('users', 14)}สมาชิกทั้งหมด</div><div class="v">${list.length}</div></div><div class="kpi"><div class="k">${icon('gift', 14)}แต้มคงค้างรวม</div><div class="v">${tot}</div></div></div>
    <div class="search mb"><input id="mq" type="search" placeholder="ค้นหาชื่อ / อีเมล / เบอร์">${icon('search', 18)}</div><div class="card" style="padding:4px 16px" id="mlist2"></div>`;
  const draw = q => { $('#mlist2').innerHTML = list.filter(u => !q || (u.name + u.email + u.phone).toLowerCase().includes(q)).map(u => `<div class="mrow" data-m="${esc(u.email)}"><div class="avatar sm">${esc((u.name || '?').charAt(0).toUpperCase())}</div>
    <div class="grow"><div class="b">${esc(u.name)} ${u.role !== 'customer' ? `<span class="pill pri">${u.role === 'owner' ? 'เจ้าของ' : 'พนักงาน'}</span>` : ''}</div><div class="small muted" style="word-break:break-all">${esc(u.email)}</div></div>
    <div style="text-align:right"><div class="b">${baht(u.spent)}</div><div class="small muted">${u.points} แต้ม</div></div></div>`).join('') || '<div class="empty">ไม่พบสมาชิก</div>'; };
  $('#mq').oninput = e => draw(e.target.value.trim().toLowerCase()); draw('');
  $('#mlist2').onclick = e => { const r = e.target.closest('[data-m]'); if (r) memberSheet(list.find(u => u.email === r.dataset.m)); };
}
function memberSheet(u) {
  const s = openSheet({ title: esc(u.name), body: `<div class="card"><div class="setrow"><span class="muted">อีเมล</span><b style="word-break:break-all;text-align:right">${esc(u.email)}</b></div><div class="setrow"><span class="muted">เบอร์</span><b>${esc(u.phone || '-')}</b></div>
    <div class="setrow"><span class="muted">สั่งสำเร็จ</span><b>${u.orderCount} ครั้ง</b></div><div class="setrow"><span class="muted">ยอดซื้อรวม</span><b>${baht(u.spent)}</b></div>
    <div class="setrow"><span class="muted">สั่งล่าสุด</span><b>${u.lastOrder ? dateTH(u.lastOrder) : '-'}</b></div><div class="setrow"><span class="muted">แต้มคงเหลือ</span><b class="price">${u.points}</b></div></div>`,
    footer: `<button class="btn primary lg block" id="adj">${icon('gift', 18)}ปรับแต้ม (เพิ่ม/ลด)</button>` });
  s.q('#adj').onclick = async () => {
    const r = await formSheet({ title: `ปรับแต้ม · ${u.name}`, intro: 'ใส่เลขบวกเพื่อเพิ่ม ใส่ลบเพื่อลด (เช่น -10)', fields: [{ id: 'delta', label: 'จำนวนแต้ม', type: 'number', inputmode: 'numeric', placeholder: '10' }, { id: 'reason', label: 'เหตุผล', value: 'โบนัส', chips: ['โบนัส', 'ชดเชย', 'แก้ไขข้อผิดพลาด'] }] });
    if (!r) return;
    try { await api('/api/admin/members/adjust', { method: 'POST', body: { email: u.email, delta: r.delta, reason: r.reason } }); toast('ปรับแต้มแล้ว', 'ok'); s.close(); viewMembers(); } catch (e) { toast(e.message, 'err'); }
  };
}

// ================= ตั้งค่า (เจ้าของ) =================
function viewSettings() {
  const s = SET, sw = (k, t, d) => `<div class="setrow"><div class="grow"><div class="b">${t}</div>${d ? `<div class="small muted">${d}</div>` : ''}</div><label class="sw"><input type="checkbox" id="s_${k}" ${s[k] ? 'checked' : ''}><i></i></label></div>`;
  const fld = (k, l, type = 'text', h = '') => `<div class="field"><label>${l}</label><input id="s_${k}" type="${type}" ${type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(s[k])}">${h ? `<div class="hint">${h}</div>` : ''}</div>`;
  view().innerHTML = `${CFG.devMode ? `<div class="banner closed">${icon('alert', 18)}<span>โหมดทดสอบ (ยังไม่ตั้ง GOOGLE_CLIENT_ID) — ห้ามเปิดใช้งานจริงในโหมดนี้</span></div>` : ''}
    <div class="card"><h3>${icon('store', 18)}ข้อมูลร้าน</h3>${fld('shopName', 'ชื่อร้าน')}${fld('promptpayId', 'พร้อมเพย์ (เบอร์ 10 หลัก / เลขบัตรประชาชน 13 หลัก)', 'text', 'ลูกค้าจะโอนเข้าบัญชีนี้ — ตรวจสอบให้ถูกต้อง')}
      <div class="field">
        <label>รูปภาพปกหน้าร้าน (Cover Banner)</label>
        <div style="margin-bottom:8px">
          <img id="coverPreview" src="${esc(s.coverImage || '/img/cover.jpg')}" style="width:100%;height:130px;object-fit:cover;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--surface-2)" onerror="this.src='/img/cover.jpg'">
        </div>
        <div class="row gap-s" style="flex-wrap:wrap">
          <button type="button" class="btn sm soft" id="pickCoverBtn">${icon('image', 16)}เลือกรูปภาพใหม่</button>
          <button type="button" class="btn sm ghost" id="resetCoverBtn">ใช้รูปเริ่มต้น</button>
          <input type="file" id="coverFileInput" accept="image/*" style="display:none">
          <input type="hidden" id="s_coverImage" value="${esc(s.coverImage || '/img/cover.jpg')}">
        </div>
        <div class="hint">รูปภาพหน้าร้านที่ลูกค้าเห็นบนหัวเว็บหน้าสั่งอาหาร (แนะนำแนวนอน 1600x600px)</div>
      </div>
      ${fld('announcement', 'ข้อความประกาศหน้าลูกค้า', 'text', 'เช่น โปรโมชั่น / หยุดวันพรุ่งนี้ (เว้นว่าง = ไม่แสดง)')}</div>
    <div class="card"><h3>${icon('info', 18)}ข้อมูลร้านที่ลูกค้าเห็น</h3>
      ${fld('tagline', 'สโลแกนร้าน', 'text', 'เช่น หอม อร่อย ใส่แน่น กรอบนาน')}
      ${fld('phone', 'เบอร์โทรศัพท์ร้าน (9-10 หลัก)', 'tel', 'ลูกค้ากดโทรออกจากหน้าเว็บได้ทันที เช่น 0987127099')}
      ${fld('hoursText', 'เวลาเปิด-ปิดสำหรับแสดงผล', 'text', 'เช่น ทุกวัน 10:00 - 20:00 น. หรือ จันทร์-เสาร์ 09:00 - 18:00 (เว้นว่าง = ใช้เวลาเปิด-ปิดอัตโนมัติ)')}
      ${fld('address', 'ที่อยู่ร้าน', 'text', 'เช่น ริมคลอง... (เว้นว่าง = ไม่แสดง)')}
      ${fld('mapUrl', 'ลิงก์แผนที่ Google Maps (https://...)', 'url', 'ปุ่ม “เปิดแผนที่” จะพาไปที่นี่ (เว้นว่าง = ไม่แสดง)')}
      <div class="fgrid">
        ${fld('facebookName', 'ชื่อเพจ Facebook (เช่น เครป ริมคลอง)')}
        ${fld('facebookUrl', 'ลิงก์เพจ Facebook (https://...)')}
      </div>
      <div class="fgrid">
        ${fld('lineName', 'ชื่อแสดง LINE (เช่น เครป ริมคลอง)')}
        ${fld('lineId', 'LINE ID ของร้าน (เช่น @348zvedm)', 'text', 'ระบบจะสร้างปุ่มเพิ่มเพื่อนให้อัตโนมัติ')}
      </div>
    </div>
    <div class="card" id="lineOaCard">
      <h3>${icon('message', 18)}เชื่อมต่อ LINE Official Account (แจ้งเตือนออเดอร์)</h3>
      <div class="setrow">
        <div class="grow">
          <div class="b">เปิดส่งการแจ้งเตือนเข้า LINE</div>
          <div class="small muted">ส่งข้อความ Flex Card แสดงคิว รายการอาหาร ยอดเงิน และรูปสลิปเข้า LINE อัตโนมัติ</div>
        </div>
        <label class="sw"><input type="checkbox" id="s_lineNotifyEnabled" ${s.lineNotifyEnabled !== false ? 'checked' : ''}><i></i></label>
      </div>

      <div class="field mt-s">
        <label>Webhook URL (นำไปใส่ที่ LINE Developers)</label>
        <div class="row gap-s">
          <input id="lineWebhookUrl" type="text" readonly value="${location.origin}/api/line/webhook" style="font-family:monospace;font-size:14px;background:var(--surface-2)">
          <button type="button" class="btn sm soft" id="copyWebhookBtn">${icon('copy', 16)}คัดลอก</button>
        </div>
        <div class="hint">ไปที่ LINE Developers &gt; Messaging API &gt; วางในช่อง <b>Webhook URL</b> แล้วเปิดสวิตช์ <b>Use Webhook</b></div>
      </div>

      ${fld('lineChannelAccessToken', 'Channel Access Token (Long-lived)', 'text', 'คัดลอกได้จากแท็บ Messaging API ใน LINE Developers Console')}
      ${fld('lineChannelSecret', 'Channel Secret', 'text', 'คัดลอกได้จากแท็บ Basic settings ใน LINE Developers Console')}
      ${fld('lineAdminUserIds', 'LINE Admin User ID (สำหรับรับการแจ้งเตือน)', 'text', 'เช่น U123456789... คั่นด้วยเครื่องหมายจุลภาค (,) หรือพิมพ์ “ลงทะเบียน” ในแชท LINE OA เพื่อเปิดรับอัตโนมัติ')}

      <div class="row gap-s mt-m" style="flex-wrap:wrap">
        <button type="button" class="btn sm primary" id="testLineBtn">${icon('bell', 16)}ทดสอบส่งการแจ้งเตือนเข้า LINE</button>
        <button type="button" class="btn sm ghost" id="refreshLineSubsBtn">${icon('repeat', 16)}ดูรายชื่อผู้รับแจ้งเตือน</button>
      </div>

      <div id="lineSubsBox" class="mt-s p-s" style="background:var(--surface-2);border-radius:var(--r-sm);display:none">
        <div class="small b mb-xs">รายชื่อบัญชี LINE ที่เปิดรับการแจ้งเตือน:</div>
        <div id="lineSubsList" class="small"></div>
      </div>

      <details style="margin-top:12px;background:var(--surface-2);border-radius:var(--r-sm);padding:10px 14px;font-size:13px;line-height:1.6">
        <summary style="font-weight:700;cursor:pointer;color:var(--pri)">📖 ดูขั้นตอนการตั้งค่า LINE Official Account ใน 4 ขั้นตอน</summary>
        <ol style="margin:8px 0 0 18px;padding:0">
          <li>เปิด <a href="https://developers.line.biz" target="_blank" style="color:var(--pri);font-weight:700">LINE Developers Console</a> สร้าง Provider และ Channel ประเภท <b>Messaging API</b></li>
          <li>ที่แท็บ <b>Messaging API</b>: นำ <code>Webhook URL</code> ด้านบนไปวาง กด <b>Update</b> และเปิดสวิตช์ <b>Use Webhook</b> เป็นสีเขียว</li>
          <li>คัดลอก <b>Channel Access Token</b> และ <b>Channel Secret</b> มาวางในช่องด้านบน แล้วกด "บันทึกการตั้งค่า"</li>
          <li>แอดไลน์ OA ของร้าน (@348zvedm) แล้วส่งข้อความคำว่า <b>"ลงทะเบียน"</b> เพื่อเปิดรับการแจ้งเตือนออเดอร์ทันที</li>
        </ol>
      </details>
    </div>
    <div class="card"><h3>${icon('clock', 18)}เวลา & การรับออเดอร์</h3>${sw('accepting', 'เปิดรับออเดอร์', 'ปิดชั่วคราวเมื่อยุ่งมาก/ของหมด')}${sw('useHours', 'เปิด-ปิดรับออเดอร์ตามเวลาอัตโนมัติ')}
      <div class="fgrid mt-s">${fld('openTime', 'เวลาเปิด', 'time')}${fld('closeTime', 'เวลาปิด', 'time')}${fld('prepMinutes', 'เวลาทำโดยประมาณ (นาที)', 'number')}${fld('autoCancelMinutes', 'ยกเลิกถ้าไม่จ่ายใน (นาที)', 'number', '0 = ไม่ยกเลิกอัตโนมัติ')}</div></div>
    <div class="card"><h3>${icon('cash', 18)}การชำระเงิน</h3>${sw('allowCash', 'รับเงินสดที่ร้าน')}${sw('requireSlip', 'บังคับแนบสลิปก่อนกด “โอนแล้ว”')}</div>
    <div class="card"><h3>${icon('gift', 18)}แต้มสะสม</h3><div class="fgrid">${fld('earnBahtPerPoint', 'จ่ายทุกกี่บาท ได้ 1 แต้ม', 'number')}${fld('pointValue', '1 แต้ม = ส่วนลดกี่บาท', 'number')}${fld('maxRedeemPercent', 'ใช้แต้มลดได้สูงสุด (% ของยอด)', 'number')}</div></div>
    <div class="card"><h3>${icon('users', 18)}พนักงาน & แจ้งเตือน</h3><div class="field"><label>อีเมล Google ของพนักงาน (บรรทัดละ 1 อีเมล)</label><textarea id="s_staff" rows="3" placeholder="staff@gmail.com">${esc((s.staff || []).join('\n'))}</textarea>
      <div class="hint">พนักงานดูออเดอร์/ยืนยัน/ปรับสต็อกได้ แต่แก้เมนู ตั้งค่า รายงานไม่ได้ · เจ้าของร้าน: ${esc((s.owners || []).join(', '))}</div></div>
      ${fld('webhookUrl', 'Webhook แจ้งเตือนสำรอง (Discord/Slack, https://...)', 'text', 'ส่งข้อความเมื่อมีออเดอร์ที่ต้องตรวจสอบ (ไม่บังคับ)')}</div>
    <div class="card"><h3>${icon('download', 18)}สำรองข้อมูล</h3><p class="small muted mb">ดาวน์โหลดเมนู ออเดอร์ สมาชิก คูปอง ตั้งค่า เป็นไฟล์ JSON ควรทำเป็นประจำ</p><button class="btn ghost" id="bk">${icon('download', 18)}ดาวน์โหลดไฟล์สำรอง</button></div>
    <div class="savebar"><button class="btn primary lg block" id="sSave">${icon('check', 20)}บันทึกการตั้งค่า</button></div>`;

  // Cover image upload logic
  const pickCoverBtn = $('#pickCoverBtn'), coverFileInput = $('#coverFileInput'), coverPreview = $('#coverPreview'), sCoverImage = $('#s_coverImage'), resetCoverBtn = $('#resetCoverBtn');
  if (pickCoverBtn && coverFileInput) {
    pickCoverBtn.onclick = () => coverFileInput.click();
    coverFileInput.onchange = async () => {
      const f = coverFileInput.files[0];
      if (!f) return;
      try {
        toast('กำลังอัปโหลดรูปภาพ...', '');
        const dataUrl = await resizeImage(f, 1600, 0.85);
        const r = await api('/api/admin/upload', { method: 'POST', body: { image: dataUrl } });
        sCoverImage.value = r.url;
        coverPreview.src = r.url;
        toast('อัปโหลดรูปภาพเรียบร้อยแล้ว กด "บันทึกการตั้งค่า" ด้านล่าง', 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    resetCoverBtn.onclick = () => {
      sCoverImage.value = '/img/cover.jpg';
      coverPreview.src = '/img/cover.jpg';
      toast('ตั้งเป็นรูปเริ่มต้นแล้ว กด "บันทึกการตั้งค่า" ด้านล่าง', 'ok');
    };
  }

  // LINE OA logic
  const copyWebhookBtn = $('#copyWebhookBtn');
  if (copyWebhookBtn) {
    copyWebhookBtn.onclick = () => {
      copyText($('#lineWebhookUrl').value);
      toast('คัดลอก Webhook URL แล้ว', 'ok');
    };
  }

  const testLineBtn = $('#testLineBtn');
  if (testLineBtn) {
    testLineBtn.onclick = async () => {
      testLineBtn.disabled = true;
      const oldHtml = testLineBtn.innerHTML;
      testLineBtn.textContent = 'กำลังส่งทดสอบ...';
      try {
        const res = await api('/api/admin/line/test', { method: 'POST', body: {} });
        toast(`ส่งข้อความแจ้งเตือนเข้า LINE สำเร็จ! (${res.recipients.length} บัญชี)`, 'ok');
      } catch (err) {
        toast('ส่งไม่สำเร็จ: ' + err.message, 'err');
      } finally {
        testLineBtn.disabled = false;
        testLineBtn.innerHTML = oldHtml;
      }
    };
  }

  const refreshLineSubsBtn = $('#refreshLineSubsBtn');
  if (refreshLineSubsBtn) {
    refreshLineSubsBtn.onclick = async () => {
      try {
        const subs = await api('/api/admin/line/subscribers');
        const box = $('#lineSubsBox'), list = $('#lineSubsList');
        box.style.display = 'block';
        if (!subs || !subs.length) {
          list.innerHTML = '<div class="muted">ยังไม่มีผู้ลงทะเบียนผ่านแชท (ให้แอดไลน์ร้าน @348zvedm แล้วพิมพ์ "ลงทะเบียน")</div>';
        } else {
          list.innerHTML = subs.map(sub => `
            <div class="row gap-s py-xs" style="border-bottom:1px solid var(--line);align-items:center">
              <div class="grow"><b>${esc(sub.displayName || 'ผู้ใช้')}</b> <span class="muted font-mono" style="font-size:12px">(${esc(sub.userId)})</span></div>
              <button type="button" class="btn sm bad-soft" data-del-sub="${esc(sub.userId)}">ลบ</button>
            </div>
          `).join('');
          list.querySelectorAll('[data-del-sub]').forEach(b => {
            b.onclick = async () => {
              if (await confirmSheet({ title: 'ลบผู้รับแจ้งเตือน?', ok: 'ลบออก', danger: true })) {
                await api('/api/admin/line/subscribers/' + encodeURIComponent(b.dataset.delSub), { method: 'DELETE' });
                refreshLineSubsBtn.click();
                toast('ลบผู้รับแจ้งเตือนออกแล้ว', 'ok');
              }
            };
          });
        }
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  $('#bk').onclick = async () => { const r = await fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + getToken() } }); download(await r.text(), `pos-backup-${today()}.json`, 'application/json'); toast('ดาวน์โหลดแล้ว', 'ok'); };
  $('#sSave').onclick = async () => {
    const g = k => $('#s_' + k), body = {};
    ['shopName', 'coverImage', 'tagline', 'phone', 'hoursText', 'address', 'mapUrl', 'facebookName', 'facebookUrl', 'lineName', 'lineId', 'promptpayId', 'announcement', 'openTime', 'closeTime', 'prepMinutes', 'autoCancelMinutes', 'earnBahtPerPoint', 'pointValue', 'maxRedeemPercent', 'webhookUrl', 'lineChannelAccessToken', 'lineChannelSecret', 'lineAdminUserIds'].forEach(k => {
      const el = g(k);
      body[k] = el ? el.value : '';
    });
    ['accepting', 'useHours', 'allowCash', 'requireSlip', 'lineNotifyEnabled'].forEach(k => {
      const el = g(k);
      body[k] = el ? el.checked : false;
    });
    body.staff = g('staff').value.split(/[\n,]+/);
    try {
      SET = await api('/api/admin/settings', { method: 'PUT', body });
      CFG.shopName = SET.shopName;
      renderTop();
      buildNav();
      show('settings', true);
      toast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
}

// ================= QR =================
function viewQR() {
  view().innerHTML = `<div class="card qrcard"><h3 style="justify-content:center">${icon('qr', 18)}QR สำหรับให้ลูกค้าสแกน</h3>
      <div class="field mt" style="text-align:left"><label>ลิงก์หน้าสั่งอาหาร</label><input id="siteUrl" value="${esc(location.origin + '/')}"><div class="hint">ใช้งานจริงให้ใส่ลิงก์ https ของร้านบนอินเทอร์เน็ต</div></div>
      <button class="btn primary" id="mk">สร้าง QR ร้าน</button><div id="qrimg" class="mt"></div></div>`;
  const qr = async u => (await api('/api/admin/siteqr?url=' + encodeURIComponent(u))).qr, base = () => $('#siteUrl').value.replace(/\/?(\?.*)?$/, '/');
  $('#mk').onclick = async () => { try { const q = await qr(base()); $('#qrimg').innerHTML = `<img src="${q}" alt="QR" style="width:min(80vw,280px)"><div class="mt"><a class="btn soft" href="${q}" download="shop-qr.png">${icon('download', 18)}ดาวน์โหลดรูป QR</a></div>`; } catch (e) { toast(e.message, 'err'); } };
}
