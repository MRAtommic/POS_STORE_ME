// ==========================================
// LINE Official Account (Messaging API & Webhook)
// ระบบแจ้งเตือนออเดอร์ใหม่และสลิปโอนเงินสำหรับร้าน เครป ริมคลอง
// ==========================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let _dataDir = path.join(__dirname, 'data');
let _subscribersFile = path.join(_dataDir, 'line_subscribers.json');
let _getSettings = () => ({});
let _saveSettings = () => {};
let _onAckOrder = null;

function init({ dataDir, getSettings, saveSettings, onAckOrder }) {
  if (dataDir) {
    _dataDir = dataDir;
    _subscribersFile = path.join(_dataDir, 'line_subscribers.json');
  }
  if (getSettings) _getSettings = getSettings;
  if (saveSettings) _saveSettings = saveSettings;
  if (onAckOrder) _onAckOrder = onAckOrder;
  ensureSubscribersFile();
}

function ensureSubscribersFile() {
  try {
    if (!fs.existsSync(_subscribersFile)) {
      fs.writeFileSync(_subscribersFile, '[]', 'utf8');
    }
  } catch (err) {
    console.warn('[LINE OA] ไม่สามารถสร้างไฟล์ subscribers:', err.message);
  }
}

function getSubscribers() {
  ensureSubscribersFile();
  try {
    const raw = fs.readFileSync(_subscribersFile, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveSubscribers(list) {
  try {
    fs.writeFileSync(_subscribersFile, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LINE OA] บันทึก subscribers ล้มเหลว:', err.message);
  }
}

function addSubscriber(userId, displayName = '') {
  if (!userId) return false;
  const list = getSubscribers();
  const existing = list.find(s => s.userId === userId);
  if (existing) {
    existing.displayName = displayName || existing.displayName;
    existing.updatedAt = Date.now();
  } else {
    list.push({
      userId,
      displayName: displayName || 'ผู้รับแจ้งเตือน',
      addedAt: Date.now()
    });
  }
  saveSubscribers(list);
  return true;
}

function removeSubscriber(userId) {
  const list = getSubscribers();
  const next = list.filter(s => s.userId !== userId);
  if (next.length !== list.length) {
    saveSubscribers(next);
    return true;
  }
  return false;
}

function getCredentials() {
  const s = _getSettings() || {};
  const token = (s.lineChannelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  const secret = (s.lineChannelSecret || process.env.LINE_CHANNEL_SECRET || '').trim();
  const baseUrl = (process.env.BASE_URL || 'https://crepe.openchat.sbs').replace(/\/+$/, '');
  const enabled = s.lineNotifyEnabled !== false;
  return { token, secret, baseUrl, enabled };
}

function getAllRecipients() {
  const s = _getSettings() || {};
  const envIds = (process.env.LINE_ADMIN_USER_IDS || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  const setIds = (s.lineAdminUserIds || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  const subs = getSubscribers().map(x => x.userId).filter(Boolean);

  const merged = Array.from(new Set([...envIds, ...setIds, ...subs]));
  return merged;
}

// ตรวจสอบความถูกต้องของ LINE signature
function verifySignature(rawBody, signature, secret) {
  if (!signature) return false;
  if (!secret) return true;
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const hash = hmac.update(rawBody).digest('base64');
    return hash === signature;
  } catch (err) {
    console.error('[LINE OA] ตรวจ signature ผิดพลาด:', err);
    return false;
  }
}

// ส่งข้อความแบบ Reply (ตอบกลับ)
async function replyMessage(replyToken, messages, token) {
  if (!token || !replyToken) return { ok: false, error: 'missing_token' };
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        replyToken,
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[LINE OA] Reply failed:', res.status, errText);
      return { ok: false, status: res.status, error: errText };
    }
    return { ok: true };
  } catch (err) {
    console.error('[LINE OA] Reply error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ส่งข้อความแบบ Push ไปยัง 1 ID
async function pushMessage(to, messages, token) {
  if (!token || !to) return { ok: false, error: 'missing_token_or_recipient' };
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to,
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[LINE OA] Push to ${to} failed:`, res.status, errText);
      return { ok: false, status: res.status, error: errText };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[LINE OA] Push error to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ส่งข้อความแบบ Broadcast ไปยังผู้ติดตามทุกคนของ LINE OA (ไม่ต้องระบุ ID / ไม่ต้องพิมพ์ลงทะเบียน)
async function broadcastMessage(messages, token) {
  if (!token) return { ok: false, error: 'missing_token' };
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[LINE OA] Broadcast failed:', res.status, errText);
      return { ok: false, status: res.status, error: errText };
    }
    return { ok: true };
  } catch (err) {
    console.error('[LINE OA] Broadcast error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ดึงโปรไฟล์ผู้ใช้ LINE
async function getProfile(userId, token) {
  if (!token || !userId) return null;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

// แปลงรูปแบบเวลาภาษาไทย
function formatTimeTH(ts) {
  const d = new Date(ts || Date.now());
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} น.`;
}

// ชื่อตัวเลือกของรายการ (ออเดอร์จริงเก็บเป็น object {group,name,price})
function optNames(item) {
  return (Array.isArray(item.options) ? item.options : []).map(o => (typeof o === 'string' ? o : o && o.name)).filter(Boolean);
}

// สร้าง Flex Message สำหรับออเดอร์ (ถูกต้องตามมาตรฐาน LINE Flex Bubble Schema)
function buildOrderFlexMessage(order, eventTitle, baseUrl) {
  const queueNo = order.queueNo || '-';
  const name = order.name || 'ลูกค้า';
  const phone = order.phone || 'ไม่ระบุเบอร์';
  const total = Number(order.total || 0).toLocaleString('th-TH');
  const timeStr = formatTimeTH(order.createdAt);
  
  let payMethod = 'เงินสดหน้าร้าน';
  let payStatus = 'ชำระที่หน้าร้าน';
  if (order.payment && order.payment.method === 'promptpay') {
    payMethod = 'โอนพร้อมเพย์';
    if (order.payment.slip) {
      payStatus = 'แนบสลิปแล้ว รอตรวจ';
    } else if (order.status === 'paid' || order.status === 'preparing' || order.status === 'ready') {
      payStatus = 'ชำระแล้ว';
    } else {
      payStatus = 'รอแนบสลิป';
    }
  }

  // สร้าง rows ของรายการอาหาร แต่ละชิ้นจัดเป็น box มี margin
  const itemRows = [];
  (order.items || []).forEach((item, idx) => {
    const qty = item.qty || 1;
    const price = Number(item.unitPrice * qty || item.subtotal || 0).toLocaleString('th-TH');
    
    const itemContents = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: `${qty} × ${item.name}`,
            size: 'sm',
            color: '#1F2937',
            flex: 4,
            wrap: true
          },
          {
            type: 'text',
            text: `฿${price}`,
            size: 'sm',
            color: '#1F2937',
            align: 'end',
            flex: 2
          }
        ]
      }
    ];

    if (optNames(item).length) {
      itemContents.push({
        type: 'text',
        text: optNames(item).join(' · '),
        size: 'sm',
        color: '#8A8A8A',
        wrap: true,
        margin: 'xs'
      });
    }

    if (item.note) {
      itemContents.push({
        type: 'text',
        text: `โน้ต: ${item.note}`,
        size: 'sm',
        color: '#A8672B',
        wrap: true,
        margin: 'xs'
      });
    }

    itemRows.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: itemContents
    });
  });

  const bodyContents = [
    // ข้อมูลลูกค้า
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ลูกค้า', size: 'xs', color: '#8A8A8A', flex: 2 },
            { type: 'text', text: name, size: 'xs', color: '#2B2620', flex: 5, wrap: true }
          ]
        },
        ...(order.phone ? [{
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เบอร์โทร', size: 'xs', color: '#8A8A8A', flex: 2 },
            { type: 'text', text: phone, size: 'xs', color: '#2B2620', flex: 5 }
          ]
        }] : []),
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เวลา', size: 'xs', color: '#8A8A8A', flex: 2 },
            { type: 'text', text: timeStr, size: 'sm', color: '#111827', flex: 5 }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ชำระเงิน', size: 'xs', color: '#8A8A8A', flex: 2 },
            { type: 'text', text: `${payMethod} · ${payStatus}`, size: 'xs', color: '#2D5A4B', flex: 5, wrap: true }
          ]
        }
      ]
    },
    { type: 'separator', margin: 'lg', color: '#E9E3D8' },
    // หัวข้อรายการ
    {
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: 'รายการ',
          size: 'sm',
          color: '#8A8A8A'
        },
        ...itemRows
      ]
    },
    { type: 'separator', margin: 'lg', color: '#E9E3D8' },
    // สรุปยอดรวม
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: 'รวม',
          size: 'sm',
          color: '#111827',
          flex: 3
        },
        {
          type: 'text',
          text: `฿${total}`,
          size: 'lg',
          color: '#2D5A4B',
          weight: 'bold',
          align: 'end',
          flex: 3
        }
      ]
    }
  ];

  if (order.note) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      paddingAll: '12px',
      backgroundColor: '#FAF5EC',
      cornerRadius: '6px',
      spacing: 'xs',
      contents: [
        { type: 'text', text: 'หมายเหตุจากลูกค้า', size: 'xs', color: '#A8672B' },
        { type: 'text', text: order.note, size: 'xs', color: '#2B2620', wrap: true }
      ]
    });
  }

  const footerContents = [
    {
      type: 'button',
      style: 'primary',
      height: 'md',
      color: '#2D5A4B',
      action: {
        type: 'uri',
        label: 'จัดการออเดอร์',
        uri: `${baseUrl}/admin.html#orders`
      }
    },
    {
      type: 'button',
      style: 'link',
      height: 'sm',
      color: '#6B6258',
      margin: 'sm',
      action: {
        type: 'postback',
        label: 'ทราบแล้ว · ปิดเสียงเตือน',
        data: `action=ack&id=${order.id}&q=${order.queueNo}`,
        displayText: `ทราบแล้ว ออเดอร์ #${order.queueNo}`
      }
    }
  ];

  if (order.payment && order.payment.slip) {
    const slipUrl = `${baseUrl}${order.payment.slip}`;
    footerContents.push({
      type: 'button',
      style: 'link',
      height: 'sm',
      margin: 'xs',
      action: {
        type: 'uri',
        label: 'ดูสลิป',
        uri: slipUrl
      }
    });
  }

  return {
    type: 'flex',
    altText: `${eventTitle || 'ออเดอร์ใหม่'} คิว #${queueNo} (฿${total}) - ${name}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      styles: { header: { backgroundColor: '#F4EFE6' }, footer: { separator: false } },
      header: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '20px',
        alignItems: 'center',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 5,
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'เครป ริมคลอง', color: '#A8672B', size: 'xs', weight: 'bold' },
              { type: 'text', text: eventTitle || 'ออเดอร์ใหม่', color: '#2B2620', size: 'sm', wrap: true }
            ]
          },
          { type: 'text', text: `#${queueNo}`, color: '#2D5A4B', size: 'xxl', weight: 'bold', align: 'end', gravity: 'center', flex: 4 }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        paddingTop: '8px',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        paddingTop: '4px',
        spacing: 'sm',
        contents: footerContents
      }
    }
  };
}

