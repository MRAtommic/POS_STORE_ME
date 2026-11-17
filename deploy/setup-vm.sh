#!/usr/bin/env bash
# ติดตั้ง POS บนเซิร์ฟเวอร์ Ubuntu 22.04/24.04 (เช่น Oracle Cloud Always Free)
# วิธีใช้ (หลังคัดลอกโค้ดไปไว้ที่ /opt/pos แล้ว):   cd /opt/pos && sudo bash deploy/setup-vm.sh
# สคริปต์นี้รันซ้ำได้ ไม่ทับข้อมูลเดิม
set -euo pipefail
APP_DIR=/opt/pos

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย sudo"; exit 1; }
[ -f "$APP_DIR/server.js" ] || { echo "ไม่พบ $APP_DIR/server.js — คัดลอกโค้ดมาที่ /opt/pos ก่อน (ดู deploy/README-DEPLOY.md ข้อ 4)"; exit 1; }

echo "[1/6] ติดตั้ง Node.js 22 LTS (ถ้ายังไม่มี)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "[2/6] สร้างผู้ใช้ pos (ไม่มีสิทธิ์ล็อกอิน) และติดตั้งแพ็กเกจ"
id pos >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin pos
cd "$APP_DIR"
mkdir -p data
npm ci --omit=dev

echo "[3/6] ตั้งค่า .env"
if [ ! -f .env ]; then
  cp deploy/env.production.example .env
  echo "  → สร้าง .env ใหม่แล้ว โปรดแก้ค่า: sudo nano $APP_DIR/.env  (ใส่ ADMIN_EMAILS และ GOOGLE_CLIENT_ID)"
fi
chown -R pos:pos "$APP_DIR"
chmod 600 .env

echo "[4/6] ติดตั้งบริการ pos (เปิดอัตโนมัติ ล่มแล้วเริ่มเอง)"
cp deploy/pos.service /etc/systemd/system/pos.service
systemctl daemon-reload
systemctl enable --now pos
sleep 2
systemctl --no-pager --lines=5 status pos || true

echo "[5/6] ติดตั้ง cloudflared (ตัวเชื่อมโดเมนถาวร ไม่ต้องเปิดพอร์ตใดๆ ในเซิร์ฟเวอร์)"
if ! command -v cloudflared >/dev/null 2>&1; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
  dpkg -i /tmp/cloudflared.deb
fi
cloudflared --version

echo "[6/6] ตั้งสำรองข้อมูลอัตโนมัติทุกวันตี 3 (เก็บ 14 วัน ที่ /opt/pos-backups)"
install -m 755 deploy/backup.sh /usr/local/bin/pos-backup
echo '15 3 * * * root /usr/local/bin/pos-backup' > /etc/cron.d/pos-backup

echo
echo "เสร็จแล้ว ✅  ขั้นต่อไป: เชื่อมโดเมนด้วย   sudo cloudflared service install <TOKEN>   (ดู deploy/README-DEPLOY.md ข้อ 7)"
echo "ดูบันทึกการทำงาน:  sudo journalctl -u pos -f"
