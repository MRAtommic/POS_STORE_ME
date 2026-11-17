// ================= ตัวช่วยที่ใช้ร่วมกันทุกหน้า =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateTH = ts => new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const timeTH = ts => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const optionText = i => Array.isArray(i.options) ? i.options.map(o => o.name || o).join(', ') : (typeof i.options === 'string' ? i.options : '');
const ORDER_TYPE = { dine_in: 'ทานที่ร้าน', takeaway: 'กลับบ้าน' };
const phoneFormat = p => {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return p;
};
let CFG = null, ME = null;

const TH_D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'], TH_U = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
function thaiNum(n) {
  n = Math.round(Math.abs(Number(n) || 0)); if (n === 0) return 'ศูนย์';
  const chunk = x => {
    const s = String(x), L = s.length; let out = '';
    for (let i = 0; i < L; i++) {
      const d = +s[i], pos = L - i - 1; if (!d) continue;
      if (pos === 1) out += (d === 1 ? '' : d === 2 ? 'ยี่' : TH_D[d]) + 'สิบ';
      else if (pos === 0) out += (d === 1 && L > 1 ? 'เอ็ด' : TH_D[d]);
      else out += TH_D[d] + TH_U[pos];
    }
    return out;
  };
  if (n < 1e6) return chunk(n); const hi = Math.floor(n / 1e6), lo = n % 1e6; return thaiNum(hi) + 'ล้าน' + (lo ? chunk(lo) : '');
}
window.thaiNum = thaiNum;

// ---------- ไอคอน (stroke) ----------
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>', alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  utensils: '<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.7 4.7 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', chart: '<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4"/>',
  box: '<path d="m7.5 4.3 9 5.2"/><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2"/>', more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', chevR: '<path d="m9 18 6-6-6-6"/>', chevL: '<path d="m15 18-6-6 6-6"/>',
  chevU: '<path d="m18 15-6-6-6 6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', store: '<path d="m2 7 1.5-4h17L22 7"/><path d="M2 7a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M4 10v11h16V10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>', phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3 0 1.4 1 2.5 2.5 2.5"/>',
  bell2: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};