// สร้าง Plain Text Message สำรอง
function buildOrderTextMessage(order, eventTitle, baseUrl) {
  const queueNo = order.queueNo || '-';
  const name = order.name || 'ลูกค้า';
  const phone = order.phone || 'ไม่ระบุ';
  const total = Number(order.total || 0).toLocaleString('th-TH');
  const timeStr = formatTimeTH(order.createdAt);
  
  let payMethod = order.payment && order.payment.method === 'cash' ? 'เงินสดหน้าร้าน' : 'โอนพร้อมเพย์';
  if (order.payment && order.payment.slip) payMethod += ' (แนบสลิปแล้ว)';

  const itemsTxt = (order.items || []).map(i => {
    let line = `• ${i.qty || 1}x ${i.name} (฿${(i.unitPrice || 0) * (i.qty || 1)})`;
    if (optNames(i).length) line += `\n - ${optNames(i).join(', ')}`;
    if (i.note) line += `\n - โน้ต: ${i.note}`;
    return line;
  }).join('\n');

  let text = ` เครป ริมคลอง\n━━━━━━━━━━━━━━━\n${eventTitle || 'มีออเดอร์ใหม่!'}\nคิว: #${queueNo}\nลูกค้า: ${name} (${phone})\nเวลา: ${timeStr}\n━━━━━━━━━━━━━━━\nรายการ:\n${itemsTxt}\n━━━━━━━━━━━━━━━\nยอดรวม: ฿${total}\nชำระเงิน: ${payMethod}`;
  
  if (order.note) text += `\nหมายเหตุ: ${order.note}`;
  text += `\n━━━━━━━━━━━━━━━\nทราบแล้ว (ปิดเสียงเว็บ): ${baseUrl}/api/orders/${order.id}/ack`;
  text += `\nจัดการออเดอร์: ${baseUrl}/admin.html#orders`;
  if (order.payment && order.payment.slip) {
    text += `\nดูสลิป: ${baseUrl}${order.payment.slip}`;
  }

  return { type: 'text', text };
}

