#!/usr/bin/env bash
# สำรองโฟลเดอร์ข้อมูลของ POS ทุกวัน เก็บย้อนหลัง 14 วัน (ติดตั้งโดย setup-vm.sh)
set -euo pipefail
SRC=/opt/pos/data
DEST=/opt/pos-backups
mkdir -p "$DEST"
tar -czf "$DEST/pos-data-$(date +%Y%m%d).tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
find "$DEST" -name 'pos-data-*.tar.gz' -mtime +14 -delete