const icon = (n, s = 20, cls = '') => `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ---------- ระบบธีม (Dark / Light) ----------
function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pos_theme', t); } catch {}
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

// emoji แทนรูปเมนูที่ยังไม่มีรูป (ยกเลิกตามดีไซน์ใหม่)
function dishEmoji(name = '', cat = '') {
  return '';
}

// ---------- เสียง/สั่น ----------
let _actx;
function unlockAudio() { try { _actx = _actx || new (window.AudioContext || window.webkitAudioContext)(); if (_actx.state === 'suspended') _actx.resume(); } catch {} }
document.addEventListener('pointerdown', unlockAudio, { once: true });
function ding(times = 1) {
  try {
    unlockAudio();
    for (let i = 0; i < times; i++) {
      const o = _actx.createOscillator(), g = _actx.createGain();
      o.connect(g); g.connect(_actx.destination); o.type = 'sine'; o.frequency.value = i % 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, _actx.currentTime + i * 0.22); g.gain.exponentialRampToValueAtTime(0.25, _actx.currentTime + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, _actx.currentTime + i * 0.22 + 0.2);
      o.start(_actx.currentTime + i * 0.22); o.stop(_actx.currentTime + i * 0.22 + 0.22);
    }
  } catch {}
}
const buzz = ms => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch {} };

// ---------- API ----------
const getToken = () => { try { return localStorage.getItem('pos_token'); } catch { return null; } };
const setToken = t => { try { t ? localStorage.setItem('pos_token', t) : localStorage.removeItem('pos_token'); } catch {} };
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t;
  let res;
  try { res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setToken(null); ME = null; }
  if (!res.ok) throw Object.assign(new Error(data.error || 'เกิดข้อผิดพลาด'), { status: res.status });
  return data;
}

// ---------- Toast ----------
function toast(msg, type = '', onUndo = null) {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const el = document.createElement('div'); el.className = 'toast ' + type;
  el.innerHTML = `<span>${esc(msg)}</span>${onUndo ? '<button type="button" class="toast-btn">เลิกทำ</button>' : ''}`;
  if (onUndo) {
    const b = el.querySelector('.toast-btn');
    if (b) b.onclick = () => { el.remove(); try { onUndo(); } catch (err) { console.error(err); } };
  }
  box.appendChild(el); if (type === 'err') buzz(60);
  const dur = onUndo ? 5000 : (type === 'err' ? 3600 : 2200);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, dur);
}

// ---------- Bottom sheet ----------
let _sheetStack = [];
let _sheetIdSeq = 0;
window.addEventListener('popstate', () => {
  if (_sheetStack.length) {
    const top = _sheetStack[_sheetStack.length - 1];
    top.close(null, true);
  }
});

function openSheet({ title = '', body = '', footer = '', full = false, wide = false, onClose } = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${full ? 'full' : ''} ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div>
    <div class="sheet-h"><h2>${title}</h2><button class="icon-btn" data-close aria-label="ปิด">ปิด</button></div>
    <div class="sheet-b">${body}</div>${footer ? `<div class="sheet-f">${footer}</div>` : '<div class="sheet-f" hidden></div>'}</div>`;
  document.body.appendChild(ov); document.body.classList.add('lock');
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('show')));
  setTimeout(() => ov.classList.add('show'), 60);

  const myId = ++_sheetIdSeq;
  history.pushState({ modal: 'sheet', sheetId: myId }, '');

  const api = {
    el: ov, id: myId, q: s => $(s, ov), qa: s => $$(s, ov),
    setBody(html) { const b = $('.sheet-b', ov), y = b.scrollTop; b.innerHTML = html; b.scrollTop = y; },
    setFooter(html) { const f = $('.sheet-f', ov); f.hidden = !html; f.innerHTML = html || ''; },
    setTitle(t) { $('.sheet-h h2', ov).innerHTML = t; },
    close(result, fromPop = false) {
      if (api.closed) return; api.closed = true; _sheetStack = _sheetStack.filter(x => x !== api);
      ov.classList.remove('show'); setTimeout(() => ov.remove(), 220);
      if (!_sheetStack.length) document.body.classList.remove('lock');
      if (!fromPop && history.state && history.state.modal === 'sheet') {
        history.back();
      }
      onClose && onClose(result);
    },
  };
  ov.addEventListener('mousedown', e => { if (e.target === ov) api.close(); });
  ov.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  _sheetStack.push(api);
  return api;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _sheetStack.length) _sheetStack[_sheetStack.length - 1].close(); });
const closeAllSheets = () => [..._sheetStack].forEach(s => s.close());