// ฟังก์ชันหลัก: ส่งการแจ้งเตือนออเดอร์
// หากไม่มีการระบุ User ID ระบบจะใช้ Broadcast ส่งหาทุกคนที่เป็นเพื่อนกับ LINE OA อัตโนมัติทันที
async function notifyOrder(order, eventTitle = 'มีออเดอร์ใหม่!') {
  const { token, baseUrl, enabled } = getCredentials();
  if (!enabled || !token) {
    console.log('[LINE OA] ข้ามการส่งแจ้งเตือน (ยังไม่ได้ตั้งค่า Token หรือปิดการแจ้งเตือน)');
    return { ok: false, error: 'disabled_or_no_token' };
  }

  const recipients = getAllRecipients();
  const flexMsg = buildOrderFlexMessage(order, eventTitle, baseUrl);
  const textMsg = buildOrderTextMessage(order, eventTitle, baseUrl);

  // 1. ถ้ามีรายชื่อผู้รับระบุไว้ ให้ Push ส่งไปยังทุกคน
  if (recipients.length > 0) {
    console.log(`[LINE OA] กำลังส่งแจ้งเตือนออเดอร์ #${order.queueNo} ไปยัง ${recipients.length} ผู้รับ...`);
    const results = await Promise.allSettled(
      recipients.map(async to => {
        let res = await pushMessage(to, flexMsg, token);
        if (!res.ok) res = await pushMessage(to, textMsg, token);
        return { to, ...res };
      })
    );
    return { ok: true, mode: 'push', results };
  }

  // 2. ถ้าไม่ได้ระบุ ID ผู้รับ -> ใช้ Broadcast ส่งตรงถึงเพื่อนทุกคนใน LINE OA ทันที (ไม่ต้องพิมพ์ลงทะเบียน!)
  console.log(`[LINE OA] ส่งการแจ้งเตือนออเดอร์ #${order.queueNo} แบบ Broadcast ทันที...`);
  let res = await broadcastMessage(flexMsg, token);
  if (!res.ok) {
    console.warn('[LINE OA] Broadcast Flex failed, falling back to text message...');
    res = await broadcastMessage(textMsg, token);
  }

  return { ok: res.ok, mode: 'broadcast', res };
}

