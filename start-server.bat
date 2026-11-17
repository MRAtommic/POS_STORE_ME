@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   กำลังเริ่มต้นเซิร์ฟเวอร์ POS เครป ริมคลอง...
echo   (เคลียร์พอร์ต 3000 และเปิดเซิร์ฟเวอร์)
echo ========================================================
echo.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo ปิดโปรเซสเก่าบนพอร์ต 3000 PID: %%a
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 >nul
node server.js
pause
