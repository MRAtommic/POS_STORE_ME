@echo off
chcp 65001 >nul
title POS เครป ริมคลอง (Online)
cd /d "%~dp0"
node run.js
pause
