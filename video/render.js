const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

async function main() {
  console.log('[1/4] กำลังเริ่มต้น Puppeteer Headless Chrome...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  const htmlPath = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
  console.log('[2/4] เปิดหน้าสตูดิโอ:', htmlPath);
  await page.goto(htmlPath, { waitUntil: 'networkidle0' });

  // รอให้ฟอนต์และรูปภาพพร้อม
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await new Promise(r => setTimeout(r, 1000));

  // บันทึกภาพ Snapshot ความละเอียดสูง 1080x1920 ของทั้ง 6 ฉาก
  console.log('[3/4] กำลังบันทึกภาพถ่าย Snapshot ความละเอียดสูง 1080x1920 ของทั้ง 6 ฉาก...');
  const sceneTimes = [
    { scene: 1, time: 2.0, name: 'scene_1_intro' },
    { scene: 2, time: 7.0, name: 'scene_2_slogan' },
    { scene: 3, time: 11.0, name: 'scene_3_menu_chocolate_banana' },
    { scene: 3.5, time: 13.0, name: 'scene_3_menu_egg_ham_cheese' },
    { scene: 4, time: 21.0, name: 'scene_4_friendly_service' },
    { scene: 5, time: 27.0, name: 'scene_5_location_village7' },
    { scene: 6, time: 33.0, name: 'scene_6_qr_order_online' }
  ];

  for (const s of sceneTimes) {
    const dataUrl = await page.evaluate((t) => {
      // เรียกใช้ฟังก์ชันเรนเดอร์ของหน้า index.html
      const canvas = document.getElementById('videoCanvas');
      // trigger seek
      const ev = new CustomEvent('seek', { detail: t });
      // render at time t directly via canvas
      return canvas.toDataURL('image/png');
    }, s.time);

    // Save canvas frame
    await page.evaluate((t) => {
      // simulate clicking timeline
      const bar = document.getElementById('timelineBar');
      const rect = bar.getBoundingClientRect();
      const clickEvt = new MouseEvent('click', {
        clientX: rect.left + (t / 36.0) * rect.width,
        clientY: rect.top + 2,
        bubbles: true
      });
      bar.dispatchEvent(clickEvt);
    }, s.time);

    await new Promise(r => setTimeout(r, 400));

    const canvasElement = await page.$('#videoCanvas');
    const outPath = path.join(SNAPSHOTS_DIR, `${s.name}.png`);
    await canvasElement.screenshot({ path: outPath });
    console.log(`  ✓ บันทึกภาพฉาก: ${s.name}.png`);
  }

  // เรนเดอร์วิดีโอผ่าน MediaRecorder ใน Headless Chrome
  console.log('[4/4] กำลังเรนเดอร์วิดีโอ 1080x1920 ความยาว 36 วินาที...');
  const videoBuffer = await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const canvas = document.getElementById('videoCanvas');
      const audio = document.getElementById('bgmAudio');
      const stream = canvas.captureStream(30);

      try {
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const srcNode = actx.createMediaElementSource(audio);
        const dest = actx.createMediaStreamDestination();
        srcNode.connect(dest);
        srcNode.connect(actx.destination);
        if (dest.stream.getAudioTracks().length) {
          stream.addTrack(dest.stream.getAudioTracks()[0]);
        }
      } catch (e) {}

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
        videoBitsPerSecond: 8000000
      });

      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result.split(',')[1]); // base64
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      audio.currentTime = 0;
      audio.play().catch(() => {});

      const fps = 30;
      const totalFrames = 36 * fps;
      let frame = 0;
      const bar = document.getElementById('timelineBar');
      const rect = bar.getBoundingClientRect();

      const timer = setInterval(() => {
        frame++;
        const t = frame / fps;
        const clickEvt = new MouseEvent('click', {
          clientX: rect.left + (t / 36.0) * rect.width,
          clientY: rect.top + 2,
          bubbles: true
        });
        bar.dispatchEvent(clickEvt);

        if (frame >= totalFrames) {
          clearInterval(timer);
          recorder.stop();
        }
      }, 1000 / fps);
    });
  });

  const videoOutPath = path.join(__dirname, 'crepe_rimklong_promo.webm');
  fs.writeFileSync(videoOutPath, Buffer.from(videoBuffer, 'base64'));
  const stats = fs.statSync(videoOutPath);
  console.log(`\n🎉 เรนเดอร์วิดีโอเสร็จสมบูรณ์!`);
  console.log(`📁 ไฟล์: ${videoOutPath}`);
  console.log(`📊 ขนาด: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  await browser.close();
}

main().catch(err => {
  console.error('[Error]:', err);
  process.exit(1);
});

