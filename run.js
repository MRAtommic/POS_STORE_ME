const { spawn, execSync } = require('child_process');
const path = require('path');

console.log('============================================================');
console.log('  🥞 ระบบร้าน เครป ริมคลอง (POS & Online Order)');
console.log('============================================================\n');

// 1. เคลียร์พอร์ต 3000 หากมีโปรเซสเก่าค้างอยู่
try {
  const stdout = execSync('netstat -ano | findstr :3000 | findstr LISTENING', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== '0' && pid !== String(process.pid)) {
      console.log(`[CLEANUP] เคลียร์พอร์ต 3000 จากโปรเซสเก่า (PID: ${pid})...`);
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
    }
  }
} catch {}

// 2. โหลดเซิร์ฟเวอร์ Express (server.js) ทำงานในโปรเซสเดียวกัน
console.log('[1/2] เริ่มต้นเซิร์ฟเวอร์ POS (http://localhost:3000)...');
require('./server.js');

// 3. เริ่มต้น Cloudflare Tunnel เพื่อเปิดออนไลน์ไปที่ https://crepe.openchat.sbs
const homeDir = process.env.USERPROFILE || 'C:\\Users\\KC_Ketwilai';
const configPath = path.join(homeDir, '.cloudflared', 'config-pos.yml');

console.log('[2/2] เริ่มต้น Cloudflare Tunnel (https://crepe.openchat.sbs)...\n');
const tunnel = spawn('cloudflared', ['--config', configPath, 'tunnel', 'run', 'pos-crepe'], {
  stdio: 'inherit',
  shell: true
});

tunnel.on('error', (err) => {
  console.error('[Tunnel Error] ไม่สามารถเริ่ม tunnel ได้:', err.message);
});

tunnel.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.warn(`[Tunnel] สิ้นสุดการทำงาน (รหัส: ${code})`);
  }
});

function cleanup() {
  console.log('\n[SHUTDOWN] กำลังปิดระบบ POS และ Tunnel...');
  try {
    tunnel.kill('SIGINT');
  } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