// ทดสอบส่งการแจ้งเตือนตัวอย่าง
async function sendTest(targetUserId = null) {
  const { token, baseUrl } = getCredentials();
  if (!token) throw new Error('ยังไม่ได้ระบุ LINE Channel Access Token');

  let recipients = targetUserId ? [targetUserId] : getAllRecipients();
  const sampleOrder = {
    id: 'test_sample',
    queueNo: 'A01',
    name: 'ทดสอบระบบ',
    phone: '098-712-7099',
    createdAt: Date.now(),
    total: 75,
    payment: { method: 'promptpay', slip: null },
    status: 'pending_payment',
    note: 'ทดสอบระบบแจ้งเตือนออเดอร์ เครป ริมคลอง',
    items: [
      {
        name: 'เครปช็อกโกแลตกล้วย',
        qty: 1,
        price: 45,
        subtotal: 45,
        options: ['แป้งกรอบ', 'กล้วยหอม', 'ราดช็อกโกแลต']
      },
      {
        name: 'ชาไทยเย็น',
        qty: 1,
        price: 30,
        subtotal: 30,
        options: ['หวานน้อย (50%)']
      }
    ]
  };

  const flexMsg = buildOrderFlexMessage(sampleOrder, 'ทดสอบการแจ้งเตือน', baseUrl);
  const textMsg = buildOrderTextMessage(sampleOrder, 'ทดสอบการแจ้งเตือน', baseUrl);

  if (recipients.length > 0) {
    const results = [];
    for (const to of recipients) {
      let r = await pushMessage(to, flexMsg, token);
      if (!r.ok) r = await pushMessage(to, textMsg, token);
      results.push({ to, ...r });
    }
    return { ok: true, mode: 'push', recipients, results };
  }

  // ส่งแบบ Broadcast
  let r = await broadcastMessage(flexMsg, token);
  if (!r.ok) r = await broadcastMessage(textMsg, token);
  return { ok: r.ok, mode: 'broadcast', res: r };
}

