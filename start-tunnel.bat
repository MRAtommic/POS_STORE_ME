@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   กำลังเริ่มต้น Cloudflare Tunnel สำหรับ POS...
echo   เซิร์ฟเวอร์หลักต้องรันอยู่ที่ http://localhost:3000
echo ========================================================
echo.
echo กำลังสร้างลิงก์ HTTPS ภายนอก...
echo กรุณารอสักครู่ แล้วดูบรรทัดที่มี https://xxxx.trycloudflare.com
echo.
cloudflared tunnel --url http://127.0.0.1:3000
pause
