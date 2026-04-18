# Auto Wallpaper Backend

自動換桌布 App 的後端服務，包含：

- 📊 **Analytics** - 追蹤安裝和使用統計
- 🖼️ **Gallery API** - 線上圖庫管理
- 📦 **Version API** - 版本管理和推播更新
- 🔔 **FCM Push** - Firebase 推播通知

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數
# 複製 .env.example 並填入您的 Firebase Server Key
cp .env.example .env

# 3. 啟動伺服器
npm start

# 4. 開發模式（自動重啟）
npm run dev
```

## 環境變數

```env
# Firebase Cloud Messaging Server Key（必填）
FCM_SERVER_KEY=your_firebase_server_key_here

# 伺服器端口（可選，預設 3000）
PORT=3000
```

## API 端點

### Analytics

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/api/track` | 追蹤安裝/活躍 |

### Gallery

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/gallery` | 獲取圖庫列表 |
| GET | `/api/gallery/categories` | 獲取分類 |
| GET | `/api/gallery/:id` | 獲取單張圖片 |

### Version

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/version/check` | 檢查更新 |
| POST | `/api/admin/version` | 新增版本 |
| POST | `/api/admin/push-update` | 發送更新推播 |

### Admin

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/stats` | 統計數據 |
| POST | `/api/admin/gallery/upload` | 上傳圖片 |

## 管理命令範例

```bash
# 新增版本
curl -X POST http://localhost:3000/api/admin/version \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.1.0",
    "version_code": 2,
    "min_version_code": 1,
    "download_url": "/apk/app-v1.1.0.apk",
    "release_notes": "新增線上圖庫功能",
    "is_mandatory": false
  }'

# 發送更新推播
curl -X POST http://localhost:3000/api/admin/push-update \
  -H "Content-Type: application/json" \
  -d '{
    "version_code": 2,
    "title": "🌟 新版本發布",
    "body": "發現新版本，請更新",
    "download_url": "https://your-domain.com/apk/app-v1.1.0.apk"
  }'
```

## Firebase 設定

1. 建立 Firebase 專案：https://console.firebase.google.com
2. 啟用 Cloud Messaging
3. 取得 Server Key：
   - 專案設定 → 雲端訊息 → 取得 Server Key
4. 將 Server Key 填入 `.env` 的 `FCM_SERVER_KEY`

## Android App 設定

在 `gradle.properties` 或 `local.properties` 加入：

```properties
API_BASE_URL=https://your-server-domain.com/
```

## 目錄結構

```
backend/
├── wallpaper-server.js    # 主程式
├── data/                  # SQLite 資料庫（自動建立）
├── static/                # 靜態檔案
│   ├── apk/              # APK 更新檔案
│   ├── gallery/          # 線上圖庫原圖
│   └── thumbnails/       # 縮圖
└── package.json
```

## 部署建議

### 使用 PM2 部署

```bash
npm install -g pm2
pm2 start wallpaper-server.js --name wallpaper-backend
pm2 save
pm2 startup
```

### 使用 Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
    }
    
    location /apk {
        alias /var/www/wallpaper/static/apk;
        autoindex on;
    }
}
```
