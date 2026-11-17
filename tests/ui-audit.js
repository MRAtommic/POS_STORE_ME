// ตัวตรวจ UI อัตโนมัติ — วางทั้งไฟล์ในคอนโซลเบราว์เซอร์ (F12) ของหน้าที่ต้องการตรวจ แล้วเรียก:
//   __audit()      ตรวจล้นจอ/ตัวอักษรเล็ก/ปุ่มเล็ก/ข้อความถูกตัด/ปุ่มไม่มีชื่อ/id ซ้ำ/รูปเสีย
//   __contrast()   ตรวจคอนทราสต์ข้อความ (ต้อง >= 4.5:1)
//   __audit(document.querySelector('.overlay'))   ตรวจเฉพาะหน้าต่างที่เปิดอยู่ (sheet)
// ผลลัพธ์ที่ถูกต้องคือ array ว่าง []
// เคล็ดลับ: ปิดแอนิเมชันก่อนตรวจ เพื่อไม่ให้ตำแหน่งเพี้ยน:
//   document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>');
//   document.querySelectorAll('.overlay').forEach(o=>o.classList.add('show'));   // ถ้าแท็บไม่ได้โฟกัส requestAnimationFrame จะไม่ทำงาน
window.__vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0; };
window.__nm = e => ((e.id ? '#' + e.id : '') + ((e.className && typeof e.className === 'string') ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) || e.tagName;
window.__audit = root => {
  root = root || document.body; const W = innerWidth, out = [], seen = new Set();
  const add = (k, e, d) => { const key = k + __nm(e) + (e.innerText || '').slice(0, 12); if (seen.has(key)) return; seen.add(key); out.push(k + ' | ' + __nm(e) + ' | "' + ((e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\n/g, ' ').slice(0, 30)) + '" | ' + d); };
  if (document.documentElement.scrollWidth > W + 1) out.push('H-OVERFLOW | page | ' + document.documentElement.scrollWidth + ' > ' + W);
  [...root.querySelectorAll('*')].filter(__vis).forEach(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (r.right > W + 1 && !e.closest('.chips,.tabs,.hscroll')) add('OFF-SCREEN', e, 'right=' + Math.round(r.right));
    if (r.left < -1 && !e.closest('.chips,.tabs,.hscroll,.overlay')) add('OFF-LEFT', e, 'left=' + Math.round(r.left));
    if ([...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) { const fs = parseFloat(cs.fontSize); if (fs < 17.5) add('SMALL-TEXT', e, fs + 'px'); }
    if (e.matches('button,a[href],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,summary,[role=button]') && !e.closest('.sw') && (r.height < 44 || r.width < 44)) add('SMALL-TAP', e, Math.round(r.width) + 'x' + Math.round(r.height));
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && e.scrollWidth > e.clientWidth + 2 && !/clamp|pic|sw|hbar/.test(e.className)) add('CLIPPED', e, e.scrollWidth + '>' + e.clientWidth);
    if (e.matches('button,a[href]') && !e.innerText.trim() && !e.getAttribute('aria-label') && !e.getAttribute('title')) add('NO-NAME', e, '');
  });
  const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id] || 0) + 1); Object.entries(ids).filter(([k, v]) => v > 1).forEach(([k, v]) => out.push('DUP-ID | ' + k + ' x' + v));
  document.querySelectorAll('img').forEach(i => { if (i.complete && !i.naturalWidth) out.push('BROKEN-IMG | ' + i.src.slice(-40)); });
  return out;
};
window.__lum = c => { const a = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
window.__bg = e => { while (e) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] > 0.9)) return c; e = e.parentElement; } return 'rgb(255,255,255)'; };
window.__contrast = root => {
  root = root || document.body; const out = [], seen = new Set();
  [...root.querySelectorAll('*')].filter(__vis).forEach(e => {
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(e), L1 = __lum(cs.color), L2 = __lum(__bg(e)), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    if (ratio < 4.5) { const k = __nm(e); if (!seen.has(k)) { seen.add(k); out.push('LOW-CONTRAST | ' + k + ' | "' + e.innerText.trim().slice(0, 24) + '" | ' + ratio.toFixed(2) + ':1'); } }
  });
  return out;
};
console.log('พร้อมใช้: __audit()  __contrast()  — ผลที่ถูกต้องคือ []');
