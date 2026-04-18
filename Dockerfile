FROM python:3.10-slim

WORKDIR /app

# 安裝系統依賴
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安裝 Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pkg

# 複製應用程式
COPY . .

# 安裝 Python 依賴
RUN pip install --no-cache-dir -r requirements.txt

# 安裝 Node.js 依賴
RUN npm install

# 打包 Node.js 為單一執行檔
RUN pkg wallpaper-server-simple.js --target node18-linux-x64 --output server

# 啟動指令
CMD ["sh", "start.sh"]
