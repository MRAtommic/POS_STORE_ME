// =====================================================================
// admin2.js — ส่วนเสริมของหลังร้าน (โหลดต่อจาก admin.js)
//  1) เสียงเรียกดังซ้ำ + เสียงพูดภาษาไทย ("ชำระเงินสำเร็จ ยอด … บาท")
//  2) ยอดขายย้อนหลังแบบละเอียด: ขายอะไรได้ ยอดเท่าไหร่ หมวดหมู่ รายวัน/รายชั่วโมง
//  3) ความปลอดภัย: บันทึกการใช้งาน, ระงับสมาชิกป่วน, ความพยายามที่ถูกบล็อก, สำรองข้อมูล
//  4) ตั้งค่าขั้นสูง: เวลาเปิดรายวัน, วันหยุด, ขีดจำกัดการสั่ง, โหมดยุ่ง, เสียงของเครื่องนี้
// =====================================================================
(function () {
  // ---------- เมนูใหม่ ----------
  const rn = NAV.find(n => n.id === 'report'); if (rn) { rn.label = 'ยอดขาย'; }
  NAV.push({ id: 'security', label: 'ความปลอดภัย', icon: 'lock', owner: true }, { id: 'advanced', label: 'ตั้งค่าขั้นสูง', icon: 'settings', owner: true });
  VIEWS.report = viewSales; VIEWS.security = viewSecurity; VIEWS.advanced = viewAdvanced;
  const _vo = VIEWS.orders; VIEWS.orders = function () { _vo(); renderVoiceBanner(); renderNewBar(); };

  // =====================================================================
  // 1) เสียงเรียก + เสียงพูด
  // =====================================================================
  const VK = 'pos_voice', VDEF = { on: true, onNew: true, items: true, paid: true, rate: 0.95, volume: 1, repeatSec: 20 };
  const voice = () => { try { return { ...VDEF, ...JSON.parse(localStorage.getItem(VK) || '{}') }; } catch { return { ...VDEF }; } };
  const saveVoice = v => { try { localStorage.setItem(VK, JSON.stringify(v)); } catch {} };

  const TH_D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'], TH_U = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function thaiNum(n) {   // 195 → "หนึ่งร้อยเก้าสิบห้า" (ให้เสียงพูดอ่านยอดเงินถูกต้อง)
    n = Math.round(Math.abs(Number(n) || 0)); if (n === 0) return 'ศูนย์';
    const chunk = x => { const s = String(x), L = s.length; let out = '';
      for (let i = 0; i < L; i++) { const d = +s[i], pos = L - i - 1; if (!d) continue;
        if (pos === 1) out += (d === 1 ? '' : d === 2 ? 'ยี่' : TH_D[d]) + 'สิบ'; else if (pos === 0) out += (d === 1 && L > 1 ? 'เอ็ด' : TH_D[d]); else out += TH_D[d] + TH_U[pos]; }
      return out; };
    if (n < 1e6) return chunk(n); const hi = Math.floor(n / 1e6), lo = n % 1e6; return thaiNum(hi) + 'ล้าน' + (lo ? chunk(lo) : '');
  }
  window.thaiNum = thaiNum;

  // เลือกเสียงไทย: ให้ความสำคัญกับเสียง "ธรรมชาติ/ออนไลน์" (Edge) และเสียง Google ก่อนเสียงสังเคราะห์รุ่นเก่าในเครื่อง; เลือกเองได้ในตั้งค่าขั้นสูง
  const VOICE_KEY = 'pos_voice_name';
  let thVoice = null;
  const thVoices = () => ('speechSynthesis' in window ? speechSynthesis.getVoices().filter(v => /^th([-_]|$)/i.test(v.lang)) : []);
  const isNatural = v => /natural|neural|online/i.test(v.name);
  const voiceScore = v => (isNatural(v) ? 100 : 0) + (/google/i.test(v.name) ? 50 : 0) + (v.localService ? 0 : 10);
  function pickVoice() {
    const list = thVoices(); if (!list.length) return (thVoice = null);
    let saved = ''; try { saved = localStorage.getItem(VOICE_KEY) || ''; } catch {}
    thVoice = list.find(v => v.name === saved) || list.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
    return thVoice;
  }
  if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = pickVoice; pickVoice(); }
  function speak(text, force) {
    const v = voice(); if (!force && (!v.on || !soundOn)) return false;
    if (!('speechSynthesis' in window) || !pickVoice()) return false;   // ไม่มีเสียงไทยในเครื่อง → ไม่พูด (กันอ่านเพี้ยน)
    try {
      const go = (voiceObj, retried) => {
        const u = new SpeechSynthesisUtterance(text);
        window._utt = u;                         // เก็บอ้างอิงไว้ ไม่ให้ถูกเก็บกวาดก่อนพูดจบ (บั๊ก Chrome/Edge ทำให้เสียงหายเป็นพักๆ)
        u.lang = 'th-TH'; u.voice = voiceObj; u.rate = v.rate; u.volume = v.volume;
        u.onerror = e => {                       // เสียงออนไลน์ล้มเหลว (เน็ตช้า/หลุด) → ลองเสียงในเครื่องแทน
          if (retried || (e && e.error === 'canceled') || (e && e.error === 'interrupted')) return;
          const local = thVoices().find(x => x.localService && x !== voiceObj);
          if (local) go(local, true);
        };
        try { speechSynthesis.resume(); } catch {}
        speechSynthesis.speak(u);
      };
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
        setTimeout(() => go(thVoice, false), 150);   // cancel แล้วสั่งพูดทันทีมักไม่ติด → หน่วงเล็กน้อย
      } else go(thVoice, false);
      return true;
    } catch {
      return false;
    }
  }
  function alarm() {   // เสียงเรียกที่ดังกว่าเสียงปกติ
    try { unlockAudio(); const c = _actx; if (!c) return;
      if (c.state !== 'running') { c.resume().then(() => { if (c.state === 'running') alarm(); }).catch(() => {}); renderVoiceBanner(); return; }
      [880, 1175, 1568].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.22; o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.75, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22); }); } catch {}
  }
  const itemsText = o => { const it = o.items.slice(0, 5).map(i => `${i.name} ${thaiNum(i.qty)}`); return it.join(' และ ') + (o.items.length > 5 ? ' และรายการอื่นๆ' : ''); };

  let ringT = null, ringN = 0;
  // ออเดอร์ที่แม่ค้ายังไม่ "รับทราบ" (ยังไม่กดปุ่มรับทราบ/แตะการ์ด/กดปุ่มสถานะ)
  const pendingClaims = () => orders.filter(o => FRESH.has(o.id) && ['pending_payment', 'payment_claimed', 'paid'].includes(o.status));
  function startRing() {
    const v = voice(); if (!v.repeatSec || ringT) return; ringN = 0;
    ringT = setInterval(() => {
      const p = pendingClaims();
      if (!p.length || ringN >= 20 || !soundOn) { clearInterval(ringT); ringT = null; renderNewBar(); return; }
      ringN++; alarm(); buzz(150);
      if (ringN % 3 === 0) speak(`มีออเดอร์ใหม่ ${thaiNum(p.length)} รายการ ยังไม่ได้รับทราบ`);
    }, v.repeatSec * 1000);
  }
  // แถบ "มีออเดอร์ใหม่ N รายการ [รับทราบ]" ในหน้าออเดอร์ — กดแล้วเสียงเรียกหยุด
  function renderNewBar() {
    const sb = $('#soundBanner'); if (!sb) return;
    let nb = $('#newBar'); if (!nb) { sb.insertAdjacentHTML('afterend', '<div id="newBar"></div>'); nb = $('#newBar'); }
    const n = pendingClaims().length;
    nb.innerHTML = n ? `<div class="banner" style="border-left-color:var(--bad)"><span class="grow"><b>มีออเดอร์ใหม่ ${n} รายการ</b> ยังไม่ได้รับทราบ</span><button class="btn primary sm" id="ackAll">รับทราบ</button></div>` : '';
    const b = $('#ackAll'); if (b) b.onclick = ackAll;
  }
  function ackAll() { FRESH.clear(); try { speechSynthesis.cancel(); } catch {} renderNewBar(); if (typeof renderOrderList === 'function' && tab === 'orders') renderOrderList(); }
  function stopRing() { if (ringT) { clearInterval(ringT); ringT = null; } try { speechSynthesis.cancel(); } catch {} renderNewBar(); }
  window.stopRing = stopRing;
  window.renderNewBar = renderNewBar;
  document.addEventListener('click', e => {   // แตะการ์ดออเดอร์ = รับทราบออเดอร์นั้น
    const c = e.target.closest && e.target.closest('.oc');
    if (c && FRESH.delete(c.dataset.oid)) { renderNewBar(); if (!FRESH.size) { try { speechSynthesis.cancel(); } catch {} } if (typeof renderOrderList === 'function' && tab === 'orders') renderOrderList(); }
  });

  // เรียกจาก onOrder() ใน admin.js ทุกครั้งที่ออเดอร์เปลี่ยน
  window.alertEvent = function (o, prev) {
    const v = voice(), money = thaiNum(o.total) + ' บาท', q = 'หมายเลข ' + thaiNum(o.queueNo), cash = o.payment && o.payment.method === 'cash';
    const live = ['pending_payment', 'payment_claimed', 'paid'].includes(o.status);
    const isNew = !prev;                                                          // ลูกค้าเพิ่งกดสั่ง
    const claimed = prev === 'pending_payment' && o.status === 'payment_claimed';  // ลูกค้าแจ้งโอนตามมาทีหลัง
    const confirmed = o.status === 'paid' && prev && prev !== 'paid';              // แม่ค้ากดยืนยันรับเงิน
    if (!live || confirmed) FRESH.delete(o.id);

    // 1) ลูกค้ากดสั่งซื้อทันที (ดังทันที ไม่ต้องรอลูกค้าชำระเงิน)
    if (isNew) {
      FRESH.add(o.id); buzz(200); renderNewBar();
      if (soundOn) { alarm(); startRing(); }
      const state = o.status === 'paid' ? 'ไม่มียอดชำระ' : cash ? 'ชำระเงินสด ' + money : 'ยอด ' + money + ' รอชำระเงิน';
      speak(`ออเดอร์ใหม่ ${q} ${state}.${v.items ? ' ' + itemsText(o) : ''}`);
      toast(`ออเดอร์ใหม่ #${o.queueNo} · ${baht(o.total)} · ${cash ? 'เงินสด' : 'รอชำระเงิน'}`, 'ok');
      if (soundOn && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(`ออเดอร์ใหม่ #${o.queueNo} ${baht(o.total)}`, { body: o.items.map(x => x.name + '×' + x.qty).join(', ') });
      }
    }
    // 2) ลูกค้าแจ้งโอนเงินตามมาทีหลัง (เตือนให้ตรวจสลิป)
    else if (claimed) {
      FRESH.add(o.id); buzz(200); renderNewBar();
      if (soundOn) { alarm(); startRing(); }
      speak(`${q} แจ้งโอนเงินแล้ว ${money} รอตรวจสอบ`);
      toast(`#${o.queueNo} แจ้งโอนเงินแล้ว · ${baht(o.total)} รอตรวจสอบ`, 'ok');
      if (soundOn && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(`#${o.queueNo} แจ้งโอนเงินแล้ว`, { body: `ยอด ${baht(o.total)} รอตรวจสอบสลิป` });
      }
    }
    // 3) แม่ค้ากดยืนยันรับเงิน
    else if (confirmed) {
      renderNewBar();
      if (v.paid) speak(`ชำระเงินสำเร็จ ${q} ยอด ${money}`);
    }
  };
  setTimeout(() => {   // เปิดหน้าใหม่แล้วมีออเดอร์รอตรวจสอบค้างอยู่ → ให้เสียงเตือนต่อ
    if (typeof orders === 'undefined') return;
    orders.filter(o => o.status === 'payment_claimed').forEach(o => FRESH.add(o.id));
    if (FRESH.size && soundOn) startRing();
  }, 3000);

  function renderVoiceBanner() {
    const b = $('#soundBanner'); if (!b || !soundOn) return;
    const needTap = (navigator.userActivation && !navigator.userActivation.hasBeenActive) || (typeof _actx !== 'undefined' && _actx && _actx.state !== 'running');
    if (needTap) b.innerHTML = `<div class="banner closed"><span class="grow"><b>เสียงแจ้งเตือนถูกเบราว์เซอร์บล็อกอยู่</b> แตะที่หน้าจอ 1 ครั้งเพื่อเปิดเสียง</span></div>`;
    else if (b.textContent.includes('บล็อก')) b.innerHTML = '';
    else if (voice().on && 'speechSynthesis' in window && !pickVoice()) b.innerHTML = `<div class="banner closed"><span class="grow">เครื่องนี้ยังไม่มีเสียงพูดภาษาไทย (เสียงเรียกยังดังตามปกติ) — ดูวิธีติดตั้งที่ ตั้งค่าขั้นสูง → เสียงแจ้งเตือน</span></div>`;
  }
  document.addEventListener('pointerdown', () => { setTimeout(renderVoiceBanner, 300); });
  setInterval(() => {   // เฝ้าระวัง: เสียงโดนบล็อก/ระงับกลางทาง (หน้าจอดับ, พักเครื่อง) → ขึ้นแถบเตือนทันที และพยายามเปิดต่อเอง
    if (!soundOn || document.hidden) return;
    try { if (_actx && _actx.state !== 'running') _actx.resume().catch(() => {}); if ('speechSynthesis' in window && speechSynthesis.paused) speechSynthesis.resume(); } catch {}
    renderVoiceBanner();
  }, 4000);

  // =====================================================================
  // 2) ยอดขายย้อนหลัง
  // =====================================================================
  const fmtDay = d => new Date(d + 'T12:00:00+07:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDay = d => new Date(d + 'T12:00:00+07:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const monthRange = off => { const [y, m] = today().split('-').map(Number); return [new Date(Date.UTC(y, m - 1 + off, 1)).toISOString().slice(0, 10), new Date(Date.UTC(y, m + off, 0)).toISOString().slice(0, 10)]; };
  let SALES = { from: today(), to: today(), cat: '', all: false };
  const bar = p => `<div class="hbar"><i style="width:${Math.max(1, Math.min(100, p))}%"></i></div>`;
  const csvQ = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  async function viewSales(from, to) {
    if (typeof from === 'string') SALES = { ...SALES, from, to, cat: '', all: false };
    view().innerHTML = '<div class="skel" style="height:120px;margin-bottom:12px"></div><div class="skel" style="height:260px"></div>';
    let r; try { r = await api(`/api/admin/report?from=${SALES.from}&to=${SALES.to}`); } catch (e) { return toast(e.message, 'err'); }
    SALES.from = r.from; SALES.to = r.to;
    const one = r.from === r.to, totalNet = Math.max(1, r.categories.reduce((s, c) => s + c.net, 0)), maxQty = Math.max(1, ...r.items.map(i => i.qty));
    const shown = r.items.filter(i => !SALES.cat || i.cat === SALES.cat), list = SALES.all ? shown : shown.slice(0, 12);
    const maxDay = Math.max(1, ...r.byDay.map(d => d.revenue)), maxH = Math.max(1, ...r.byHour), maxW = Math.max(1, ...r.byWeekday.map(d => d.revenue)), payTot = Math.max(1, r.pay.promptpay + r.pay.cash);
    const delta = r.prev.revenue ? Math.round((r.revenue - r.prev.revenue) / r.prev.revenue * 100) : null;
    const cmp = r.prev.revenue ? `เทียบกับช่วงก่อนหน้า (${one ? shortDay(r.prev.from) : shortDay(r.prev.from) + ' – ' + shortDay(r.prev.to)}) ยอด ${baht(r.prev.revenue)}: <b style="color:${delta >= 0 ? 'var(--ok)' : 'var(--bad)'}">${delta >= 0 ? 'เพิ่มขึ้น ' : 'ลดลง '}${Math.abs(delta)}%</b>` : 'ช่วงก่อนหน้าไม่มียอดขายให้เปรียบเทียบ';
    const [m0, m1] = monthRange(0), [l0, l1] = monthRange(-1), yb = today().slice(0, 4) + '-01-01', ydy = daysAgo(1);
    const chips = [['วันนี้', today(), today()], ['เมื่อวาน', ydy, ydy], ['7 วัน', daysAgo(6), today()], ['30 วัน', daysAgo(29), today()], ['เดือนนี้', m0, today()], ['เดือนที่แล้ว', l0, l1], ['ปีนี้', yb, today()]];
    view().innerHTML = `
      <div class="card"><div class="small muted">${one ? 'สรุปยอดขายวัน' : 'สรุปยอดขายช่วง'}</div>
        <h2 style="font-size:26px;line-height:1.3">${one ? fmtDay(r.from) : shortDay(r.from) + ' – ' + shortDay(r.to) + ` (${r.days} วัน)`}</h2>
        <div style="font-size:34px;font-weight:700;margin-top:6px">${baht(r.revenue)} <span class="small muted" style="font-weight:400">จาก ${r.orders} ออเดอร์ · ${r.qty} ชิ้น</span></div>
        <div class="small mt-s">${cmp}</div></div>
      <div class="card"><div class="row wrap"><input type="date" id="sf" value="${r.from}" style="width:auto;flex:1;min-width:140px"><span>ถึง</span><input type="date" id="st" value="${r.to}" style="width:auto;flex:1;min-width:140px"></div>
        <div class="chips mt-s">${chips.map(c => `<button class="chip ${c[1] === r.from && c[2] === r.to ? 'on' : ''}" data-rr="${c[1]}|${c[2]}">${c[0]}</button>`).join('')}</div></div>
      <div class="kpis"><div class="kpi"><div class="k">ยอดขายสุทธิ</div><div class="v pri">${baht(r.revenue)}</div></div><div class="kpi"><div class="k">ออเดอร์สำเร็จ</div><div class="v">${r.orders}</div></div>
        <div class="kpi"><div class="k">เฉลี่ยต่อออเดอร์</div><div class="v">${baht(r.avg)}</div></div><div class="kpi"><div class="k">ส่วนลดที่ให้</div><div class="v">${baht(r.discount)}</div></div>
        <div class="kpi"><div class="k">ยกเลิก</div><div class="v">${r.cancelled}</div></div><div class="kpi"><div class="k">ลูกค้า (ใหม่/เก่า)</div><div class="v">${r.customers.fresh}/${r.customers.returning}</div></div></div>

      <div class="card"><h3>ขายอะไรได้บ้าง <span class="small muted" style="font-weight:400">เรียงตามจำนวนที่ขาย</span></h3>
        <div class="chips"><button class="chip ${SALES.cat ? '' : 'on'}" data-cat="">ทุกหมวด</button>${r.categories.map(c => `<button class="chip ${SALES.cat === c.name ? 'on' : ''}" data-cat="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>
        ${list.map((i, k) => `<div class="mrow" style="cursor:default"><div class="b" style="min-width:26px;color:var(--ink-3)">${k + 1}</div><div class="grow"><div class="b">${esc(i.name)}</div><div class="small muted">${esc(i.cat)}</div>${bar(i.qty / maxQty * 100)}</div>
          <div style="text-align:right"><div class="b">${i.qty} ชิ้น</div><div class="small muted">${baht(i.net)}</div></div></div>`).join('') || '<p class="muted">ยังไม่มีรายการขายในช่วงนี้</p>'}
        ${shown.length > 12 ? `<button class="btn ghost block mt-s" id="moreItems">${SALES.all ? 'แสดงเฉพาะ 12 อันดับแรก' : `ดูทั้งหมด (${shown.length} รายการ)`}</button>` : ''}</div>

      <div class="card"><h3>ยอดขายตามหมวดหมู่</h3>
        ${r.categories.map(c => `<div class="mb"><div class="row between"><span class="b">${esc(c.name)}</span><span><b>${baht(c.net)}</b> <span class="small muted">· ${Math.round(c.net / totalNet * 100)}%</span></span></div>${bar(c.net / totalNet * 100)}<div class="small muted">${c.qty} ชิ้น · ${c.orders} ออเดอร์</div></div>`).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}
        ${r.categories.length ? `<hr><div class="row between"><b>รวมทุกหมวด</b><b>${baht(r.categories.reduce((s, c) => s + c.net, 0))}</b></div><div class="small muted">ยอดต่อหมวดหักส่วนลดตามสัดส่วนแล้ว ผลรวมตรงกับยอดขายสุทธิ</div>` : ''}</div>

      ${one ? `<button class="btn soft block mb" id="seeOrders">ดูรายการออเดอร์ทั้งหมดของวันนี้ (${r.orders + r.cancelled} ออเดอร์)</button>` : `<div class="card"><h3>ย้อนหลังรายวัน <span class="small muted" style="font-weight:400">แตะวันที่เพื่อดูว่าวันนั้นขายอะไรได้บ้าง</span></h3>
        ${[...r.byDay].reverse().map(d => `<div class="mrow" data-day="${d.day}"><div class="grow"><div class="b">${shortDay(d.day)}</div>${bar(d.revenue / maxDay * 100)}</div><div style="text-align:right"><div class="b">${baht(d.revenue)}</div><div class="small muted">${d.orders} ออเดอร์</div></div></div>`).join('') || '<p class="muted">ไม่มีข้อมูล</p>'}</div>`}

      <div class="card"><h3>ช่วงเวลาขายดี <span class="small muted" style="font-weight:400">จำนวนออเดอร์ต่อชั่วโมง</span></h3><div class="bars">${r.byHour.map((n, h) => `<div class="bar" title="${h}:00 = ${n} ออเดอร์ ${baht(r.hourRev[h])}"><em>${n || ''}</em><i style="height:${n ? Math.max(4, n / maxH * 100) : 2}%;opacity:${n ? 1 : .25}"></i></div>`).join('')}</div>
        <div class="bar-lbl">${r.byHour.map((n, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('')}</div></div>
      ${r.days >= 7 ? `<div class="card"><h3>ขายดีวันไหนของสัปดาห์</h3>${r.byWeekday.map((w, i) => `<div class="mb"><div class="row between"><span class="b">${DOW[i]}</span><span>${baht(w.revenue)} <span class="small muted">· ${w.orders} ออเดอร์</span></span></div>${bar(w.revenue / maxW * 100)}</div>`).join('')}</div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="card"><h3>ช่องทางชำระเงิน</h3><div class="row between"><span>พร้อมเพย์</span><b>${baht(r.pay.promptpay)}</b></div>${bar(r.pay.promptpay / payTot * 100)}
          <div class="row between mt"><span>เงินสด</span><b>${baht(r.pay.cash)}</b></div>${bar(r.pay.cash / payTot * 100)}</div>
        <div class="card"><h3>ลูกค้าประจำ Top 10</h3>${r.customers.top.map((c, i) => `<div class="row between mb"><span><b>${i + 1}.</b> ${esc(c.name)}</span><span class="small">${c.orders} ครั้ง · <b>${baht(c.spent)}</b></span></div>`).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}</div>
        ${r.cancelReasons.length ? `<div class="card"><h3>เหตุผลที่ออเดอร์ถูกยกเลิก</h3>${r.cancelReasons.map(c => `<div class="row between mb"><span>${esc(c.reason)}</span><b>${c.count}</b></div>`).join('')}</div>` : ''}</div>

      <div class="card"><h3>ส่งออก / พิมพ์</h3><div class="row wrap"><button class="btn" id="csvLines">ดาวน์โหลด CSV รายชิ้นสินค้า</button><button class="btn" id="csvOrders">ดาวน์โหลด CSV รายออเดอร์</button><button class="btn" id="prtSum">พิมพ์สรุป</button></div>
        <div class="help mt-s">ไฟล์ CSV เปิดด้วย Excel ได้ (ภาษาไทยไม่เพี้ยน)</div></div>`;

    const go = (a, b) => viewSales(a, b);
    $('#sf').onchange = $('#st').onchange = () => go($('#sf').value, $('#st').value);
    $$('[data-rr]', view()).forEach(b => (b.onclick = () => { const [a, z] = b.dataset.rr.split('|'); go(a, z); }));
    $$('[data-cat]', view()).forEach(b => (b.onclick = () => { SALES.cat = b.dataset.cat; SALES.all = false; viewSales(); }));
    $$('[data-day]', view()).forEach(b => (b.onclick = () => go(b.dataset.day, b.dataset.day)));
    const mi = $('#moreItems'); if (mi) mi.onclick = () => { SALES.all = !SALES.all; viewSales(); };
    const so = $('#seeOrders'); if (so) so.onclick = () => { hRange = [r.from, r.to]; show('history'); };
    $('#csvLines').onclick = async () => {
      const rows = await api(`/api/admin/sales-lines?from=${r.from}&to=${r.to}`);
      const head = ['วันที่', 'เวลา', 'คิว', 'รหัสออเดอร์', 'สินค้า', 'ตัวเลือก', 'หมวดหมู่', 'จำนวน', 'ราคาต่อชิ้น', 'ยอดก่อนส่วนลด', 'ยอดสุทธิ', 'ชำระด้วย', 'ลูกค้า'];
      download('﻿' + [head.map(csvQ).join(','), ...rows.map(l => [l.date, l.time, l.queueNo, l.orderId, l.item, l.options, l.category, l.qty, l.unitPrice, l.gross, l.net, l.payment === 'cash' ? 'เงินสด' : 'พร้อมเพย์', l.customer].map(csvQ).join(','))].join('\r\n'), `sales-items_${r.from}_${r.to}.csv`, 'text/csv;charset=utf-8');
      toast('ดาวน์โหลดไฟล์แล้ว', 'ok');
    };
    $('#csvOrders').onclick = async () => {
      const rows = await api(`/api/admin/orders?from=${r.from}&to=${r.to}`);
      const head = ['วันที่', 'คิว', 'ลูกค้า', 'อีเมล', 'ชำระด้วย', 'สถานะ', 'รายการ', 'ค่าอาหาร', 'ส่วนลดคูปอง', 'ส่วนลดแต้ม', 'ยอดรวม'];
      download('﻿' + [head.map(csvQ).join(','), ...rows.map(o => [dateTH(o.createdAt), o.queueNo, o.name, o.email, o.payment.method === 'cash' ? 'เงินสด' : 'พร้อมเพย์', CFG.statusText[o.status], o.items.map(i => `${i.name}x${i.qty}`).join('; '), o.subtotal, (o.discount && o.discount.couponAmt) || 0, (o.discount && o.discount.pointsAmt) || 0, o.total].map(csvQ).join(','))].join('\r\n'), `orders_${r.from}_${r.to}.csv`, 'text/csv;charset=utf-8');
      toast('ดาวน์โหลดไฟล์แล้ว', 'ok');
    };
    $('#prtSum').onclick = () => {
      const pa = $('#printArea'); pa.className = '';
      pa.innerHTML = `<h2 style="margin:0">${esc(CFG.shopName)} — สรุปยอดขาย</h2><div>${one ? fmtDay(r.from) : r.from + ' ถึง ' + r.to}</div><hr>
        <div><b>ยอดขายสุทธิ ${baht(r.revenue)}</b> · ${r.orders} ออเดอร์ · ${r.qty} ชิ้น · ส่วนลด ${baht(r.discount)} · ยกเลิก ${r.cancelled}</div><h3>หมวดหมู่</h3>
        ${r.categories.map(c => `<div>${esc(c.name)}: ${c.qty} ชิ้น ${baht(c.net)}</div>`).join('')}<h3>สินค้า</h3>${r.items.map(i => `<div>${esc(i.name)} (${esc(i.cat)}) × ${i.qty} = ${baht(i.net)}</div>`).join('')}`;
      setTimeout(() => window.print(), 50);
    };
  }

  // =====================================================================
  // 3) ความปลอดภัย + บันทึกการใช้งาน
  // =====================================================================
  const ABUSE_TH = { rate_limit: 'ส่งคำขอถี่เกินไป', too_many_items: 'สั่งจำนวนชิ้นเกินกำหนด', amount_too_high: 'ยอดสั่งสูงเกินกำหนด', too_many_pending: 'ค้างจ่ายหลายออเดอร์', daily_cap: 'สั่งเกินจำนวนต่อวัน', cancel_abuse: 'ยกเลิกออเดอร์บ่อย',
    shop_flood: 'ออเดอร์รอชำระเต็มทั้งร้าน', banned_order: 'บัญชีที่ถูกระงับพยายามสั่ง', duplicate_submit: 'กดสั่งซ้ำ (ระบบรวมให้แล้ว)', forbidden_admin: 'พยายามเข้าส่วนหลังร้านโดยไม่มีสิทธิ์', admin_login_blocked: 'พยายามล็อกอินเป็นเจ้าของจากอินเทอร์เน็ต', ws_flood: 'เปิดการเชื่อมต่อมากผิดปกติ' };
  const ACT_TH = { login: 'เข้าสู่ระบบหลังร้าน', 'order.paid': 'ยืนยันรับเงิน', 'order.preparing': 'เริ่มทำออเดอร์', 'order.ready': 'ทำเสร็จ/เรียกลูกค้า', 'order.done': 'ปิดออเดอร์', 'order.rejected': 'ยกเลิก/ปฏิเสธออเดอร์', 'settings.update': 'แก้ตั้งค่าร้าน', 'settings.limits': 'แก้ตั้งค่าขั้นสูง',
    'menu.update': 'แก้เมนู', 'menu.stock': 'ปรับสต็อก/เปิดปิดขาย', 'menu.upload': 'อัปโหลดรูปสินค้า', 'coupons.update': 'แก้คูปอง', 'member.points': 'ปรับแต้มสมาชิก', 'ban.add': 'ระงับสมาชิก', 'ban.remove': 'ปลดระงับสมาชิก', 'backup.create': 'สำรองข้อมูล', 'backup.download': 'ดาวน์โหลดไฟล์สำรอง',
    'export.sales': 'ส่งออกข้อมูลยอดขาย', 'shop.accepting': 'เปิด/ปิดรับออเดอร์', 'slip.cleanup': 'ลบรูปสลิปเก่าอัตโนมัติ', 'integrity.repair': 'ซ่อมข้อมูลอัตโนมัติ', 'data.recovered': 'กู้ไฟล์ข้อมูลที่เสียหาย' };
  const actLabel = a => ACT_TH[a] || (a.startsWith('blocked.') ? 'ถูกบล็อก: ' + (ABUSE_TH[a.slice(8)] || a.slice(8)) : a);
  let AUD = { type: '', q: '', limit: 100 };

  async function viewSecurity() {
    view().innerHTML = '<div class="skel" style="height:140px;margin-bottom:12px"></div><div class="skel" style="height:260px"></div>';
    let s, members = []; try { [s, members] = await Promise.all([api('/api/admin/security'), api('/api/admin/members').catch(() => [])]); } catch (e) { return toast(e.message, 'err'); }
    const ig = s.integrity, ab = s.abuse, counters = Object.entries(ab.counters).sort((a, b) => b[1] - a[1]);
    const okRow = (ok, t, d) => `<div class="setrow"><div class="grow"><div class="b">${t}</div>${d ? `<div class="small muted">${d}</div>` : ''}</div><span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'ปกติ' : 'ต้องแก้ไข'}</span></div>`;
    view().innerHTML = `
      <div class="card"><h3>สถานะความปลอดภัยของระบบ</h3>
        ${okRow(!s.devMode, 'การเข้าสู่ระบบด้วย Google', s.devMode ? 'ตอนนี้ยังเป็น "โหมดทดสอบ" ใครก็พิมพ์ชื่อ-อีเมลเข้าได้ ห้ามขายจริงในโหมดนี้ — ตั้งค่า GOOGLE_CLIENT_ID แล้วรีสตาร์ต' : 'ลูกค้าและเจ้าของยืนยันตัวตนด้วย Google')}
        ${okRow(!ig.issues.length && !(ig.recovered || []).length, 'ความถูกต้องของข้อมูล', `ตรวจล่าสุด ${dateTH(ig.at)} · ออเดอร์ ${ig.orders} · สมาชิก ${ig.users}${ig.repaired ? ` · ซ่อมอัตโนมัติ ${ig.repaired} จุด` : ''}${(ig.recovered || []).length ? '<br>กู้ไฟล์ที่เสียหายตอนเริ่มระบบ: ' + esc(ig.recovered.join(', ')) : ''}${ig.issues.length ? '<br>' + ig.issues.map(esc).join('<br>') : ''}`)}
        ${okRow(s.backups.length > 0, 'การสำรองข้อมูล', s.backups.length ? `สำรองอัตโนมัติวันละครั้ง เก็บย้อนหลัง 30 วัน · ล่าสุด ${dateTH(s.backups[0].at)}` : 'ยังไม่มีไฟล์สำรอง')}</div>

      <div class="card"><h3>ไฟล์สำรองข้อมูล</h3><button class="btn primary mb" id="bkNow">สำรองข้อมูลตอนนี้</button>
        ${s.backups.slice(0, 8).map(b => `<div class="setrow"><div class="grow"><div class="b">${esc(b.name)}</div><div class="small muted">${dateTH(b.at)} · ${(b.size / 1024).toFixed(0)} KB${b.manual ? ' · สำรองเอง' : ' · อัตโนมัติ'}</div></div><button class="btn sm" data-bk="${esc(b.name)}">ดาวน์โหลด</button></div>`).join('') || '<p class="muted">ยังไม่มี</p>'}
        <div class="help mt-s">ไฟล์สำรองเก็บในโฟลเดอร์ data/backups ของเครื่องร้าน (ไม่รวมรูปภาพ) ควรคัดลอกไปเก็บที่อื่นเป็นระยะ</div></div>

      <div class="card"><h3>ความพยายามที่ถูกบล็อก <span class="small muted" style="font-weight:400">นับตั้งแต่เปิดเซิร์ฟเวอร์ ${dateTH(ab.since)}</span></h3>
        ${counters.map(([k, n]) => `<div class="setrow"><div class="grow">${esc(ABUSE_TH[k] || k)}</div><b>${n} ครั้ง</b></div>`).join('') || '<p class="muted">ยังไม่มีเหตุการณ์ผิดปกติ</p>'}
        ${ab.recent.length ? `<div class="divider-t">เหตุการณ์ล่าสุด</div>${ab.recent.slice(0, 12).map(e => `<div class="small mb"><b>${timeTH(e.at)}</b> ${esc(ABUSE_TH[e.kind] || e.kind)} <span class="muted">· ${esc(e.email || '-')} · ${esc(e.ip || '-')}</span></div>`).join('')}` : ''}</div>

      <div class="card"><h3>สมาชิกที่ถูกระงับการสั่ง</h3>
        ${s.bans.map(b => `<div class="setrow"><div class="grow"><div class="b">${esc(b.name || b.email)}</div><div class="small muted">${esc(b.email)} · ${esc(b.reason)} · ${dateTH(b.at)}</div></div><button class="btn sm" data-unban="${esc(b.email)}">ปลดระงับ</button></div>`).join('') || '<p class="muted">ยังไม่มี</p>'}
        <div class="divider-t">ระงับสมาชิกที่ป่วน/สั่งแกล้ง</div>
        <div class="field"><label>อีเมลสมาชิก (เลือกจากรายชื่อ หรือพิมพ์)</label><input id="banEmail" list="memList" placeholder="ชื่อหรืออีเมล" autocomplete="off"><datalist id="memList">${members.filter(m => m.role === 'customer' && !m.banned).map(m => `<option value="${esc(m.email)}">${esc(m.name)}</option>`).join('')}</datalist></div>
        <div class="field"><label>เหตุผล</label><input id="banReason" placeholder="เช่น สั่งแล้วไม่จ่ายซ้ำๆ" maxlength="100"></div>
        <button class="btn bad-soft" id="banGo">ระงับการสั่งซื้อ</button><div class="help mt-s">คนที่ถูกระงับยังดูเมนู/ประวัติได้ แต่สั่งซื้อไม่ได้ จนกว่าจะปลดระงับ</div></div>

      <div class="card"><h3>บันทึกการใช้งาน (ใครทำอะไร เมื่อไหร่)</h3>
        <div class="chips">${[['', 'ทั้งหมด'], ['order.', 'ออเดอร์'], ['settings', 'ตั้งค่า'], ['menu', 'เมนู/สต็อก'], ['blocked', 'ถูกบล็อก'], ['ban', 'ระงับสมาชิก'], ['login', 'เข้าสู่ระบบ'], ['backup', 'สำรองข้อมูล']].map(t => `<button class="chip ${AUD.type === t[0] ? 'on' : ''}" data-at="${t[0]}">${t[1]}</button>`).join('')}</div>
        <div class="search mb"><input id="audQ" type="search" placeholder="ค้นหา (อีเมล, รายละเอียด)" value="${esc(AUD.q)}">${icon('search', 18)}</div><div id="audList"></div></div>`;

    $('#bkNow').onclick = async e => { e.target.disabled = true; try { const r = await api('/api/admin/backups', { method: 'POST' }); toast('สำรองข้อมูลแล้ว: ' + r.name, 'ok'); viewSecurity(); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; } };
    $$('[data-bk]', view()).forEach(b => (b.onclick = async () => { const r = await fetch('/api/admin/backups/' + encodeURIComponent(b.dataset.bk), { headers: { Authorization: 'Bearer ' + getToken() } }); if (!r.ok) return toast('ดาวน์โหลดไม่สำเร็จ', 'err'); download(await r.text(), b.dataset.bk, 'application/json'); toast('ดาวน์โหลดแล้ว', 'ok'); }));
    $$('[data-unban]', view()).forEach(b => (b.onclick = async () => { try { await api('/api/admin/bans/remove', { method: 'POST', body: { email: b.dataset.unban } }); toast('ปลดระงับแล้ว', 'ok'); viewSecurity(); } catch (e) { toast(e.message, 'err'); } }));
    $('#banGo').onclick = async () => {
      const email = $('#banEmail').value.trim(); if (!email) return toast('กรุณาเลือกหรือพิมพ์อีเมลสมาชิก', 'err');
      if (!(await confirmSheet({ title: 'ระงับการสั่งซื้อ?', text: `${email} จะสั่งซื้อไม่ได้จนกว่าจะปลดระงับ`, ok: 'ระงับ', danger: true }))) return;
      try { await api('/api/admin/bans', { method: 'POST', body: { email, reason: $('#banReason').value } }); toast('ระงับแล้ว', 'ok'); viewSecurity(); } catch (e) { toast(e.message, 'err'); }
    };
    $$('[data-at]', view()).forEach(b => (b.onclick = () => { AUD.type = b.dataset.at; AUD.limit = 100; viewSecurity(); }));
    $('#audQ').oninput = (() => { let t; return e => { clearTimeout(t); t = setTimeout(() => { AUD.q = e.target.value.trim(); AUD.limit = 100; loadAudit(); }, 300); }; })();
    loadAudit();
  }
  async function loadAudit() {
    const box = $('#audList'); if (!box) return;
    let rows; try { rows = await api(`/api/admin/audit?limit=${AUD.limit}&type=${encodeURIComponent(AUD.type)}&q=${encodeURIComponent(AUD.q)}`); } catch (e) { return toast(e.message, 'err'); }
    box.innerHTML = rows.map(r => `<div class="setrow" style="align-items:flex-start"><div class="small muted" style="min-width:88px">${dateTH(r.at)}</div><div class="grow"><div class="b">${esc(actLabel(r.action))}</div><div class="small">${esc(r.detail)}</div>
      <div class="small muted">${esc(r.by)}${r.ip ? ' · ' + esc(r.ip) : ''}</div></div></div>`).join('') || '<p class="muted">ไม่พบรายการ</p>';
    if (rows.length >= AUD.limit) { box.insertAdjacentHTML('beforeend', '<button class="btn ghost block mt-s" id="audMore">แสดงเพิ่ม</button>'); $('#audMore').onclick = () => { AUD.limit += 100; loadAudit(); }; }
  }

  // ปุ่มระงับ/ปลดระงับในหน้ารายละเอียดสมาชิก
  const _memberSheet = memberSheet;
  memberSheet = function (u) {
    _memberSheet(u);
    const s = _sheetStack[_sheetStack.length - 1]; if (!s || !u || u.role !== 'customer') return;
    s.q('.sheet-f').insertAdjacentHTML('beforeend', `<button class="btn ${u.banned ? 'ghost' : 'bad-soft'} block mt-s" id="banBtn">${u.banned ? 'ปลดระงับการสั่งซื้อ' : 'ระงับการสั่งซื้อ (สมาชิกป่วน)'}</button>`);
    s.q('#banBtn').onclick = async () => {
      try {
        if (u.banned) await api('/api/admin/bans/remove', { method: 'POST', body: { email: u.email } });
        else { const r = await formSheet({ title: `ระงับ ${u.name}`, intro: 'จะสั่งซื้อไม่ได้จนกว่าจะปลดระงับ', ok: 'ระงับ', danger: true, fields: [{ id: 'reason', label: 'เหตุผล', value: '', chips: ['สั่งแล้วไม่จ่าย', 'สั่งแกล้ง', 'สแปมออเดอร์'] }] }); if (!r) return; await api('/api/admin/bans', { method: 'POST', body: { email: u.email, reason: r.reason } }); }
        toast(u.banned ? 'ปลดระงับแล้ว' : 'ระงับแล้ว', 'ok'); s.close(); viewMembers();
      } catch (e) { toast(e.message, 'err'); }
    };
  };

  // =====================================================================
  // 4) ตั้งค่าขั้นสูง
  // =====================================================================
  const DOW_SHORT = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  async function viewAdvanced() {
    SET = await api('/api/admin/settings');
    const L = SET, vc = voice(), hasTh = 'speechSynthesis' in window && !!pickVoice();
    const wh = Array.isArray(L.weekHours) && L.weekHours.length === 7 ? L.weekHours : DOW_SHORT.map(() => ({ open: true, from: L.openTime, to: L.closeTime }));
    let closed = [...(L.closedDates || [])];
    const num = (k, label, help, extra = '') => `<div class="field"><label>${label}</label><input id="L_${k}" type="number" inputmode="numeric" min="0" value="${L[k]}" ${extra}>${help ? `<div class="hint">${help}</div>` : ''}</div>`;
    view().innerHTML = `
      <div class="card"><h3>เสียงแจ้งเตือน (เฉพาะเครื่องนี้)</h3>
        <p class="help mb">ตั้งแยกแต่ละเครื่อง เช่น แท็บเล็ตหน้าร้านเปิดเสียงดัง ส่วนมือถือเจ้าของปิดเสียงพูด · เสียงดังทันทีที่ลูกค้ากดสั่ง และดังอีกครั้งเมื่อลูกค้าแจ้งโอน จนกว่าจะกด "รับทราบ" หรือแตะการ์ดออเดอร์</p>
        <div class="setrow"><div class="grow"><div class="b">เสียงเรียกหลังร้านที่ดังกว่าปกติ</div><div class="small muted">ใช้ปุ่ม "เปิดเสียง" มุมขวาบน (ตอนนี้: ${soundOn ? 'เปิด' : 'ปิด'})</div></div><button class="btn sm" id="vTestAlarm">ทดสอบเสียงเรียก</button></div>
        <div class="setrow"><div class="grow"><div class="b">เสียงพูดภาษาไทย</div><div class="small muted">เช่น "ออเดอร์ใหม่ หมายเลข สาม แจ้งโอนเงิน หนึ่งร้อยเก้าสิบห้า บาท"</div></div><label class="sw"><input type="checkbox" id="v_on" ${vc.on ? 'checked' : ''}><i></i></label></div>
        <div class="setrow"><div class="grow"><div class="b">แจ้งเตือนทันทีที่ลูกค้ากดสั่ง</div><div class="small muted">แม้ยังไม่จ่ายเงิน (ถ้าปิด จะดังเฉพาะตอนลูกค้าแจ้งโอนหรือเลือกเงินสด)</div></div><label class="sw"><input type="checkbox" id="v_new" ${vc.onNew !== false ? 'checked' : ''}><i></i></label></div>
        <div class="setrow"><div class="grow"><div class="b">อ่านรายการสินค้าด้วย</div><div class="small muted">ให้แม่ค้ารู้ว่าต้องทำอะไรโดยไม่ต้องมองหน้าจอ</div></div><label class="sw"><input type="checkbox" id="v_items" ${vc.items ? 'checked' : ''}><i></i></label></div>
        <div class="setrow"><div class="grow"><div class="b">พูด "ชำระเงินสำเร็จ ยอด … บาท" ตอนกดยืนยันรับเงิน</div></div><label class="sw"><input type="checkbox" id="v_paid" ${vc.paid ? 'checked' : ''}><i></i></label></div>
        <div class="field mt"><label>เสียงเรียกซ้ำทุกกี่วินาที ถ้ายังไม่มีใครกดดูออเดอร์</label><select id="v_rep">${[[0, 'ไม่เรียกซ้ำ'], [10, 'ทุก 10 วินาที'], [20, 'ทุก 20 วินาที'], [30, 'ทุก 30 วินาที'], [60, 'ทุก 1 นาที']].map(o => `<option value="${o[0]}" ${vc.repeatSec === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="field"><label>ความเร็วเสียงพูด: <b id="v_rate_t">${vc.rate}</b></label><input id="v_rate" type="range" min="0.6" max="1.3" step="0.05" value="${vc.rate}" style="width:100%;min-height:44px"></div>
        <div class="field"><label>ระดับเสียงพูด: <b id="v_vol_t">${Math.round(vc.volume * 100)}%</b></label><input id="v_vol" type="range" min="0.3" max="1" step="0.1" value="${vc.volume}" style="width:100%;min-height:44px"></div>
        <div id="voiceBox"></div></div>

      <div class="card"><h3>เวลาเปิด-ปิดรายวัน</h3>
        <div class="setrow"><div class="grow"><div class="b">เปิด-ปิดรับออเดอร์ตามเวลาอัตโนมัติ</div><div class="small muted">ถ้าปิดอยู่ ร้านรับออเดอร์ตลอดเวลาที่สวิตช์ "รับออเดอร์" ด้านบนเปิด</div></div><label class="sw"><input type="checkbox" id="useHours" ${L.useHours ? 'checked' : ''}><i></i></label></div>
        ${wh.map((d, i) => `<div class="setrow"><div style="min-width:78px" class="b">${DOW_SHORT[i]}</div><label class="sw"><input type="checkbox" data-wo="${i}" ${d.open ? 'checked' : ''}><i></i></label><input type="time" data-wf="${i}" value="${d.from}" style="width:auto;flex:1"><span>–</span><input type="time" data-wt="${i}" value="${d.to}" style="width:auto;flex:1"></div>`).join('')}
        <div class="row wrap mt"><button class="btn sm ghost" id="copyMon">คัดลอกเวลาวันจันทร์ไปทุกวัน</button></div>
        <div class="help mt-s">เวลาปิดน้อยกว่าเวลาเปิด (เช่น 18:00–02:00) หมายถึงเปิดข้ามเที่ยงคืน</div></div>

      <div class="card"><h3>วันหยุดพิเศษ</h3><div id="closedList"></div>
        <div class="row wrap mt"><input type="date" id="cdDate" style="width:auto;flex:1;min-width:150px"><input id="cdReason" placeholder="เหตุผล เช่น วันสงกรานต์" maxlength="60" style="flex:2;min-width:160px"><button class="btn" id="cdAdd">เพิ่มวันหยุด</button></div></div>

      <div class="card"><h3>ป้องกันการสั่งป่วน/สั่งผิดปกติ</h3><p class="help mb">เมื่อเกินขีดจำกัด ลูกค้าจะเห็นข้อความบอกเหตุผลเป็นภาษาไทย และเหตุการณ์ถูกบันทึกในหน้า "ความปลอดภัย" (ใส่ 0 = ไม่จำกัด)</p>
        <div class="fgrid">${num('maxItemsPerOrder', 'จำนวนชิ้นสูงสุดต่อออเดอร์', 'กันสั่งทีละเป็นร้อย', 'min="1"')}${num('maxOrderAmount', 'ยอดอาหารสูงสุดต่อออเดอร์ (บาท)', '')}${num('minOrderAmount', 'ยอดอาหารขั้นต่ำต่อออเดอร์ (บาท)', '')}
          ${num('maxPendingPerUser', 'ออเดอร์ค้างจ่ายพร้อมกันได้กี่รายการต่อคน', 'กันสั่งทิ้งไว้หลายออเดอร์')}${num('maxOrdersPerUserPerDay', 'ออเดอร์สูงสุดต่อคนต่อวัน', '')}${num('maxOpenOrders', 'ออเดอร์รอชำระรวมทั้งร้านสูงสุด', 'กันถูกถล่มจนคนจริงสั่งไม่ได้')}
          ${num('cancelBlockCount', 'ยกเลิกกี่ครั้งใน 1 ชม. จึงพักการสั่ง 30 นาที', '0 = ไม่ใช้')}${num('cashHoldMinutes', 'เงินสด: ยกเลิกอัตโนมัติถ้าร้านไม่ยืนยันภายใน (นาที)', 'ลูกค้าที่สั่งเงินสดแต่ไม่มาจ่าย')}${num('slipRetentionDays', 'เก็บรูปสลิปกี่วัน', 'ลบอัตโนมัติเพื่อความเป็นส่วนตัว')}</div>
        <div class="setrow"><div class="grow"><div class="b">บังคับกรอกเบอร์โทรตอนสั่ง</div><div class="small muted">ช่วยตามตัวลูกค้าที่สั่งแกล้ง</div></div><label class="sw"><input type="checkbox" id="L_requirePhone" ${L.requirePhone ? 'checked' : ''}><i></i></label></div></div>

      <div class="card"><h3>โหมดยุ่ง & ใบพิมพ์</h3>
        <div class="field"><label>บวกเวลารอเพิ่ม (นาที) เมื่อคิวแน่น</label><input id="L_busyExtraMinutes" type="number" inputmode="numeric" min="0" max="120" value="${L.busyExtraMinutes}"><div class="hint">ลูกค้าจะเห็นเวลารอเพิ่มขึ้นตามนี้ (0 = ปกติ)</div></div>
        <div class="field"><label>ข้อความท้ายใบพิมพ์ออเดอร์</label><input id="L_ticketFooter" maxlength="100" value="${esc(L.ticketFooter || '')}"></div></div>
      <div class="savebar"><button class="btn primary lg block" id="advSave">บันทึกตั้งค่าขั้นสูง</button></div>`;

    // --- เสียงของเครื่องนี้ (บันทึกทันที) ---
    const sv = () => saveVoice({ on: $('#v_on').checked, onNew: $('#v_new').checked, items: $('#v_items').checked, paid: $('#v_paid').checked, repeatSec: +$('#v_rep').value, rate: +$('#v_rate').value, volume: +$('#v_vol').value });
    ['v_on', 'v_new', 'v_items', 'v_paid', 'v_rep'].forEach(id => ($('#' + id).onchange = sv));
    $('#v_rate').oninput = e => { $('#v_rate_t').textContent = e.target.value; sv(); }; $('#v_vol').oninput = e => { $('#v_vol_t').textContent = Math.round(e.target.value * 100) + '%'; sv(); };
    $('#vTestAlarm').onclick = () => { alarm(); };
    // --- กล่องเลือกเสียง: วาดใหม่ได้ (เบราว์เซอร์บางตัวโหลดรายการเสียงช้า/เสียงออนไลน์มาทีหลัง) ---
    const drawVoiceBox = () => {
      const box = $('#voiceBox'); if (!box) return;
      const th = thVoices(), all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
      pickVoice();
      const has = !!thVoice;
      const currentName = thVoice ? thVoice.name : '';
      const isEdge = /edg\//i.test(navigator.userAgent);
      const isChrome = /chrome|crios/i.test(navigator.userAgent) && !isEdge;

      let html = '';
      if (!('speechSynthesis' in window)) {
        html = `<div class="banner closed mt"><span>เบราว์เซอร์นี้ไม่รองรับระบบเสียงพูด (Speech Synthesis)</span></div>`;
      } else if (!has) {
        html = `
          <div class="banner closed mt">
            <div>
              <div class="b mb-s">ไม่พบเสียงพูดภาษาไทยในเครื่องนี้</div>
              <div class="small">ระบบตรวจพบเสียงทั้งหมด ${all.length} เสียง แต่ยังไม่มีภาษาไทย<br>
              • <b>วิธีที่แนะนำและง่ายที่สุด:</b> เปิดหน้านี้ด้วย <b>Microsoft Edge</b> (มีเสียงไทยออนไลน์ฟรี เช่น Premwadee / Niwat โดยไม่ต้องติดตั้งอะไรเพิ่ม แค่ต่อเน็ต)<br>
              • <b>บน Windows:</b> ไปที่ Windows Settings → Time & Language → Speech → Add voices → ติดตั้งภาษาไทย<br>
              • <b>บน Android:</b> ตั้งค่า → ระบบ → ภาษาและการป้อนข้อมูล → ข้อความเป็นคำพูด (Text-to-Speech) → ติดตั้งเสียงไทย</div>
              <div class="row mt-s"><button class="btn sm ghost" id="vReload">ค้นหาเสียงใหม่</button></div>
            </div>
          </div>`;
      } else {
        html = `
          <div class="field mt">
            <div class="row between items-center mb-xs">
              <label style="margin-bottom:0"><b>เลือกเสียงพูดภาษาไทย</b> (ตรวจพบ ${th.length} เสียง)</label>
              <button class="btn sm ghost" id="vReload" style="min-height:36px;padding:4px 10px;font-size:14px">โหลดเสียงใหม่</button>
            </div>
            <select id="v_voice" style="width:100%;font-size:16px;min-height:44px;padding:8px 12px">
              ${th.map(x => {
                const nat = isNatural(x);
                const tag = nat ? ' [เสียงธรรมชาติ แนะนำ]' : (x.localService ? ' [เสียงในเครื่อง]' : '');
                return `<option value="${esc(x.name)}" ${x.name === currentName ? 'selected' : ''}>${esc(x.name)}${tag}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="row wrap gap-s mt-s">
            <button class="btn primary" id="vTest">ทดสอบเสียงพูด</button>
            <button class="btn ghost" id="vSimulateOrder">ทดสอบจำลองลูกค้าสั่งซื้อ (เตือนทันที)</button>
          </div>
          <div class="banner info mt">
            <div>
              <div class="b">เสียงปัจจุบัน: ${esc(thVoice.name)}${isNatural(thVoice) ? ' (เสียงธรรมชาติ ออนไลน์)' : ' (เสียงสังเคราะห์ในเครื่อง)'}</div>
              <div class="small muted mt-xs">
                ${th.length === 1 && !isNatural(thVoice)
                  ? `เบราว์เซอร์นี้ (${isChrome ? 'Google Chrome' : 'เบราว์เซอร์ปัจจุบัน'}) มีเสียงไทยออฟไลน์ในเครื่องเพียง 1 เสียง (Pattara) จึงยังไม่มีเสียงอื่นให้สลับในช่องด้านบน<br>
                     💡 <b>อยากได้เสียงธรรมชาติเหมือนคนจริง?</b> ให้เปิดหน้าหลังร้านนี้ด้วย <b>Microsoft Edge</b> (มีในคอมพิวเตอร์ Windows ทุกเครื่องอยู่แล้ว) ใน Edge จะมีเสียง <b>Premwadee (ผู้หญิง)</b> และ <b>Niwat (ผู้ชาย)</b> ให้เลือกฟรีทันที`
                  : `เลือกเสียงที่ต้องการในช่องด้านบนได้เลย ระบบจะจำค่านี้ไว้สำหรับเครื่องนี้`}
              </div>
            </div>
          </div>`;
      }
      box.innerHTML = html;

      const vsel = $('#v_voice');
      if (vsel) {
        vsel.onchange = e => {
          try { localStorage.setItem(VOICE_KEY, e.target.value); } catch {}
          pickVoice();
          drawVoiceBox();
          speak(`เปลี่ยนเสียงเป็น ${thVoice ? thVoice.name.replace(/Microsoft | - Thai.*| Online.*|\(.*?\)/g, '').trim() : ''} แล้วค่ะ ออเดอร์ใหม่ หมายเลข สาม ยอด หนึ่งร้อยเก้าสิบห้า บาท`, true);
        };
      }
      const vReload = $('#vReload');
      if (vReload) {
        vReload.onclick = () => {
          if ('speechSynthesis' in window) {
            speechSynthesis.getVoices();
            pickVoice();
            drawVoiceBox();
            toast('อัปเดตรายการเสียงแล้ว (พบ ' + thVoices().length + ' เสียงภาษาไทย)', 'ok');
          }
        };
      }
      const vTest = $('#vTest');
      if (vTest) {
        vTest.onclick = () => {
          sv();
          if (!speak(`ออเดอร์ใหม่ หมายเลข ${thaiNum(3)} ยอด ${thaiNum(195)} บาท รอชำระเงิน. เครปช็อกโกแลตกล้วย ${thaiNum(2)} และชาไทย ${thaiNum(1)}`, true)) {
            toast('เครื่องนี้ยังไม่มีเสียงพูดภาษาไทย', 'err');
          }
        };
      }
      const vSim = $('#vSimulateOrder');
      if (vSim) {
        vSim.onclick = () => {
          sv();
          unlockAudio();
          const demoQ = Math.floor(Math.random() * 20) + 1;
          alertEvent({
            id: 'demo_' + Date.now(),
            queueNo: demoQ,
            name: 'ลูกค้าจำลอง',
            phone: '0891234567',
            total: 115,
            payment: { method: 'promptpay', slip: false },
            status: 'pending_payment',
            items: [{ name: 'เครปช็อกโกแลตกล้วย', qty: 1 }, { name: 'ชาเขียวเย็น', qty: 1 }]
          }, null);
        };
      }
    };
    drawVoiceBox();
    setTimeout(drawVoiceBox, 600);
    setTimeout(drawVoiceBox, 1500);
    setTimeout(drawVoiceBox, 3500);
    if ('speechSynthesis' in window) {
      const origOnVoices = speechSynthesis.onvoiceschanged;
      speechSynthesis.onvoiceschanged = () => {
        if (typeof origOnVoices === 'function') origOnVoices();
        pickVoice();
        drawVoiceBox();
      };
    }
    // --- สวิตช์เวลาอัตโนมัติ (ใช้ API ตั้งค่าหลัก) ---
    $('#useHours').onchange = async e => { try { SET = await api('/api/admin/settings', { method: 'PUT', body: { ...SET, useHours: e.target.checked } }); toast(SET.useHours ? 'เปิดใช้เวลาอัตโนมัติแล้ว' : 'ปิดเวลาอัตโนมัติแล้ว', 'ok'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'err'); } };
    $('#copyMon').onclick = () => { const f = $('[data-wf="1"]').value, t = $('[data-wt="1"]').value, o = $('[data-wo="1"]').checked; $$('[data-wf]').forEach(x => (x.value = f)); $$('[data-wt]').forEach(x => (x.value = t)); $$('[data-wo]').forEach(x => (x.checked = o)); };
    // --- วันหยุดพิเศษ ---
    const drawClosed = () => { $('#closedList').innerHTML = closed.map((c, i) => `<div class="setrow"><div class="grow"><div class="b">${fmtDay(c.date)}</div><div class="small muted">${esc(c.reason || 'ไม่ระบุเหตุผล')}</div></div><button class="btn sm bad-soft" data-cd="${i}">ลบ</button></div>`).join('') || '<p class="muted small">ยังไม่มีวันหยุดพิเศษ</p>';
      $$('[data-cd]').forEach(b => (b.onclick = () => { closed.splice(+b.dataset.cd, 1); drawClosed(); })); };
    drawClosed();
    $('#cdAdd').onclick = () => { const d = $('#cdDate').value; if (!d) return toast('เลือกวันที่ก่อน', 'err'); if (closed.some(c => c.date === d)) return toast('มีวันนี้อยู่แล้ว', 'err'); closed.push({ date: d, reason: $('#cdReason').value.trim() }); closed.sort((a, b) => a.date.localeCompare(b.date)); $('#cdDate').value = ''; $('#cdReason').value = ''; drawClosed(); toast('เพิ่มแล้ว กด "บันทึกตั้งค่าขั้นสูง" เพื่อใช้งาน'); };
    // --- บันทึก ---
    $('#advSave').onclick = async () => {
      const body = { weekHours: DOW_SHORT.map((_, i) => ({ open: $(`[data-wo="${i}"]`).checked, from: $(`[data-wf="${i}"]`).value || '09:00', to: $(`[data-wt="${i}"]`).value || '20:00' })), closedDates: closed,
        requirePhone: $('#L_requirePhone').checked, ticketFooter: $('#L_ticketFooter').value, busyExtraMinutes: $('#L_busyExtraMinutes').value };
      ['maxItemsPerOrder', 'maxOrderAmount', 'minOrderAmount', 'maxPendingPerUser', 'maxOrdersPerUserPerDay', 'maxOpenOrders', 'cancelBlockCount', 'cashHoldMinutes', 'slipRetentionDays'].forEach(k => (body[k] = $('#L_' + k).value));
      try { await api('/api/admin/limits', { method: 'PUT', body }); SET = await api('/api/admin/settings'); toast('บันทึกตั้งค่าขั้นสูงแล้ว', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
  }
})();