function confirmSheet({ title = 'ยืนยัน', text = '', ok = 'ยืนยัน', danger = false } = {}) {
  return new Promise(res => {
    const s = openSheet({ title: esc(title), body: `<p class="muted" style="padding:4px 0 8px">${esc(text)}</p>`,
      footer: `<div class="row"><button class="btn ghost grow" data-close>ยกเลิก</button><button class="btn ${danger ? 'bad' : 'primary'} grow" id="cfOk">${esc(ok)}</button></div>`, onClose: r => res(r === true) });
    s.q('#cfOk').onclick = () => s.close(true);
  });
}
// ฟอร์มสั้นๆ แบบ sheet: fields = [{id,label,type,value,placeholder,chips:[...]}]
function formSheet({ title, fields, ok = 'บันทึก', danger = false, intro = '' }) {
  return new Promise(res => {
    const s = openSheet({ title: esc(title), body: (intro ? `<p class="muted mb">${esc(intro)}</p>` : '') + fields.map(f => `<div class="field"><label>${esc(f.label)}</label>
      <input id="ff_${f.id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}>
      ${f.chips ? `<div class="row wrap gap-s mt-s">${f.chips.map(c => `<button type="button" class="chip" data-chip="${f.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</div>`).join(''),
      footer: `<div class="row"><button class="btn ghost grow" data-close>ยกเลิก</button><button class="btn ${danger ? 'bad' : 'primary'} grow" id="fOk">${esc(ok)}</button></div>`, onClose: r => res(r || null) });
    s.qa('[data-chip]').forEach(b => (b.onclick = () => { s.q('#ff_' + b.dataset.chip).value = b.dataset.v; }));
    s.q('#fOk').onclick = () => s.close(Object.fromEntries(fields.map(f => [f.id, s.q('#ff_' + f.id).value])));
    setTimeout(() => { const i = s.q('input'); i && i.focus(); }, 300);
  });
}

// ---------- สถานะออเดอร์ ----------
const STATUS_UI = { pending_payment: ['warn', 'clock'], payment_claimed: ['warn', 'clock'], paid: ['info', 'check'], preparing: ['info', 'flame'], ready: ['ok', 'bell2'], done: ['ok', 'check'], rejected: ['bad', 'x'] };
const statusPill = s => `<span class="pill ${(STATUS_UI[s] || ['', ''])[0]}">${esc((CFG && CFG.statusText[s]) || s)}</span>`;

// ---------- ล็อกอิน ----------
async function initAuth({ requireLogin = false } = {}) {
  CFG = await fetch('/api/config').then(r => r.json());
  if (getToken()) { try { ME = await api('/api/me'); } catch { ME = null; } }
  if (!ME && requireLogin) await showLogin({ canSkip: false });
  return ME;
}
function showLogin({ canSkip = true } = {}) {
  return new Promise(resolve => {
    let onTh = null;
    const ov = document.createElement('div'); ov.className = 'login';
    ov.innerHTML = `<div class="box" style="position:relative">
      ${canSkip ? `<button type="button" class="icon-btn" id="closeLoginBtn" aria-label="ปิด" title="ปิด / สั่งโดยไม่ล็อกอิน" style="position:absolute;top:0;right:0;border-radius:50%">${icon('x', 20)}</button>` : ''}
      <h1>${esc(CFG.shopName)}</h1>
      ${CFG.tagline ? `<div class="muted mt-s" style="font-size:20px">${esc(CFG.tagline)}</div>` : ''}
      <p class="mt-s">เข้าสู่ระบบเพื่อสั่งอาหารและสะสมแต้ม</p>
      <div class="panel"><div id="gbtn"></div>
        <div id="devForm" hidden><div class="banner" style="text-align:left"><span>โหมดทดสอบ: ยังไม่ได้ตั้งค่า Google Client ID</span></div>
          <div class="field"><input id="devName" placeholder="ชื่อ"></div><div class="field"><input id="devEmail" placeholder="อีเมล" type="email" inputmode="email"></div>
          <button class="btn primary block lg" id="devGo">เข้าสู่ระบบ (ทดสอบ)</button></div>
        ${canSkip ? `
          <div style="display:flex;align-items:center;gap:12px;margin:16px 0 12px">
            <hr style="flex:1;border:0;border-top:1px solid var(--line)">
            <span class="muted tiny">หรือ</span>
            <hr style="flex:1;border:0;border-top:1px solid var(--line)">
          </div>
          <button type="button" class="btn soft block lg" id="skipLoginBtn" style="font-size:18px;font-weight:700">
            สั่งโดยไม่ล็อกอิน (ข้าม) ›
          </button>
        ` : ''}
        <p class="faint tiny mt">เข้าสู่ระบบเพื่อเป็นสมาชิก ดูสถานะออเดอร์ และสะสมแต้มส่วนลด</p></div></div>`;
    document.body.appendChild(ov);
    const done = user => {
      if (onTh) document.removeEventListener('themechange', onTh);
      ME = user; ov.remove(); resolve(user);
    };
    const skipAction = async () => {
      try {
        if (!getToken()) {
          const r = await api('/api/auth/guest', { method: 'POST', body: { name: 'ลูกค้าทั่วไป' } });
          setToken(r.token);
          done(r.user);
        } else {
          done(ME);
        }
      } catch {
        done(null);
      }
    };
    const skipBtn = $('#skipLoginBtn', ov);
    if (skipBtn) skipBtn.onclick = skipAction;
    const closeBtn = $('#closeLoginBtn', ov);
    if (closeBtn) closeBtn.onclick = skipAction;
    if (CFG.devMode) {
      $('#gbtn', ov).hidden = true; $('#devForm', ov).hidden = false;
      $('#devGo', ov).onclick = async () => {
        try { const r = await api('/api/auth/dev', { method: 'POST', body: { name: $('#devName', ov).value, email: $('#devEmail', ov).value } }); setToken(r.token); done(r.user); }
        catch (e) { toast(e.message, 'err'); }
      };
    } else {
      const renderGoogleBtn = () => {
        const gEl = $('#gbtn', ov);
        if (!gEl || !window.google?.accounts?.id) return;
        gEl.innerHTML = '';
        const pBox = gEl.parentElement;
        const w = Math.max(200, Math.min(320, Math.floor((pBox ? pBox.clientWidth : 280) - 20)));
        const isDark = (typeof getTheme === 'function' ? getTheme() : (document.documentElement.getAttribute('data-theme') || 'light')) === 'dark';
        google.accounts.id.renderButton(gEl, {
          theme: isDark ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          locale: 'th',
          width: w
        });
      };
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => {
        google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: async resp => {
          try { const r = await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } }); setToken(r.token); done(r.user); }
          catch (e) { toast(e.message, 'err'); } } });
        renderGoogleBtn();
        onTh = () => renderGoogleBtn();
        document.addEventListener('themechange', onTh);
      };
      s.onerror = () => toast('โหลดปุ่ม Google ไม่ได้ ตรวจสอบอินเทอร์เน็ต', 'err');
      document.head.appendChild(s);
    }
  });
}
async function logout() { try { await api('/api/logout', { method: 'POST' }); } catch {} setToken(null); location.href = location.pathname; }

