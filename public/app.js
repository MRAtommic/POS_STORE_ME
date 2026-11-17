// ================= แอปฝั่งลูกค้า =================
let MENU = null, MINE = [], view = 'menu', query = '', cart = [], catIdx = 0;
try { cart = JSON.parse(sessionStorage.getItem('pos_cart') || '[]'); } catch { cart = []; }
const saveCart = () => { try { sessionStorage.setItem('pos_cart', JSON.stringify(cart)); } catch { } };
const isActive = o => !['done', 'rejected'].includes(o.status);
let checkout = { method: 'promptpay', coupon: '', usePoints: false, phone: '', name: '', discountOpen: false };

(async function boot() {
  await initAuth({ requireLogin: false });
  document.title = CFG.shopName;
  $('#app').innerHTML = `
    <header class="appbar"><h1 id="shop" class="grow"></h1>
      <button class="icon-btn theme-btn" id="searchBtn" aria-label="ค้นหาเมนู" title="ค้นหาเมนู" style="margin-right:8px">${icon('search', 20)}</button>
      <button class="icon-btn theme-btn" id="themeBtn" aria-label="สลับธีม" title="สลับธีม มืด/สว่าง" style="margin-right:8px">${icon(getTheme() === 'dark' ? 'sun' : 'moon', 20)}</button>
      <button class="btn sm" id="aboutBtn">ข้อมูลร้าน</button></header>
    <main class="page">
      <section id="v-menu">
        <div id="shopHero"></div>
        <div id="queueStatusCard" class="queue-status-card"></div>
        <div id="banners"></div>
        <div class="search" id="searchWrap"><input id="q" type="search" placeholder="ค้นหาเมนู เช่น เครป, ชาไทย, ชีส..." autocomplete="off" aria-label="ค้นหาเมนู">${icon('search', 18)}<button type="button" id="qClear" class="search-clear" hidden aria-label="ล้างการค้นหา">${icon('x', 16)}</button></div>
        <div class="tabs sticky" id="chips"></div><div id="menuList"></div>
        <div id="shopContact"></div></section>
      <section id="v-orders" hidden></section><section id="v-me" hidden></section>
    </main>
    <div class="cartbar" id="cartbar" hidden></div>
    <nav class="tabbar" aria-label="เมนูหลัก">
      <button data-v="menu" class="on">${icon('utensils', 22)}เมนู</button>
      <button data-v="orders">${icon('receipt', 22)}ออเดอร์ของฉัน<span class="dot" id="orderDot" hidden></span></button>
      <button data-v="me">${icon('user', 22)}บัญชี</button></nav>`;
  const qInput = $('#q'), qClear = $('#qClear'), searchBtn = $('#searchBtn');
  if (qInput) {
    qInput.oninput = e => {
      query = e.target.value.trim();
      if (qClear) qClear.hidden = !query;
      renderList();
    };
  }
  if (qClear) {
    qClear.onclick = () => {
      if (qInput) {
        qInput.value = '';
        query = '';
        qClear.hidden = true;
        renderList();
        qInput.focus();
      }
    };
  }
  if (searchBtn) {
    searchBtn.onclick = () => {
      if (view !== 'menu') go('menu');
      const sWrap = $('#searchWrap');
      if (sWrap) {
        sWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (qInput) {
        setTimeout(() => qInput.focus(), 250);
      }
    };
  }
  $$('.tabbar button').forEach(b => (b.onclick = () => go(b.dataset.v)));
  $('#aboutBtn').onclick = about;
  const updateThemeBtn = () => {
    const tb = $('#themeBtn');
    if (!tb) return;
    const isDark = getTheme() === 'dark';
    tb.innerHTML = icon(isDark ? 'sun' : 'moon', 20);
    tb.title = isDark ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด';
    const sw = $('#themeMeSw');
    if (sw) sw.checked = isDark;
  };
  const tb = $('#themeBtn');
  if (tb) tb.onclick = () => { toggleTheme(); updateThemeBtn(); };
  document.addEventListener('themechange', updateThemeBtn);
  $('#menuList').innerHTML = '<div class="skel" style="height:110px;margin-bottom:10px"></div>'.repeat(4);
  renderMe();
  const initHash = location.hash.replace(/^#/, '');
  if (['menu', 'orders', 'me'].includes(initHash)) go(initHash, false);
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace(/^#/, '');
    if (['menu', 'orders', 'me'].includes(h) && h !== view) go(h, false);
  });
  await Promise.all([loadMenu(), loadMine()]);
  renderCartBar();
  connectWS(async o => {
    await loadMine(); refreshMe();
    updateQueueStatus();
    if (o.status === 'ready') { ding(3); buzz([200, 100, 200]); toast(`ออเดอร์ #${o.queueNo} พร้อมรับแล้ว`, 'ok'); }
    else if (o.status === 'paid') toast(`ออเดอร์ #${o.queueNo}: ร้านรับเงินแล้ว`, 'ok');
    else if (o.status === 'rejected' && o.history.at(-1).by !== 'customer') toast(`ออเดอร์ #${o.queueNo} ถูกยกเลิก`, 'err');
  }, m => {
    if (m.type === 'menu' || m.type === 'order') {
      loadMenu();
      updateQueueStatus();
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadMenu(); loadMine(); updateQueueStatus(); } });
})();

function go(v, updateHash = true) {
  view = v; window.scrollTo(0, 0);
  ['menu', 'orders', 'me'].forEach(n => ($('#v-' + n).hidden = n !== v));
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'orders') renderOrders(); if (v === 'me') renderMe();
  renderCartBar();
  if (updateHash && location.hash !== '#' + v) {
    location.hash = '#' + v;
  }
}

