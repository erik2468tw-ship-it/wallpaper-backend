# Auto Wallpaper Backend - 部署指南

## 📦 部署資料夾結構

```
wallpaper-backend/
├── wallpaper-server-simple.js   # Node.js 後端
├── punctuation_service.py      # Python 標點服務
├── requirements.txt             # Python 依賴
├── package.json                # Node.js 依賴
├── start.bat                   # Windows 啟動腳本
├── start.sh                    # Linux/NAS 啟動腳本
├── Dockerfile                  # Docker 部署（可選）
└── DEPLOY.md                  # 本檔案
```

---

## 🖥️ 方案一：Windows 電腦部署

### 前置需求
- Node.js 18+ (https://nodejs.org/)
- Python 3.10+ (https://www.python.org/)
- 網路連線（首次啟動需下載模型 ~400MB）

### 步驟

1. **複製整個資料夾**到新電腦

2. **安裝 Node.js 依賴**
   ```bash
   cd wallpaper-backend
   npm install
   ```

3. **安裝 Python 依賴**
   ```bash
   pip install -r requirements.txt
   ```

4. **啟動服務**
   ```bash
   # 雙擊 start.bat 或在命令提示字元執行：
   start.bat
   ```

5. **開啟瀏覽器測試**
   - http://localhost:3000/index.html

---

## 🐧 方案二：Linux / NAS / 樹莓派部署

### 前置需求
- Node.js 18+
- Python 3.10+
- pip3

### 步驟

1. **複製資料夾**
   ```bash
   scp -r wallpaper-backend user@your-nas:/path/to/wallpaper-backend
   ```

2. **安裝依賴**
   ```bash
   cd wallpaper-backend
   npm install
   pip3 install -r requirements.txt
   ```

3. **賦予執行權限**
   ```bash
   chmod +x start.sh
   ```

4. **啟動服務**
   ```bash
   ./start.sh
   ```

5. **確認服務運行**
   ```bash
   curl http://localhost:3000/api/stats
   ```

---

## 🐳 方案三：Docker 部署（推薦 NAS）

### 前置需求
- Docker 已安裝

### 步驟

1. **複製資料夾到 NAS**

2. **建置 Docker 映像**
   ```bash
   cd wallpaper-backend
   docker build -t wallpaper-backend .
   ```

3. **啟動容器**
   ```bash
   docker run -d \
     --name wallpaper-backend \
     -p 3000:3000 \
     -p 5000:5000 \
     -v ./data:/app/data \
     wallpaper-backend
   ```

---

## 📱 Android App 設定

在 VoiceIME 中修改 API 位置：

```kotlin
// PunctuationService.kt
private val apiBaseUrl = "http://你的伺服器IP:3000/"
```

---

## 🔧 常用指令

### 檢查服務狀態
```bash
# Node.js 後端
curl http://localhost:3000/api/stats

# Python 標點服務
curl http://localhost:5000/health
```

### 重啟服務
```bash
# Windows
# 關閉命令視窗後重新執行 start.bat

# Linux
pkill -f punctuation_service.py
pkill -f wallpaper-server-simple.js
./start.sh
```

### 查看 Log
```bash
# Python 服務 log
# 查看終端機輸出
```

---

## ⚠️ 注意事項

1. **首次啟動**：Python 服務會下載 AI 模型，需要幾分鐘和網路連線
2. **防火牆**：確保 3000 和 5000 port 開放
3. **NAS 效能**：AI 模型推論需要 CPU，建議有足夠效能的 NAS

---

## 🔧 疑難排解

### Python 服務無法啟動
```bash
# 檢查 fastapi 是否安裝
pip install fastapi uvicorn

# 手動測試
python punctuation_service.py
```

### Node.js 服務無法啟動
```bash
# 檢查依賴
npm install

# 清除快取
npm cache clean --force
```

### 模型下載失敗
```bash
# 設定 Hugging Face Token（可選）
set HF_TOKEN=your_token

# 或手動下載
python -c "from transformers import AutoModel; AutoModel.from_pretrained('p208p2002/zh-wiki-punctuation-restore')"
```