// ---------- WebSocket (เชื่อมต่อใหม่อัตโนมัติ) ----------
function connectWS(onOrder, onOther, onState) {
  let retry = 1000;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${getToken()}`);
    ws.onopen = () => { retry = 1000; onState && onState(true); };
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'order') onOrder && onOrder(m.order); else onOther && onOther(m); };
    ws.onclose = () => { onState && onState(false); setTimeout(open, retry); retry = Math.min(retry * 2, 15000); };
  };
  open();
}

// ---------- รูปภาพ ----------
function resizeImage(file, maxW = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => {
      const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // พื้นขาวแทนพื้นโปร่งใส (ไม่ให้รูป PNG โปร่งใสกลายเป็นพื้นดำ)
      g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('เปิดรูปไม่ได้')); img.src = URL.createObjectURL(file);
  });
}
function confetti(host) {}
const copyText = async t => { try { await navigator.clipboard.writeText(t); toast('คัดลอกแล้ว', 'ok'); } catch { toast('คัดลอกไม่สำเร็จ', 'err'); } };
function download(text, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }

// =====================================================================
// ตรวจจับ In-App Browser (LINE, Facebook, Instagram, TikTok ฯลฯ)
// และแสดงปุ่มแจ้งเตือนให้เปิดในเว็บเบราว์เซอร์หลัก (Chrome / Safari)
// =====================================================================
function checkInAppBrowser() {
  if (location.pathname.includes('admin') || location.pathname.includes('queue')) return;

  const ua = navigator.userAgent || '';
  const isLine = /Line\//i.test(ua);
  const isFB = /FBAN|FBAV|FB_IAB|Messenger/i.test(ua);
  const isIG = /Instagram/i.test(ua);
  const isTikTok = /TikTok|ByteDance/i.test(ua);
  const isOther = /MicroMessenger|Twitter|Snapchat|Pinterest|\bwv\b|WebView/i.test(ua);
  const isTest = location.search.includes('test_inapp=1');

  if (!isLine && !isFB && !isIG && !isTikTok && !isOther && !isTest) return;

  // สำหรับ LINE: เปิดเบราว์เซอร์ระบบอัตโนมัติผ่าน parameter openExternalBrowser=1
  if (isLine && !location.search.includes('openExternalBrowser=1')) {
    const sep = location.href.includes('?') ? '&' : '?';
    location.replace(location.href + sep + 'openExternalBrowser=1');
    return;
  }

  // หากผู้ใช้เคยกด "ใช้งานต่อในนี้" ในเซสชันปัจจุบัน ให้ซ่อน
  if (sessionStorage.getItem('pos_dismiss_inapp') === '1') return;

  const appName = isLine ? 'LINE' : isFB ? 'Facebook' : isIG ? 'Instagram' : isTikTok ? 'TikTok' : isTest ? 'แอปภายนอก (โหมดทดสอบ)' : 'แอปแชท/โซเชียล';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // เตรียม URL สำหรับเปิดเบราว์เซอร์
  let openUrl = location.href;
  if (isLine) {
    const sep = location.href.includes('?') ? '&' : '?';
    openUrl = location.href + sep + 'openExternalBrowser=1';
  } else if (isAndroid) {
    const clean = location.href.replace(/^https?:\/\//, '');
    openUrl = 'intent://' + clean + '#Intent;scheme=https;action=android.intent.action.VIEW;end';
  }

  const renderBanner = () => {
    if (document.getElementById('inAppBanner')) return;
    const bar = document.createElement('div');
    bar.id = 'inAppBanner';
    bar.className = 'inapp-bar';
    bar.innerHTML = `
      <div class="inapp-icon">${icon('globe', 26)}</div>
      <div class="inapp-content">
        <div class="inapp-title">โปรดเปิดด้วยเว็บเบราว์เซอร์ (กำลังเปิดผ่าน ${esc(appName)})</div>
        <div class="inapp-desc">
          การเปิดด้วยเว็บเบราว์เซอร์หลัก (${isIOS ? 'Safari / Chrome' : 'Chrome'}) จะช่วยให้เข้าสู่ระบบด้วย Google, สแกนจ่ายเงิน และรับการแจ้งเตือนได้เสถียรที่สุดครับ
        </div>
        ${isIOS && !isLine ? `
          <div class="inapp-hint">
            💡 แตะปุ่ม <b>⋯</b> หรือปุ่ม <b>แชร์</b> ที่มุมหน้าจอ แล้วเลือก <b>"เปิดในเบราว์เซอร์" (Open in Safari)</b>
          </div>` : ''}
        <div class="inapp-actions">
          <a class="btn primary sm" id="btnOpenBrowser" href="${esc(openUrl)}" ${isAndroid ? '' : 'target="_blank" rel="noopener"'}>
            ${icon('external', 16)} เปิดในเบราว์เซอร์
          </a>
          <button class="btn ghost sm" id="btnCopyInAppLink">
            ${icon('copy', 16)} คัดลอกลิงก์
          </button>
          <button class="btn sm ghost" id="btnCloseInApp" style="border:none;color:var(--muted)">
            ใช้งานต่อในนี้
          </button>
        </div>
      </div>
    `;

    const mount = () => {
      const topTarget = document.getElementById('banners') || document.getElementById('main') || document.body.firstChild;
      if (topTarget && topTarget.parentNode) {
        if (topTarget.id === 'banners') topTarget.prepend(bar);
        else topTarget.parentNode.insertBefore(bar, topTarget);
      } else {
        document.body.prepend(bar);
      }

      const btnCopy = document.getElementById('btnCopyInAppLink');
      if (btnCopy) {
        btnCopy.onclick = async () => {
          const cleanLink = location.href.replace(/([?&])(openExternalBrowser|test_inapp)=1&?/, '').replace(/\?$/, '');
          await copyText(cleanLink);
          toast('คัดลอกลิงก์แล้ว นำไปวางในเบราว์เซอร์ได้เลย', 'ok');
        };
      }
      const btnClose = document.getElementById('btnCloseInApp');
      if (btnClose) {
        btnClose.onclick = () => {
          bar.remove();
          try { sessionStorage.setItem('pos_dismiss_inapp', '1'); } catch {}
        };
      }
    };

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBanner);
  } else {
    renderBanner();
  }
}
try { checkInAppBrowser(); } catch {}