// ---------- เมนู ----------
async function loadMenu() {
  try { CFG = await fetch('/api/config').then(r => r.json()); MENU = await fetch('/api/menu').then(r => r.json()); } catch { return toast('โหลดเมนูไม่สำเร็จ', 'err'); }
  $('#shop').textContent = CFG.shopName;

  renderShopHero();
  updateQueueStatus();

  const ann = (CFG.announcement || '').trim();
  const isGenericWelcome = ann === 'ยินดีต้อนรับสู่เครปริมคลอง' || ann === 'ยินดีต้อนรับสู่' + CFG.shopName || ann === 'ยินดีต้อนรับ' || ann === 'ยินดีต้อนรับสู่ เครป ริมคลอง';
  $('#banners').innerHTML = (CFG.shop.open ? '' : `<div class="banner closed"><span>${esc(CFG.shop.reason)} ดูเมนูได้ แต่ยังสั่งไม่ได้</span></div>`) +
    (!isGenericWelcome && ann ? `<div class="banner"><span>${esc(ann)}</span></div>` : '');

  // แสดงช่องค้นหาเสมอ
  const searchWrap = $('#searchWrap');
  if (searchWrap) searchWrap.hidden = false;

  renderCategoryTabs();
  renderList();
  renderContactBlock();
  renderCartBar();
}

function renderShopHero() {
  const hero = $('#shopHero');
  if (!hero || !CFG) return;
  const isOpen = CFG.shop && CFG.shop.open;
  const coverSrc = CFG.coverImage || '/img/cover.jpg';
  hero.innerHTML = `
    <div class="store-hero">
      <div class="store-hero-cover">
        <img src="${esc(coverSrc)}" alt="${esc(CFG.shopName)}" class="store-hero-img">
        <div class="store-hero-overlay"></div>
        <div class="store-hero-content">
          <div class="store-hero-status ${isOpen ? 'open' : 'closed'}">
            <span class="pulse-dot"></span>
            <span>${isOpen ? 'เปิดรับออเดอร์ปกติ' : 'ปิดรับออเดอร์ชั่วคราว'}</span>
          </div>
          <h2 class="store-hero-title">${esc(CFG.shopName)}</h2>
          <p class="store-hero-tagline">${esc(CFG.tagline || 'หอม อร่อย ใส่แน่น กรอบนาน')}</p>
        </div>
      </div>
    </div>`;
}

async function updateQueueStatus() {
  const card = $('#queueStatusCard');
  if (!card) return;
  try {
    const q = await fetch('/api/queue').then(r => r.json());
    const prepCount = (q.preparing || []).length;
    const readyCount = (q.ready || []).length;
    const isOpen = CFG && CFG.shop && CFG.shop.open;

    if (!isOpen) {
      card.innerHTML = `
        <div class="q-badge closed">
          <span class="q-indicator red"></span>
          <div class="q-info">
            <span class="q-main">ร้านปิดรับออเดอร์ชั่วคราว</span>
            <span class="q-sub">${esc(CFG && CFG.shop && CFG.shop.reason ? CFG.shop.reason : 'สามารถดูเมนูล่วงหน้าได้')}</span>
          </div>
        </div>`;
      return;
    }

    let statusText = '';
    let waitText = '';
    let indClass = 'green';

    if (prepCount === 0) {
      statusText = 'คิวว่าง ทำได้ทันที';
      waitText = 'เวลารอประมาณ 3–5 นาที';
      indClass = 'green';
    } else if (prepCount === 1) {
      statusText = 'กำลังทำอยู่ 1 คิว';
      waitText = 'เวลารอประมาณ 5–8 นาที';
      indClass = 'green';
    } else if (prepCount <= 3) {
      statusText = `กำลังทำอยู่ ${prepCount} คิว`;
      waitText = `เวลารอประมาณ ${prepCount * 4}–${prepCount * 6} นาที`;
      indClass = 'amber';
    } else {
      statusText = `กำลังทำอยู่ ${prepCount} คิว (คิวค่อนข้างแน่น)`;
      waitText = `เวลารอประมาณ ${prepCount * 5}–${prepCount * 8} นาที`;
      indClass = 'orange';
    }

    card.innerHTML = `
      <div class="q-badge">
        <span class="q-indicator ${indClass}"></span>
        <div class="q-info">
          <span class="q-main">${statusText}</span>
          <span class="q-sub">${waitText}${readyCount > 0 ? ` · รอรับหน้าร้าน ${readyCount} คิว` : ''}</span>
        </div>
        <div class="q-pill">${icon('clock', 14)}<span>สถานะสด</span></div>
      </div>`;
  } catch (err) {}
}

function renderContactBlock() {
  const box = $('#shopContact');
  if (!box || !CFG) return;
  const socials = [];
  if (CFG.facebookUrl) {
    socials.push(`<a class="btn soft grow" href="${esc(CFG.facebookUrl)}" target="_blank" rel="noopener" style="min-height:48px;font-size:18px;white-space:nowrap">${icon('external', 16)}Facebook</a>`);
  }
  if (CFG.lineId) {
    socials.push(`<a class="btn soft grow" href="https://line.me/R/ti/p/~${esc(CFG.lineId.replace(/^@/, ''))}" target="_blank" rel="noopener" style="min-height:48px;font-size:18px;white-space:nowrap">${icon('external', 16)}LINE</a>`);
  }
  const hasPhone = !!CFG.phone;
  if (!hasPhone && !socials.length) { box.innerHTML = ''; return; }

  const phoneBtn = hasPhone
    ? `<a class="btn primary block" href="tel:${esc(CFG.phone.replace(/\D/g, ''))}" style="white-space:nowrap;font-size:19px;min-height:50px">${icon('phone', 18)}โทร ${esc(phoneFormat(CFG.phone))}</a>`
    : '';

  const socialsRow = socials.length
    ? `<div class="row gap-s ${hasPhone ? 'mt-s' : ''}" style="width:100%">${socials.join('')}</div>`
    : '';

  box.innerHTML = `<div class="card mt" style="margin-top:28px">
    <div class="card-h">ติดต่อร้าน</div>
    <div class="mt-s">${phoneBtn}${socialsRow}</div>
  </div>`;
}

