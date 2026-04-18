@echo off
chcp 65001 >nul
echo ========================================
echo  Auto Wallpaper Backend 啟動腳本
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] 啟動 Python 標點服務 (port 5000)...
start "PunctService" python punctuation_service.py

echo 等待 Python 服務啟動...
timeout /t 3 /nobreak >nul

echo [2/2] 啟動 Node.js 後端 (port 3000)...
node wallpaper-server-simple.js

pause