// ตัวจัดการ Webhook จาก LINE Platform
async function handleWebhook(req, res) {
  const { secret, token, baseUrl } = getCredentials();
  const signature = req.headers['x-line-signature'];

  if (secret && signature) {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    if (!verifySignature(rawBody, signature, secret)) {
      console.warn('[LINE OA] Webhook signature verification FAILED!');
      return res.status(401).json({ error: 'invalid_signature' });
    }
  }

  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [];

  if (events.length === 0) {
    console.log('[LINE OA] Webhook ping/verification received successfully.');
    return res.status(200).json({ status: 'ok' });
  }

  for (const ev of events) {
    try {
      const source = ev.source || {};
      const userId = source.userId;
      const replyToken = ev.replyToken;

      if (userId) {
        console.log(`[LINE OA Inbound Event] Type: ${ev.type}, UserId: ${userId}, Text: ${ev.message ? ev.message.text : ''}`);
        // เก็บ ID อัตโนมัติทันทีที่มีคนทักหรือแอดเพื่อน
        addSubscriber(userId);
      }

      // กรณีมีคนกดปุ่ม Postback (เช่น ปุ่ม " ทราบแล้ว (ปิดเสียงเตือนเว็บ)")
      if (ev.type === 'postback' && ev.postback && ev.postback.data) {
        const query = new URLSearchParams(ev.postback.data);
        const action = query.get('action');
        const orderId = query.get('id');
        const queueNo = query.get('q') || '';

        if (action === 'ack' && orderId) {
          console.log(`[LINE OA] Postback ACK: Order ${orderId} (Queue #${queueNo})`);
          if (typeof _onAckOrder === 'function') {
            _onAckOrder(orderId, queueNo, 'LINE');
          }
          if (replyToken && token) {
            await replyMessage(replyToken, {
              type: 'text',
              text: ` รับทราบออเดอร์ คิว #${queueNo} เรียบร้อยแล้วครับ!\n\n(ระบบปิดเสียงแจ้งเตือนที่หน้าเว็บหน้าร้านให้ทันทีแล้ว )`
            }, token);
          }
          continue;
        }
      }

      // เมื่อแอดเพื่อนใหม่
      if (ev.type === 'follow') {
        const welcomeText = `สวัสดีครับ \nยินดีต้อนรับสู่ LINE Official Account ของ "เครป ริมคลอง"\n\nระบบเชื่อมต่อการแจ้งเตือนออเดอร์เรียบร้อยแล้วครับ `;
        if (replyToken && token) await replyMessage(replyToken, { type: 'text', text: welcomeText }, token);
        continue;
      }
    } catch (e) {
      console.error('[LINE OA] Error processing event:', e);
    }
  }

  return res.status(200).json({ status: 'ok' });
}

module.exports = {
  init,
  getSubscribers,
  addSubscriber,
  removeSubscriber,
  getCredentials,
  getAllRecipients,
  verifySignature,
  replyMessage,
  pushMessage,
  broadcastMessage,
  buildOrderFlexMessage,
  buildOrderTextMessage,
  notifyOrder,
  sendTest,
  handleWebhook
};