function renderCategoryTabs() {
  const chips = $('#chips');
  if (!chips || !MENU || !MENU.categories) return;
  chips.innerHTML = MENU.categories.map((c, i) => `<button class="tab ${i === catIdx ? 'on' : ''}" data-i="${i}">${esc(c.name)}</button>`).join('');
  $$('#chips .tab').forEach(btn => {
    btn.onclick = () => {
      catIdx = +btn.dataset.i;
      $$('#chips .tab').forEach(b => b.classList.toggle('on', +b.dataset.i === catIdx));
      renderList();
    };
  });
}

function dish(i, k = 0) {
  const soldOut = !i.available;
  const tags = (i.recommended ? '<span class="tag">แนะนำ</span>' : '') + (i.available && i.stock != null && i.stock <= 5 ? `<span class="tag red">เหลือ ${i.stock}</span>` : '');
  let goHtml = '';
  if (soldOut) {
    goHtml = '<span class="muted small">หมดแล้ว</span>';
  } else if (!CFG.shop.open) {
    goHtml = '<button class="btn sm ghost go" tabindex="-1">ดู</button>';
  } else {
    goHtml = '<button class="btn sm go" tabindex="-1">เลือก</button>';
  }
  return `<div class="dish ${soldOut ? 'off' : ''}" data-id="${esc(i.id)}" role="button" tabindex="0" style="--i:${Math.min(k, 8)}">
    ${i.image ? `<div class="pic"><img src="${esc(i.image)}" alt="" loading="lazy"></div>` : ''}
    <div class="info">
      <div class="nm-row"><span class="nm">${esc(i.name)}</span><span class="price">${baht(i.price)}</span></div>
      ${i.description ? `<div class="ds clamp2">${esc(i.description)}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </div>
    <div class="go">${goHtml}</div>
  </div>`;
}

function renderList() {
  const list = $('#menuList'), q = query.toLowerCase();
  const ch = $('#chips'); if (ch) ch.hidden = !!q;
  if (q) {
    const r = MENU.items.filter(i => (i.name + ' ' + (i.description || '')).toLowerCase().includes(q));
    list.innerHTML = r.length
      ? r.map((i, k) => dish(i, k)).join('')
      : `<div class="empty" style="text-align:center;padding:36px 16px"><div class="b" style="font-size:18px">ไม่พบเมนู “${esc(query)}”</div><div class="muted mt-s small">ลองค้นหาด้วยคำอื่น เช่น เครป, ชา, ชีส</div></div>`;
  } else {
    const cat = MENU.categories[catIdx] || MENU.categories[0];
    if (!cat) { list.innerHTML = ''; return; }
    const its = MENU.items.filter(i => i.category === cat.id);
    list.innerHTML = its.length ? its.map((i, k) => dish(i, k)).join('') : '<div class="empty"><div class="b">ยังไม่มีเมนูในหมวดนี้</div></div>';
  }
}

$('#app').addEventListener('click', e => {
  const d = e.target.closest('.dish');
  if (!d) return;
  if (d.classList.contains('off')) return toast('เมนูนี้หมดแล้ว', 'info');
  openItem(d.dataset.id);
});
$('#app').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const d = e.target.closest('.dish');
    if (!d) return;
    if (d.classList.contains('off')) return toast('เมนูนี้หมดแล้ว', 'info');
    openItem(d.dataset.id);
  }
});

// ---------- popup เลือก option ----------
function openItem(id, preset) {
  const m = MENU.items.find(i => i.id === id);
  if (!m || !m.available) return toast('เมนูนี้หมดแล้ว', 'err');
  const sel = {};
  (m.groups || []).forEach(g => { sel[g.id] = preset && preset.sel[g.id] ? [...preset.sel[g.id]] : g.type === 'single' && g.required ? [g.options[0].id] : []; });
  let qty = preset ? preset.qty : 1, note = preset ? preset.note : '';
  const maxQty = m.stock != null ? Math.min(20, m.stock) : 20;
  const unit = () => (m.groups || []).reduce((u, g) => u + sel[g.id].reduce((s, oid) => s + g.options.find(o => o.id === oid).price, 0), m.price);

  const groupDesc = g => {
    if (g.type === 'single') return g.required ? 'เลือก 1 อย่าง <span class="need">(ต้องเลือก)</span>' : 'เลือก 1 อย่าง (ไม่บังคับ)';
    if (g.max) return `เลือกได้ไม่เกิน ${g.max} อย่าง`;
    return 'เลือกได้หลายอย่าง';
  };

  const optRow = (g, gi, o, oi) => `<label class="opt ${g.type === 'multi' ? 'multi' : ''} ${sel[g.id].includes(o.id) ? 'sel' : ''}">
    <input type="${g.type === 'single' ? 'radio' : 'checkbox'}" name="g${gi}" data-g="${gi}" data-o="${oi}" ${sel[g.id].includes(o.id) ? 'checked' : ''}>
    <span class="ctl">${icon('check', 14)}</span>
    <span class="grow">${esc(o.name)}</span>
    ${o.price ? `<span class="p">+${o.price}</span>` : ''}
  </label>`;

  const body = `${m.image ? `<div class="hero-img pic"><img src="${esc(m.image)}" alt=""></div>` : ''}
    <div class="row between"><h2 style="font-size:22px">${esc(m.name)}</h2><span class="price" style="font-size:20px">${baht(m.price)}</span></div>
    ${m.description ? `<p class="muted mt-s">${esc(m.description)}</p>` : ''}
    ${(m.groups || []).map((g, gi) => `<div class="grp" id="grp${gi}">
      <div class="grp-h">${esc(g.name)}</div>
      <div class="grp-s">${groupDesc(g)}</div>
      <div>${g.type === 'single' && !g.required ? `<label class="opt ${sel[g.id].length ? '' : 'sel'}"><input type="radio" name="g${gi}" data-g="${gi}" data-o="-1" ${sel[g.id].length ? '' : 'checked'}><span class="ctl">${icon('check', 14)}</span><span class="grow">ไม่เลือก</span></label>` : ''}
      ${g.options.map((o, oi) => optRow(g, gi, o, oi)).join('')}</div></div>`).join('')}
    <div class="grp"><div class="grp-h">หมายเหตุถึงร้าน <span class="pill">ไม่บังคับ</span></div><textarea id="note" rows="2" maxlength="200" placeholder="เช่น ไม่ใส่นม, ตัดครึ่ง, แยกถุง">${esc(note)}</textarea></div>`;

  const isOpen = !!CFG.shop.open;
  const footer = isOpen ?
    `<div class="row"><div class="stepper"><button id="mn" aria-label="ลดจำนวน">−</button><b id="qv">${qty}</b><button id="pl" aria-label="เพิ่มจำนวน">+</button></div>
      <button class="btn primary lg grow" id="add"><span id="addTxt"></span></button></div>` :
    `<button class="btn lg block" disabled style="width:100%">ร้านปิดรับออเดอร์</button>`;

  const s = openSheet({ title: '', body, full: true, footer });

  const upd = () => {
    if (isOpen) {
      const qv = s.q('#qv'), at = s.q('#addTxt');
      if (qv) qv.textContent = qty;
      if (at) at.textContent = `${preset && preset.idx != null ? 'บันทึก' : 'ใส่ตะกร้า'} · ${baht(unit() * qty)}`;
    }
    s.qa('.opt').forEach(l => l.classList.toggle('sel', l.querySelector('input').checked));
  };
  s.el.addEventListener('change', e => {
    const t = e.target; if (t.dataset.g === undefined) return;
    const g = m.groups[+t.dataset.g], oi = +t.dataset.o, o = g.options[oi];
    if (g.type === 'single') sel[g.id] = o ? [o.id] : [];
    else if (t.checked) { if (g.max && sel[g.id].length >= g.max) { t.checked = false; return toast(`เลือกได้ไม่เกิน ${g.max} อย่าง`, 'err'); } sel[g.id].push(o.id); }
    else sel[g.id] = sel[g.id].filter(x => x !== o.id);
    buzz(8); upd();
  });
  s.q('#note').oninput = e => (note = e.target.value);
  if (isOpen) {
    s.q('#mn').onclick = () => { qty = Math.max(1, qty - 1); upd(); };
    s.q('#pl').onclick = () => { if (qty >= maxQty) return toast('จำนวนสูงสุดแล้ว', 'err'); qty++; upd(); };
    s.q('#add').onclick = () => {
      const bad = (m.groups || []).findIndex(g => g.required && !sel[g.id].length);
      if (bad >= 0) { const el = s.q('#grp' + bad); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 500); return toast(`กรุณาเลือก “${m.groups[bad].name}”`, 'err'); }
      const entry = {
        menuId: m.id, name: m.name, qty, options: JSON.parse(JSON.stringify(sel)), note, unit: unit(),
        text: (m.groups || []).flatMap(g => sel[g.id].map(oid => g.options.find(o => o.id === oid).name)).join(', ')
      };
      if (preset && preset.idx != null) cart[preset.idx] = entry; else cart.push(entry);
      saveCart(); s.close(); renderCartBar(); toast('เพิ่มลงตะกร้าแล้ว', 'ok'); buzz(15);
      if (preset && preset.reopenCart) openCart();
    };
  }
  upd();
}

// ---------- ตะกร้า ----------
const cartTotal = () => cart.reduce((s, c) => s + c.unit * c.qty, 0);
const cartCount = () => cart.reduce((s, c) => s + c.qty, 0);
function renderCartBar() {
  const bar = $('#cartbar'); if (!bar) return;
  bar.hidden = !cart.length || view !== 'menu';
  bar.innerHTML = `<button class="btn primary"><span>ตะกร้า · ${cartCount()} รายการ</span><b>${baht(cartTotal())} ›</b></button>`;
  bar.firstElementChild.onclick = () => openCart();
}

function openCart() {
  if (!cart.length) return;
  let quote = null, s;
  const body = () => ({ items: cart.map(c => ({ menuId: c.menuId, qty: c.qty, options: c.options, note: c.note })), coupon: checkout.coupon, points: checkout.usePoints && ME ? ME.points : 0 });
  const getQuote = async () => {
    if (!cart.length) return;
    try { quote = await api('/api/quote', { method: 'POST', body: body() }); }
    catch (e) { quote = null; if (checkout.coupon) { toast(e.message, 'err'); checkout.coupon = ''; return getQuote(); } toast(e.message, 'err'); }
    draw();
  };
  const lineHtml = (c, i) => `<div class="line">
    <div class="grow">
      <div class="row between"><b>${esc(c.name)}</b><span class="price">${baht(c.unit * c.qty)}</span></div>
      <div class="small muted">${esc(c.text)}</div>
      ${c.note ? `<div class="note">หมายเหตุ: ${esc(c.note)}</div>` : ''}
      <div class="row between wrap gap-s mt-s">
        <div class="stepper sm"><button data-q="${i}" data-d="-1" aria-label="ลด" ${c.qty <= 1 ? 'disabled style="opacity:.35"' : ''}>−</button><b>${c.qty}</b><button data-q="${i}" data-d="1" aria-label="เพิ่ม">+</button></div>
        <div class="row gap-s">
          <button class="btn sm ghost" data-edit="${i}">แก้ไข</button>
          <button class="btn sm bad-soft" data-del="${i}">ลบ</button>
        </div>
      </div>
    </div></div>`;

  const draw = () => {
    if (!cart.length) { s.close(); renderCartBar(); return; }
    const detailsEl = s.q('details.more');
    if (detailsEl) checkout.discountOpen = detailsEl.open;

    const q = quote || { subtotal: cartTotal(), couponAmt: 0, pointsAmt: 0, pointsUsed: 0, total: cartTotal() };
    s.setBody(`
      <div class="card">${cart.map(lineHtml).join('')}<button class="btn soft block sm mt-s" data-close>เพิ่มเมนูอื่น</button></div>
      <div class="divider-t">1. ข้อมูลผู้สั่ง</div>
      <div class="card">
        ${(!ME || ME.isGuest) ? `
          <div class="field">
            <label>ชื่อผู้สั่ง (สำหรับเรียกคิว) *</label>
            <input id="custName" type="text" placeholder="เช่น คุณเอ, คุณนัท" value="${esc(checkout.name || (ME && ME.name !== 'ลูกค้าทั่วไป' ? ME.name : '') || '')}">
          </div>
        ` : `
          <div class="row gap-s py-xs mb-s" style="align-items:center">
            <div class="avatar" style="width:34px;height:34px;font-size:14px">${ME.picture ? `<img src="${esc(ME.picture)}" alt="" referrerpolicy="no-referrer">` : esc((ME.name || '?').charAt(0).toUpperCase())}</div>
            <div class="grow"><b>${esc(ME.name)}</b> <span class="badge ok-soft" style="font-size:12px">สมาชิก</span></div>
          </div>
        `}
        <div class="field">
          <label>เบอร์โทรศัพท์ (เพื่อให้ร้านติดต่อได้)</label>
          <input id="phone" type="tel" inputmode="tel" placeholder="08x-xxx-xxxx" value="${esc(checkout.phone || (ME && ME.phone) || '')}">
        </div>
        ${(!ME || ME.isGuest) ? `
          <div class="hint row between mt-s" style="align-items:center;background:var(--pri-50);padding:8px 12px;border-radius:var(--r-sm)">
            <span class="small" style="color:var(--pri-d)">เข้าสู่ระบบ Google เพื่อสะสมแต้ม</span>
            <button type="button" class="btn sm primary" id="cartLoginBtn" style="padding:4px 10px;font-size:13px">เข้าสู่ระบบ</button>
          </div>
        ` : ''}
      </div>
      <div class="divider-t">2. ชำระเงิน</div>
      <label class="pay-opt ${checkout.method === 'promptpay' ? 'sel' : ''}" data-pm="promptpay">
        <span class="rd"></span>
        <span class="grow"><b>โอนพร้อมเพย์</b><div class="small muted">สแกน QR จ่ายผ่านแอปธนาคาร</div></span>
      </label>
      ${CFG.allowCash ? `<label class="pay-opt ${checkout.method === 'cash' ? 'sel' : ''}" data-pm="cash">
        <span class="rd"></span>
        <span class="grow"><b>เงินสดที่ร้าน</b><div class="small muted">จ่ายที่เคาน์เตอร์</div></span>
      </label>` : ''}
      <details class="more mt" ${checkout.discountOpen ? 'open' : ''}>
        <summary>มีคูปองหรือแต้มสะสม?</summary>
        <div class="in">
          <div class="row"><input id="coupon" placeholder="รหัสคูปอง" value="${esc(checkout.coupon)}" style="text-transform:uppercase"><button class="btn soft" id="applyCoupon" aria-label="ใช้คูปอง">ใช้</button></div>
          ${quote && quote.coupon ? `<div class="banner mt-s" style="background:var(--ok-50);color:var(--ok)"><span>ใช้คูปอง ${esc(quote.coupon)} ลด ${baht(quote.couponAmt)}</span></div>` : ''}
          ${ME && ME.points > 0 ? `<div class="setrow" style="border:0;padding-bottom:0"><div class="grow"><div class="b">ใช้แต้มสะสม</div><div class="small muted">มี ${ME.points} แต้ม (= ${baht(ME.points * CFG.pointValue)}) · ใช้ลดได้สูงสุด ${CFG.maxRedeemPercent}%</div></div>
            <label class="sw"><input type="checkbox" id="usePts" ${checkout.usePoints ? 'checked' : ''}><i></i></label></div>` : ''}
        </div>
      </details>
      <div class="card sum mt">
        <div><span class="muted">ค่าอาหาร</span><span>${baht(q.subtotal)}</span></div>
        ${q.couponAmt ? `<div class="disc"><span>คูปอง</span><span>−${baht(q.couponAmt)}</span></div>` : ''}
        ${q.pointsAmt ? `<div class="disc"><span>ใช้ ${q.pointsUsed} แต้ม</span><span>−${baht(q.pointsAmt)}</span></div>` : ''}
        <div class="tot"><span>ยอดชำระ</span><span class="price">${baht(q.total)}</span></div>
        <div class="small faint mt-s">จะได้รับ ~${Math.floor(q.total / CFG.earnBahtPerPoint)} แต้ม เมื่อออเดอร์สำเร็จ</div>
      </div>`);
    s.setFooter(`<button class="btn primary lg block" id="go" ${CFG.shop.open ? '' : 'disabled'}>${CFG.shop.open ? `สั่งอาหาร · ${baht(q.total)}` : 'ร้านปิดรับออเดอร์'}</button>`);
    s.q('#go').onclick = place;
    renderCartBar();
  };

  const place = async () => {
    const btn = s.q('#go'); btn.disabled = true; btn.innerHTML = 'กำลังส่งออเดอร์<span class="dots"></span>';
    try {
      if (!getToken()) {
        const guestRes = await api('/api/auth/guest', {
          method: 'POST',
          body: { name: checkout.name || 'ลูกค้าทั่วไป', phone: checkout.phone }
        });
        setToken(guestRes.token);
        ME = guestRes.user;
      }
      const o = await api('/api/orders', {
        method: 'POST',
        body: {
          ...body(),
          name: checkout.name || (ME ? ME.name : 'ลูกค้าทั่วไป'),
          method: checkout.method,
          phone: checkout.phone
        }
      });
      cart = []; saveCart(); checkout.coupon = ''; checkout.usePoints = false; buzz(30);
      location.href = 'order.html?id=' + o.id;
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; draw(); }
  };

  s = openSheet({ title: 'ตะกร้าของคุณ', body: '', full: true });
  s.el.addEventListener('click', async e => {
    const t = e.target;
    const qb = t.closest('[data-q]');
    if (qb) {
      const i = +qb.dataset.q, c = cart[i], delta = +qb.dataset.d;
      if (delta < 0 && c.qty <= 1) return;
      const nq = c.qty + delta;
      if (nq > 20) return toast('จำนวนสูงสุดแล้ว', 'err');
      c.qty = nq;
      saveCart(); getQuote(); draw(); return;
    }
    const db = t.closest('[data-del]');
    if (db) {
      const i = +db.dataset.del;
      const removed = cart.splice(i, 1)[0];
      saveCart(); getQuote(); draw();
      toast('ลบรายการแล้ว', 'ok', () => {
        cart.splice(i, 0, removed);
        saveCart();
        if (_sheetStack.length) { getQuote(); draw(); }
        else { renderCartBar(); }
      });
      return;
    }
    const eb = t.closest('[data-edit]');
    if (eb) {
      const i = +eb.dataset.edit, c = cart[i];
      s.close();
      openItem(c.menuId, { sel: c.options, qty: c.qty, note: c.note, idx: i, reopenCart: true });
      return;
    }
    const pm = t.closest('[data-pm]');
    if (pm) { checkout.method = pm.dataset.pm; draw(); return; }
    if (t.closest('#applyCoupon')) { checkout.coupon = s.q('#coupon').value.trim(); getQuote(); }
    if (t.closest('#cartLoginBtn')) {
      await showLogin({ canSkip: true });
      if (ME && ME.name && !ME.isGuest) checkout.name = ME.name;
      if (ME && ME.phone) checkout.phone = ME.phone;
      getQuote();
      draw();
      return;
    }
  });
  s.el.addEventListener('input', e => {
    if (e.target.id === 'custName') checkout.name = e.target.value;
    if (e.target.id === 'phone') checkout.phone = e.target.value;
  });
  s.el.addEventListener('change', e => {
    if (e.target.id === 'usePts') { checkout.usePoints = e.target.checked; getQuote(); }
  });
  checkout.phone = checkout.phone || (ME && ME.phone) || '';
  if (!checkout.name && ME && !ME.isGuest) checkout.name = ME.name;
  draw(); getQuote();
}

// ---------- ออเดอร์ของฉัน ----------
async function loadMine() {
  try { MINE = await api('/api/orders/mine'); } catch { return; }
  const n = MINE.filter(isActive).length;
  const d = $('#orderDot');
  if (d) { d.hidden = !n; d.textContent = n; }
  if (view === 'orders') renderOrders();
}
function renderOrders() {
  const el = $('#v-orders'), act = MINE.filter(isActive), past = MINE.filter(o => !isActive(o));
  const card = o => `<div class="ocard" data-href="order.html?id=${esc(o.id)}" role="link" tabindex="0">
    <div class="row">
      <div class="qn">#${o.queueNo}</div>
      <div class="grow">
        <div class="b clamp2">${o.items.map(i => esc(i.name) + ' ×' + i.qty).join(', ')}</div>
        <div class="small muted">${dateTH(o.createdAt)}</div>
      </div>
      <span class="small faint">ดูรายละเอียด ›</span>
    </div>
    <div class="row between mt-s">${statusPill(o.status)}<span class="price">${baht(o.total)}</span></div>
    ${o.status === 'done' ? `<button class="btn soft sm block mt-s" data-re="${esc(o.id)}">สั่งซ้ำ</button>` : ''}
  </div>`;

  el.innerHTML = `<h2 class="sec-t" style="margin-top:6px">ออเดอร์ของฉัน</h2>` +
    (MINE.length
      ? (act.length ? `<div class="divider-t">กำลังทำ</div>${act.map(card).join('')}` : '') +
      (past.length ? `<div class="divider-t">ที่ผ่านมา</div>${past.map(card).join('')}` : '')
      : `<div class="empty"><div class="b">ยังไม่มีออเดอร์</div><p class="small mt-s">เลือกเมนูที่ชอบแล้วสั่งได้เลย</p><button class="btn primary mt" id="toMenu">ไปเลือกเมนู</button></div>`);

  const tm = $('#toMenu'); if (tm) tm.onclick = () => go('menu');
  $$('[data-href]', el).forEach(c => (c.onclick = e => { if (!e.target.closest('[data-re]')) location.href = c.dataset.href; }));
  $$('[data-re]', el).forEach(b => (b.onclick = () => reorder(MINE.find(x => x.id === b.dataset.re))));
}

function reorder(o) {
  let added = 0;
  o.items.forEach(i => {
    const m = MENU.items.find(x => x.id === i.menuId); if (!m || !m.available) return;
    const unit = m.price + (m.groups || []).reduce((s, g) => s + (i.sel && i.sel[g.id] || []).reduce((a, oid) => a + ((g.options.find(x => x.id === oid) || {}).price || 0), 0), 0);
    cart.push({ menuId: i.menuId, name: i.name, qty: i.qty, options: i.sel || {}, note: i.note, unit, text: optionText(i) }); added++;
  });
  saveCart();
  if (!added) return toast('เมนูเดิมหมดแล้ว', 'err');
  toast('เพิ่มลงตะกร้าแล้ว', 'ok'); go('menu'); openCart();
}

// ---------- บัญชี ----------
async function refreshMe() { try { ME = await api('/api/me'); renderMe(); } catch { } }
function renderMe() {
  const el = $('#v-me'); if (!el) return;
  const isGuest = !ME || ME.isGuest;
  if (isGuest) {
    el.innerHTML = `
      <div class="card c" style="margin-top:6px;padding:26px 16px">
        <div style="width:68px;height:68px;border-radius:50%;background:var(--line-2);display:inline-grid;place-items:center;font-size:32px;margin:0 auto 12px">👤</div>
        <div class="b" style="font-size:22px">${esc(ME ? ME.name : 'ลูกค้าทั่วไป')}</div>
        <div class="small muted mt-xs">${ME ? 'สั่งในฐานะลูกค้าทั่วไป' : 'ยังไม่ได้เข้าสู่ระบบ'}</div>
        <p class="muted mt-s" style="font-size:15px;line-height:1.4">เข้าสู่ระบบด้วย Google เพื่อสะสมแต้มส่วนลด แลกคูปอง และบันทึกประวัติการสั่งซื้อ</p>
        <button class="btn primary block lg mt" id="loginMeBtn" style="font-size:18px">${icon('user', 20)} เข้าสู่ระบบด้วย Google</button>
      </div>
      <div class="card">
        <div class="card-h">${icon('settings', 18)} การแสดงผล</div>
        <div class="setrow">
          <div class="grow">
            <b>โหมดกลางคืน (ธีมมืด)</b>
            <div class="small muted">ถนอมสายตา ใช้งานในที่แสงน้อย</div>
          </div>
          <label class="sw"><input type="checkbox" id="themeMeSw" ${getTheme() === 'dark' ? 'checked' : ''}><i></i></label>
        </div>
      </div>
      ${ME ? `
        <div class="card">
          <h3>เบอร์โทรติดต่อ</h3>
          <div class="row"><input id="myPhone" type="tel" inputmode="tel" placeholder="08x-xxx-xxxx" value="${esc(ME.phone || '')}"><button class="btn soft" id="savePhone">บันทึก</button></div>
        </div>
      ` : ''}
    `;
    const lmBtn = $('#loginMeBtn');
    if (lmBtn) {
      lmBtn.onclick = async () => {
        await showLogin({ canSkip: true });
        renderMe();
        loadMine();
      };
    }
    const sp = $('#savePhone');
    if (sp) {
      sp.onclick = async () => {
        try {
          ME = await api('/api/me', { method: 'PUT', body: { phone: $('#myPhone').value } });
          toast('บันทึกแล้ว', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
    }
    const tsw = $('#themeMeSw');
    if (tsw) tsw.onchange = e => setTheme(e.target.checked ? 'dark' : 'light');
    return;
  }

  el.innerHTML = `<div class="card row" style="margin-top:6px">
      <div class="avatar">${ME.picture ? `<img src="${esc(ME.picture)}" alt="" referrerpolicy="no-referrer">` : esc((ME.name || '?').charAt(0).toUpperCase())}</div>
      <div class="grow"><div class="b" style="font-size:18px">${esc(ME.name)}</div><div class="small muted" style="word-break:break-all">${esc(ME.email)}</div>
      ${ME.isAdmin ? `<a class="pill pri mt-s" href="admin.html" style="text-decoration:none">ไปหลังร้าน</a>` : ''}</div>
    </div>
    <div class="points-card mb">
      <div class="small" style="opacity:.9">แต้มสะสมของคุณ</div>
      <div class="big">${ME.points} <span style="font-size:18px;font-weight:600">แต้ม</span></div>
      <div class="small mt-s" style="opacity:.95">ใช้เป็นส่วนลดได้ ${baht(ME.points * CFG.pointValue)} · ทุก ${CFG.earnBahtPerPoint} บาท = 1 แต้ม</div>
      <div class="small mt-s" style="opacity:.9">สั่งสำเร็จแล้ว ${ME.orderCount} ครั้ง</div>
    </div>
    <div class="card">
      <div class="card-h">${icon('settings', 18)} การแสดงผล</div>
      <div class="setrow">
        <div class="grow">
          <b>โหมดกลางคืน (ธีมมืด)</b>
          <div class="small muted">ถนอมสายตา ใช้งานในที่แสงน้อย</div>
        </div>
        <label class="sw"><input type="checkbox" id="themeMeSw" ${getTheme() === 'dark' ? 'checked' : ''}><i></i></label>
      </div>
    </div>
    <div class="card">
      <h3>เบอร์โทรติดต่อ</h3>
      <div class="row"><input id="myPhone" type="tel" inputmode="tel" placeholder="08x-xxx-xxxx" value="${esc(ME.phone)}"><button class="btn soft" id="savePhone">บันทึก</button></div>
    </div>
    <div class="card">
      <h3>ประวัติแต้ม</h3>
      ${(ME.log || []).length ? ME.log.map(l => `<div class="setrow"><div class="grow"><div>${esc(l.reason)}</div><div class="tiny faint">${dateTH(l.at)}</div></div><b style="color:${l.delta > 0 ? 'var(--ok)' : 'var(--bad)'}">${l.delta > 0 ? '+' : ''}${l.delta}</b></div>`).join('') : '<p class="small muted">ยังไม่มีรายการ สั่งแล้วรับแต้มได้เลย</p>'}
    </div>
    <button class="btn ghost block" id="lo">ออกจากระบบ</button>`;

  $('#savePhone').onclick = async () => { try { ME = await api('/api/me', { method: 'PUT', body: { phone: $('#myPhone').value } }); toast('บันทึกแล้ว', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  const tsw = $('#themeMeSw');
  if (tsw) tsw.onchange = e => setTheme(e.target.checked ? 'dark' : 'light');
  $('#lo').onclick = async () => { if (await confirmSheet({ title: 'ออกจากระบบ?', text: 'ตะกร้าที่ยังไม่สั่งจะหายไป', ok: 'ออกจากระบบ', danger: true })) logout(); };
}

function about() {
  const parts = [];
  parts.push(`<div class="c mb"><h2 style="font-size:30px;font-weight:700">${esc(CFG.shopName)}</h2>${CFG.tagline ? `<div class="muted mt-s" style="font-size:20px">${esc(CFG.tagline)}</div>` : ''}</div>`);

  if (CFG.phone) {
    parts.push(`<div class="mb"><a class="btn primary lg block" href="tel:${esc(CFG.phone.replace(/\D/g, ''))}">โทรหาร้าน ${esc(phoneFormat(CFG.phone))}</a></div>`);
  }

  parts.push('<div class="card">');
  parts.push(`<div class="setrow"><div class="grow"><div class="b">สถานะร้าน</div></div>${CFG.shop.open ? '<span class="pill ok">เปิดรับออเดอร์</span>' : `<span class="pill bad">${esc(CFG.shop.reason)}</span>`}</div>`);

  if (CFG.hoursText) {
    parts.push(`<div class="setrow"><div class="grow b">เวลาเปิด-ปิด</div><span>${esc(CFG.hoursText)}</span></div>`);
  } else if (CFG.shop.openTime && CFG.shop.closeTime) {
    parts.push(`<div class="setrow"><div class="grow b">เวลาเปิด-ปิด</div><span>${esc(CFG.shop.openTime)} - ${esc(CFG.shop.closeTime)} น.</span></div>`);
  }

  parts.push(`<div class="setrow"><div class="grow b">เวลาทำโดยประมาณ</div><span>~${CFG.prepMinutes} นาที</span></div>`);

  if (CFG.address || CFG.mapUrl) {
    parts.push(`<div class="setrow" style="align-items:flex-start"><div class="grow b">ที่ตั้งร้าน</div><div style="text-align:right">${CFG.address ? `<div>${esc(CFG.address)}</div>` : ''}${CFG.mapUrl ? `<a class="btn sm mt-s" href="${esc(CFG.mapUrl)}" target="_blank" rel="noopener">เปิดแผนที่</a>` : ''}</div></div>`);
  }

  if (CFG.facebookUrl || CFG.facebookName || CFG.lineId || CFG.lineName) {
    const socials = [];
    if (CFG.facebookUrl) {
      socials.push(`<a href="${esc(CFG.facebookUrl)}" target="_blank" rel="noopener" class="btn sm">Facebook${CFG.facebookName ? ': ' + esc(CFG.facebookName) : ''}</a>`);
    } else if (CFG.facebookName) {
      socials.push(`<span>Facebook: ${esc(CFG.facebookName)}</span>`);
    }

    if (CFG.lineId) {
      const lidClean = CFG.lineId.replace(/^@/, '');
      socials.push(`<a href="https://line.me/R/ti/p/~${esc(lidClean)}" target="_blank" rel="noopener" class="btn sm">เพิ่มเพื่อน LINE (${esc(CFG.lineId)})</a>`);
    } else if (CFG.lineName) {
      socials.push(`<span>LINE: ${esc(CFG.lineName)}</span>`);
    }
    parts.push(`<div class="setrow" style="align-items:flex-start"><div class="grow b">ติดตามร้าน</div><div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${socials.join('')}</div></div>`);
  }

  parts.push(`<div class="setrow"><div class="grow b">ชำระเงิน</div><span>พร้อมเพย์${CFG.allowCash ? ' / เงินสด' : ''}</span></div>`);
  parts.push(`<div class="setrow"><div class="grow b">แต้มสะสม</div><span>${CFG.earnBahtPerPoint} บาท = 1 แต้ม</span></div>`);
  parts.push('</div>');

  parts.push('<p class="small muted c">ดูคิวของคุณได้ที่แท็บ “ออเดอร์ของฉัน” จะมีเสียงแจ้งเตือนเมื่อพร้อมรับ</p>');

  openSheet({ title: 'ข้อมูลร้าน', body: parts.join('') });
}
