#!/bin/bash
# Auto Wallpaper Backend 啟動腳本 (Linux/NAS/樹莓派)

cd "$(dirname "$0")"

echo "========================================"
echo " Auto Wallpaper Backend 啟動腳本"
echo "========================================"
echo ""

# 啟動 Python 標點服務 (background)
echo "[1/2] 啟動 Python 標點服務 (port 5000)..."
nohup python3 punctuation_service.py > punct_service.log 2>&1 &
PUNCT_PID=$!
echo "Python 標點服務 PID: $PUNCT_PID"

# 等待服務啟動
sleep 3

# 檢查 Python 服務是否正常
if curl -s http://localhost:5000/health > /dev/null 2>&1; then
    echo "✓ Python 標點服務啟動成功"
else
    echo "✗ Python 標點服務啟動失敗，請檢查 log: punct_service.log"
fi

echo "[2/2] 啟動 Node.js 後端 (port 3000)..."
# 啟動 Node.js (如果已安裝 via nvm 或 direct)
if command -v node &> /dev/null; then
    nohup node wallpaper-server-simple.js > node_server.log 2>&1 &
    echo "Node.js 後端 PID: $!"
    echo "✓ 啟動完成"
    echo ""
    echo "API 端點:"
    echo "  - Stats: http://localhost:3000/api/stats"
    echo "  - Gallery: http://localhost:3000/api/gallery"
    echo "  - Version: http://localhost:3000/api/version/check"
    echo "  - Punct: http://localhost:3000/api/punctuation/restore"
    echo ""
    echo "管理頁面:"
    echo "  - http://localhost:3000/index.html"
    echo ""
    echo "Log 檔案:"
    echo "  - punct_service.log"
    echo "  - node_server.log"
else
    echo "✗ Node.js 未安裝"
fi
