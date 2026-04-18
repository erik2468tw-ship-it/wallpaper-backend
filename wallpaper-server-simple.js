/**
 * Auto Wallpaper App - Simple Backend (No FCM)
 * 
 * 功能：
 * 1. Analytics - 追蹤安裝/活躍
 * 2. Gallery API - 線上圖庫
 * 3. Version API - 版本管理/檢查更新
 * 4. Punctuation API - 智慧標點（呼叫 Python 服務）
 * 
 * 不需要 Firebase / FCM，APP 自行輪詢版本
 */

const express = require('express');
const sqlite3 = require('sqlite3');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.static('static'));

// ==================== 內網存取限制中介軟體 ====================
function isPrivateIP(ip) {
    if (!ip) return false;
    
    // 移除 IPv6 前綴
    ip = ip.replace(/^::ffff:/i, '');
    
    // 本地
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    
    // 10.0.0.0 - 10.255.255.255
    if (/^10\./.test(ip)) return true;
    
    // 172.16.0.0 - 172.31.255.255
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    
    // 192.168.0.0 - 192.168.255.255
    if (/^192\.168\./.test(ip)) return true;
    
    // 100.64.0.0 - 100.127.255.255 (電信級 NAT)
    if (/^100\.(6[4-9]|7[0-9]|8[0-9]|9[0-9]|1[0-1][0-9]|12[0-7])\./.test(ip)) return true;
    
    return false;
}

function adminAuthMiddleware(req, res, next) {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
                   || req.connection?.remoteAddress 
                   || req.socket?.remoteAddress
                   || '127.0.0.1';
    
    if (isPrivateIP(clientIP)) {
        next();
    } else {
        res.status(403).json({ error: 'Access denied. Admin API only accessible from local or private network.' });
    }
}

const db = new sqlite3.Database('./data/app.db');

// ==================== VoiceIME 標點統計 ====================
const PUNCT_STATS_FILE = './data/punct_stats.json';

// 載入統計資料
function loadPunctStats() {
    try {
        if (fs.existsSync(PUNCT_STATS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PUNCT_STATS_FILE, 'utf8'));
            return {
                total_calls: data.total_calls || 0,
                success_calls: data.success_calls || 0,
                failed_calls: data.failed_calls || 0,
                last_call: data.last_call || null,
                unique_devices: new Set(data.unique_devices || [])
            };
        }
    } catch (e) {
        console.error('載入統計失敗:', e.message);
    }
    return {
        total_calls: 0,
        success_calls: 0,
        failed_calls: 0,
        last_call: null,
        unique_devices: new Set()
    };
}

// 儲存統計資料
function savePunctStats() {
    try {
        const data = {
            total_calls: punctStats.total_calls,
            success_calls: punctStats.success_calls,
            failed_calls: punctStats.failed_calls,
            last_call: punctStats.last_call,
            unique_devices: Array.from(punctStats.unique_devices)
        };
        fs.writeFileSync(PUNCT_STATS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('儲存統計失敗:', e.message);
    }
}

const punctStats = loadPunctStats();

function recordPunctCall(success, deviceId) {
    punctStats.total_calls++;
    if (success) punctStats.success_calls++;
    else punctStats.failed_calls++;
    if (deviceId) punctStats.unique_devices.add(deviceId);
    punctStats.last_call = new Date().toISOString();
    savePunctStats(); // 每筆資料都儲存
}

// 確保目錄存在
['./data', './static/apk', './static/gallery', './static/thumbnails'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ==================== 資料庫初始化 ====================
db.serialize(() => {
    // Analytics
    db.run(`
        CREATE TABLE IF NOT EXISTS installs (
            id INTEGER PRIMARY KEY,
            anonymous_id TEXT UNIQUE,
            app_version TEXT,
            os_version TEXT,
            first_install INTEGER,
            last_active INTEGER
        )
    `);

    // 版本管理
    db.run(`
        CREATE TABLE IF NOT EXISTS versions (
            id INTEGER PRIMARY KEY,
            version TEXT UNIQUE,
            version_code INTEGER,
            min_version_code INTEGER,
            download_url TEXT,
            release_notes TEXT,
            is_mandatory INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // 線上圖庫
    db.run(`
        CREATE TABLE IF NOT EXISTS gallery_images (
            id INTEGER PRIMARY KEY,
            filename TEXT UNIQUE,
            title TEXT,
            category TEXT,
            thumbnail_url TEXT,
            full_url TEXT,
            width INTEGER,
            height INTEGER,
            size INTEGER,
            downloads INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // 初始化測試版本
    db.get(`SELECT * FROM versions WHERE version = '1.0.0'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO versions (version, version_code, min_version_code, download_url, release_notes, is_mandatory, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['1.0.0', 1, 1, '/apk/AutoWallpaper-debug.apk', '初始版本', 0, Date.now()]);
        }
    });
});

// ==================== Analytics APIs ====================

app.post('/api/track', (req, res) => {
    const { anonymous_id, app_version, os_version } = req.body;
    
    if (!anonymous_id) {
        return res.status(400).json({ error: 'anonymous_id required' });
    }
    
    db.get(`SELECT * FROM installs WHERE anonymous_id = ?`, [anonymous_id], (err, row) => {
        if (row) {
            db.run(`UPDATE installs SET last_active = ?, app_version = ? WHERE anonymous_id = ?`, 
                [Date.now(), app_version, anonymous_id]);
        } else {
            db.run(`INSERT INTO installs (anonymous_id, app_version, os_version, first_install, last_active) VALUES (?, ?, ?, ?, ?)`,
                [anonymous_id, app_version || 'unknown', os_version || 'unknown', Date.now(), Date.now()]);
        }
    });
    
    res.json({ ok: true });
});

// ==================== Version APIs ====================

// 更新版本資訊
app.post('/api/version/update', (req, res) => {
    const { app, version, version_code, release_notes, download_url, is_mandatory } = req.body;
    
    if (app === 'voiceime') {
        try {
            const versionData = {
                latest: {
                    version: version || '1.0.0',
                    version_code: version_code || 1,
                    is_mandatory: is_mandatory !== undefined ? is_mandatory : true,
                    min_version_code: 0,
                    download_url: download_url || '',
                    release_notes: release_notes || ''
                }
            };
            fs.writeFileSync('./voiceime_version.json', JSON.stringify(versionData, null, 2));
            res.json({ success: true, message: '版本資訊已更新' });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
        return;
    }
    
    // AutoWallpaper 版本更新（使用 SQLite）
    db.run(`
        INSERT OR REPLACE INTO versions (version, version_code, min_version_code, download_url, release_notes, is_mandatory, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [version, version_code, 0, download_url, release_notes, is_mandatory ? 1 : 0, Date.now()], (err) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, message: '版本資訊已更新' });
    });
});

// 檢查更新（APP 輪詢這個 endpoint）
app.get('/api/version/check', (req, res) => {
    const { version_code, app } = req.query;
    
    // VoiceIME 專用版本檢查
    if (app === 'voiceime') {
        try {
            const versionData = JSON.parse(fs.readFileSync('./voiceime_version.json', 'utf8'));
            const latest = versionData.latest;
            const currentCode = parseInt(version_code) || 0;
            const hasUpdate = currentCode < latest.version_code;
            
            res.json({
                has_update: hasUpdate,
                is_mandatory: hasUpdate ? !!latest.is_mandatory : false,
                latest_version: hasUpdate ? latest : null,
                app: 'voiceime'
            });
        } catch (e) {
            res.json({ has_update: false, app: 'voiceime' });
        }
        return;
    }
    
    // 預設是 AutoWallpaper
    db.get(`SELECT * FROM versions ORDER BY version_code DESC LIMIT 1`, (err, latest) => {
        if (!latest) {
            return res.json({ has_update: false });
        }
        
        const currentCode = parseInt(version_code) || 0;
        const hasUpdate = currentCode < latest.version_code;
        
        // 轉換為完整 URL
        const baseUrl = process.env.API_BASE_URL || 'http://203.222.24.35:3000';
        const downloadUrl = latest.download_url.startsWith('http') 
            ? latest.download_url 
            : `${baseUrl}${latest.download_url}`;
        
        res.json({
            has_update: hasUpdate,
            is_mandatory: hasUpdate ? !!latest.is_mandatory : false,
            latest_version: hasUpdate ? {
                version: latest.version,
                version_code: latest.version_code,
                min_version_code: latest.min_version_code,
                download_url: downloadUrl,
                release_notes: latest.release_notes
            } : null
        });
    });
});

// ==================== 管理 API（需要內網存取）====================
app.use('/api/admin', adminAuthMiddleware);

// 新增版本（管理後台）
app.post('/api/admin/version', (req, res) => {
    const { version, version_code, min_version_code, download_url, release_notes, is_mandatory } = req.body;
    
    if (!version || !version_code) {
        return res.status(400).json({ error: 'version and version_code required' });
    }
    
    db.run(`INSERT OR REPLACE INTO versions (version, version_code, min_version_code, download_url, release_notes, is_mandatory, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [version, version_code, min_version_code || 1, download_url, release_notes, is_mandatory ? 1 : 0, Date.now()],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ ok: true, id: this.lastID });
        });
});

// 列出所有版本
app.get('/api/admin/versions', (req, res) => {
    db.all(`SELECT * FROM versions ORDER BY version_code DESC`, (err, rows) => {
        res.json({ versions: rows });
    });
});

// ==================== Gallery APIs ====================

// 同步資料夾中的圖片到資料庫
app.post('/api/admin/gallery/sync', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    // 使用絕對路徑
    const baseDir = __dirname || '.';
    const galleryDir = path.isAbsolute(baseDir) 
        ? path.join(baseDir, 'static', 'gallery') 
        : path.join(process.cwd(), baseDir, 'static', 'gallery');
    const thumbnailDir = path.isAbsolute(baseDir)
        ? path.join(baseDir, 'static', 'thumbnails')
        : path.join(process.cwd(), baseDir, 'static', 'thumbnails');
    
    console.log('[Sync] Base dir:', baseDir);
    console.log('[Sync] Gallery dir:', galleryDir);
    console.log('[Sync] Exists:', fs.existsSync(galleryDir));
    
    // 確保目錄存在
    if (!fs.existsSync(galleryDir)) {
        return res.status(200).json({ ok: false, error: 'Gallery folder not found: ' + galleryDir });
    }
    
    // 讀取資料庫中現有的檔名
    db.all(`SELECT id, filename FROM gallery_images`, (err, rows) => {
        const existingFiles = new Set(rows.map(r => r.filename));
        const dbRecords = rows; // 保留完整資料用於刪除判斷
        
        // 讀取資料夾中的檔案
        fs.readdir(galleryDir, (err, files) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
            const folderFiles = new Set(imageFiles);
            let added = 0;
            let removed = 0;
            let processed = 0;
            
            // 找出需要從資料庫刪除的（資料庫有但資料夾沒有）
            const orphans = dbRecords.filter(r => !folderFiles.has(r.filename));
            if (orphans.length > 0) {
                console.log('[Sync] Found ' + orphans.length + ' orphan records to remove');
                const orphanIds = orphans.map(o => o.id);
                const placeholders = orphanIds.map(() => '?').join(',');
                db.run(`DELETE FROM gallery_images WHERE id IN (${placeholders})`, orphanIds, function(err) {
                    if (!err) {
                        removed = this.changes;
                        console.log('[Sync] Removed ' + removed + ' orphan records');
                    }
                });
            }
            
            if (imageFiles.length === 0) {
                return res.json({ ok: true, added: 0, removed, message: 'No images found in folder' });
            }
            
            imageFiles.forEach(filename => {
                if (existingFiles.has(filename)) {
                    processed++;
                    if (processed === imageFiles.length) {
                        res.json({ ok: true, added, removed });
                    }
                    return;
                }
                
                const filePath = path.join(galleryDir, filename);
                const stats = fs.statSync(filePath);
                const thumbnailFilename = `thumb_${filename}`;
                
                db.run(`INSERT INTO gallery_images (filename, title, category, thumbnail_url, full_url, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [filename, filename, 'other',
                     `/thumbnails/${thumbnailFilename}`, `/gallery/${filename}`,
                     0, 0, stats.size, Date.now()],
                    (err) => {
                        processed++;
                        if (!err) added++;
                        if (processed === imageFiles.length) {
                            res.json({ ok: true, added, removed });
                        }
                    });
            });
        });
    });
});

// 重新命名資料夾中的圖片（解決中文檔名亂碼問題）
app.post('/api/admin/gallery/rename', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    const baseDir = __dirname || '.';
    const galleryDir = path.isAbsolute(baseDir) 
        ? path.join(baseDir, 'static', 'gallery') 
        : path.join(process.cwd(), baseDir, 'static', 'gallery');
    const thumbnailDir = path.isAbsolute(baseDir)
        ? path.join(baseDir, 'static', 'thumbnails')
        : path.join(process.cwd(), baseDir, 'static', 'thumbnails');
    
    console.log('[Rename] Gallery dir:', galleryDir);
    console.log('[Rename] Exists:', fs.existsSync(galleryDir));
    
    if (!fs.existsSync(galleryDir)) {
        return res.status(400).json({ error: 'Gallery folder not found: ' + galleryDir });
    }
    
    // 讀取所有檔案
    fs.readdir(galleryDir, (err, files) => {
        if (err) {
            console.error('[Rename] Read dir error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        console.log('[Rename] Found files:', imageFiles.length, imageFiles);
        
        if (imageFiles.length === 0) {
            return res.json({ ok: true, renamed: 0, message: 'No images found' });
        }
        
        let renamed = 0;
        let processed = 0;
        let hasError = false;
        
        imageFiles.forEach((oldName, index) => {
            // 跳過已經是正確格式的檔案
            if (/^gallery-\d{3,}\.(jpg|jpeg|png|gif|webp)$/i.test(oldName)) {
                processed++;
                if (processed === imageFiles.length) {
                    res.json({ ok: true, renamed, total: imageFiles.length });
                }
                return;
            }
            
            const ext = path.extname(oldName);
            const newName = `gallery-${String(index + 1).padStart(3, '0')}${ext}`;
            const oldPath = path.join(galleryDir, oldName);
            const newPath = path.join(galleryDir, newName);
            const oldThumb = path.join(thumbnailDir, `thumb_${oldName}`);
            const newThumb = path.join(thumbnailDir, `thumb_${newName}`);
            
            console.log(`[Rename] ${oldName} -> ${newName}`);
            
            // 檢查檔案是否存在
            if (!fs.existsSync(oldPath)) {
                console.error('[Rename] File not found:', oldPath);
                processed++;
                if (processed === imageFiles.length) {
                    res.json({ ok: true, renamed, total: imageFiles.length, error: 'Some files not found' });
                }
                return;
            }
            
            // 重新命名檔案
            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error('[Rename] Rename error:', err);
                    hasError = true;
                    processed++;
                    return;
                }
                
                // 重新命名縮圖
                if (fs.existsSync(oldThumb)) {
                    fs.rename(oldThumb, newThumb, (err) => {
                        if (err) console.error('[Rename] Thumb rename error:', err);
                    });
                }
                
                // 更新資料庫
                db.run(`UPDATE gallery_images SET filename = ?, thumbnail_url = ?, full_url = ? WHERE filename = ?`,
                    [newName, `/thumbnails/thumb_${newName}`, `/gallery/${newName}`, oldName],
                    (err) => {
                        if (!err) renamed++;
                        processed++;
                        if (processed === imageFiles.length) {
                            console.log(`[Rename] Complete. Renamed: ${renamed}/${imageFiles.length}`);
                            res.json({ ok: true, renamed, total: imageFiles.length, hadErrors: hasError });
                        }
                    });
            });
        });
    });
});

// 刪除圖片（同時刪除實體檔案）
app.delete('/api/admin/gallery/:id', (req, res) => {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    const baseDir = __dirname || '.';
    const galleryDir = path.isAbsolute(baseDir) 
        ? path.join(baseDir, 'static', 'gallery') 
        : path.join(process.cwd(), baseDir, 'static', 'gallery');
    const thumbnailDir = path.isAbsolute(baseDir)
        ? path.join(baseDir, 'static', 'thumbnails')
        : path.join(process.cwd(), baseDir, 'static', 'thumbnails');
    
    db.get(`SELECT * FROM gallery_images WHERE id = ?`, [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // 刪除實體檔案
        const fullPath = path.join(galleryDir, row.filename);
        const thumbPath = path.join(thumbnailDir, `thumb_${row.filename}`);
        
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        
        // 刪除資料庫記錄
        db.run(`DELETE FROM gallery_images WHERE id = ?`, [id], (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ ok: true });
        });
    });
});

// 批量刪除圖片（同時刪除實體檔案）
app.post('/api/admin/gallery/batch-delete', (req, res) => {
    const { ids } = req.body;
    const fs = require('fs');
    const path = require('path');
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array required' });
    }
    
    const baseDir = __dirname || '.';
    const galleryDir = path.isAbsolute(baseDir) 
        ? path.join(baseDir, 'static', 'gallery') 
        : path.join(process.cwd(), baseDir, 'static', 'gallery');
    const thumbnailDir = path.isAbsolute(baseDir)
        ? path.join(baseDir, 'static', 'thumbnails')
        : path.join(process.cwd(), baseDir, 'static', 'thumbnails');
    
    // 先取得所有要刪除的檔案名稱
    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT * FROM gallery_images WHERE id IN (${placeholders})`, ids, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        // 刪除實體檔案
        rows.forEach(row => {
            const fullPath = path.join(galleryDir, row.filename);
            const thumbPath = path.join(thumbnailDir, `thumb_${row.filename}`);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        });
        
        // 刪除資料庫記錄
        db.run(`DELETE FROM gallery_images WHERE id IN (${placeholders})`, ids, function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ ok: true, deleted: this.changes });
        });
    });
});

// 取得所有圖片（可依分類篩選）
app.get('/api/admin/gallery', (req, res) => {
    const { category } = req.query;
    
    let sql = `SELECT * FROM gallery_images`;
    let params = [];
    
    if (category && category !== 'all') {
        sql += ` WHERE category = ?`;
        params.push(category);
    }
    
    sql += ` ORDER BY created_at DESC`;
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ images: rows });
    });
});

// 批量更新分類
app.post('/api/admin/gallery/batch-update-category', (req, res) => {
    const { ids, category } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array required' });
    }
    
    if (!category) {
        return res.status(400).json({ error: 'category required' });
    }
    
    const placeholders = ids.map(() => '?').join(',');
    db.run(`UPDATE gallery_images SET category = ? WHERE id IN (${placeholders})`, [category, ...ids], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ ok: true, updated: this.changes });
    });
});

// 從檔案名稱修復分類
app.post('/api/admin/gallery/fix-categories', (req, res) => {
    const validCategories = ['nature', 'anime', 'girl', 'abstract', 'other'];
    
    db.all(`SELECT id, filename FROM gallery_images`, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        let fixed = 0;
        let errors = 0;
        
        rows.forEach(row => {
            const match = row.filename.match(/^(\w+)_(\d+)\.(.+)$/i);
            if (match) {
                const cat = match[1].toLowerCase();
                if (validCategories.includes(cat)) {
                    db.run(`UPDATE gallery_images SET category = ? WHERE id = ?`, [cat, row.id], (err) => {
                        if (!err) fixed++;
                        else errors++;
                    });
                }
            }
        });
        
        setTimeout(() => {
            res.json({ ok: true, fixed, errors, message: `已修復 ${fixed} 筆記錄` });
        }, 500);
    });
});

app.get('/api/gallery', (req, res) => {
    const { category, page = 1, limit = 500 } = req.query;
    const offset = (page - 1) * limit;
    
    let sql = `SELECT * FROM gallery_images`;
    let countSql = `SELECT COUNT(*) as total FROM gallery_images`;
    const params = [];
    
    if (category) {
        sql += ` WHERE category = ?`;
        countSql += ` WHERE category = ?`;
        params.push(category);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    db.get(countSql, category ? [category] : [], (err, countResult) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            res.json({
                images: rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.total,
                    total_pages: Math.ceil(countResult.total / parseInt(limit))
                }
            });
        });
    });
});

app.get('/api/gallery/categories', (req, res) => {
    db.all(`SELECT category, COUNT(*) as count FROM gallery_images GROUP BY category`, (err, rows) => {
        res.json({ categories: rows });
    });
});

app.get('/api/gallery/:id', (req, res) => {
    db.get(`SELECT * FROM gallery_images WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Image not found' });
        }
        db.run(`UPDATE gallery_images SET downloads = downloads + 1 WHERE id = ?`, [req.params.id]);
        res.json({ image: row });
    });
});

// 上傳圖片
const galleryUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, './static/gallery'),
        filename: (req, file, cb) => cb(null, `temp_${Date.now()}_${file.originalname}`)
    })
});

// 取得分類的最大編號
function getMaxCategoryNumber(category, extension, callback) {
    const pattern = `${category}_\\d+\\.${extension.replace('.', '')}`;
    db.all(`SELECT filename FROM gallery_images WHERE category = ?`, [category], (err, rows) => {
        if (err || rows.length === 0) {
            return callback(0);
        }
        
        let maxNum = 0;
        const ext = extension.replace('.', '').toLowerCase();
        rows.forEach(row => {
            const match = row.filename.match(new RegExp(`^${category}_(\\d+)\\.${ext}$`, 'i'));
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });
        callback(maxNum);
    });
}

app.post('/api/admin/gallery/upload', galleryUpload.array('images'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { title, category } = req.body;
    const cat = category || 'other';
    const results = [];
    
    // 先取得目前分類的最大編號（只查詢一次）
    const maxInfo = await new Promise((resolve) => {
        db.all(`SELECT filename FROM gallery_images WHERE category = ?`, [cat], (err, rows) => {
            let maxNum = 0;
            if (!err && rows.length > 0) {
                rows.forEach(row => {
                    const match = row.filename.match(/^(\w+)_(\d+)\.(.+)$/i);
                    if (match) {
                        const num = parseInt(match[2], 10);
                        if (num > maxNum) maxNum = num;
                    }
                });
            }
            resolve(maxNum);
        });
    });
    
    let nextNum = maxInfo + 1;
    
    for (const file of req.files) {
        const originalFilename = file.originalname;
        const ext = path.extname(originalFilename) || '.jpg';
        
        // 使用預先取得的編號並遞增
        const newNum = nextNum++;
        const newFilename = `${cat}_${String(newNum).padStart(3, '0')}${ext}`;
        const thumbnailFilename = `thumb_${newFilename}`;
        const oldPath = file.path;
        const newPath = path.join('./static/gallery', newFilename);
        
        try {
            // 重新命名檔案
            fs.renameSync(oldPath, newPath);
            
            // 產生縮圖
            await sharp(newPath)
                .resize(300, null, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toFile(`./static/thumbnails/${thumbnailFilename}`);
            
            const imageTitle = title || newFilename;
            db.run(`INSERT INTO gallery_images (filename, title, category, thumbnail_url, full_url, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [newFilename, imageTitle, cat,
                 `/thumbnails/${thumbnailFilename}`, `/gallery/${newFilename}`,
                 0, 0, file.size, Date.now()]);
            
            results.push({ ok: true, filename: newFilename, thumbnail: thumbnailFilename });
        } catch (err) {
            console.error('Upload processing failed:', err);
            // 清理 temp 檔案
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            results.push({ ok: false, filename: originalFilename, error: err.message });
        }
    }
    
    res.json({ 
        ok: true, 
        count: req.files.length,
        results: results
    });
});

// ==================== Punctuation API ====================

// 呼叫 Python 標點服務
function callPythonPunctService(text, lang) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ text, lang });
        
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: '/punct',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 30000
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.write(postData);
        req.end();
    });
}

// 語言偵測 - ASCII safe
function detectLanguage(text) {
    var chineseCount = 0;
    for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if (code >= 0x4e00 && code <= 0x9fff) {
            chineseCount++;
        }
    }
    var ratio = chineseCount / text.length;
    return ratio > 0.3 ? 'zh' : 'en';
}

// 中文標點規則（本地 fallback）- ASCII safe
function addChinesePunctuation(text) {
    let cleaned = text.replace(/[\u3001\u3002\uFF1F\uFF01\uFF1B\uFF1A\u201C\u201D\u2018\u2019\u300A\u300B]/g, '');
    cleaned = cleaned.trim();
    if (!cleaned) return text;
    
    // Question detection
    var qChars = '\u55CE\u5427\u5462\u554A\u54E6\u5462';
    var hasQChar = false;
    for (var i = 0; i < qChars.length; i++) {
        if (cleaned.endsWith(qChars[i])) { hasQChar = true; break; }
    }
    var qStarts = ['\u4EC0\u9EBD','\u54EA','\u8AB0','\u600E\u9EAB','\u70BA\u4EC0\u9EAB','\u591A\u5C11','\u51E0','\u662F\u5426','\u6709\u6C92\u6709','\u662F\u4E0D\u662F','\u80FD\u4E0D\u80FD','\u8981\u4E0D\u8981'];
    var startsWithQ = qStarts.some(function(q) { return cleaned.startsWith(q); });
    var isQuestion = hasQChar || startsWithQ;
    
    // Add commas after common subjects/verbs
    // Pattern: subject/object + verb -> add comma after
    var result = cleaned;
    
    // Common transitions that suggest a new clause
    var transitions = [
        { pattern: /([\u6211\u4F60\u4ED6\u5979\u5B83\u5BB6\u4EBA])([\u7684])?([\u60F3\u8981\u53EF\u4EE5\u6703])/g, replacement: '$1$2$3，' },
        { pattern: /([\u6211\u4F60\u4ED6\u5979\u5B83])([\u60F3\u8981\u53EF\u4EE5\u6703])/g, replacement: '$1，$2' },
        { pattern: /([\u5929\u6C23\u65E5\u5B50\u4E8B\u60C5)([\u5F88\u771F\u7684])([\u597D\u58FA\u71B1])/g, replacement: '$1$2，$3' },
        { pattern: /([\u597D\u8B58\u4E0D\u932F\u53EF\u60DC])([\u4E46\u54E6\u55B2\u5440])/g, replacement: '$1$2，' }
    ];
    
    for (var t = 0; t < transitions.length; t++) {
        result = result.replace(transitions[t].pattern, transitions[t].replacement);
    }
    
    // Fallback: simple comma after 6+ char phrases if no comma exists
    if (result.indexOf('，') === -1 && result.length > 8) {
        // Insert comma in the middle
        var mid = Math.floor(result.length / 2);
        // Find a good break point (after common particles)
        var breakChars = '\u7684\u5728\u662F\u6709\u80FD\u8981\u60F3\u53EF';
        for (var j = mid; j > 2; j--) {
            if (breakChars.indexOf(result.charAt(j)) !== -1) {
                result = result.substring(0, j + 1) + '，' + result.substring(j + 1);
                break;
            }
        }
    }
    
    // Add ending punctuation
    if (!/[\u3002\uFF1F\uFF01]$/.test(result)) {
        result += isQuestion ? '\uFF1F' : '\u3002';
    }
    
    return result;
}

// 簡單英文標點
function addSimplePunctuation(text) {
    let result = text.trim();
    if (!/[.!?]$/.test(result)) {
        result += '.';
    }
    result = result.charAt(0).toUpperCase() + result.slice(1);
    return result;
}

// 智慧標點還原 API
app.post('/api/punctuation/restore', async (req, res) => {
    try {
        const { text, lang, deviceId } = req.body;
        
        // Debug: log raw body
        console.log('Received body:', JSON.stringify(req.body));
        console.log('Received text:', text);
        console.log('Device ID:', deviceId);
        
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'text is required', received: text });
        }
        
        const detectedLang = lang || detectLanguage(text);
        console.log('Detected lang:', detectedLang);
        let result;
        
        if (detectedLang === 'zh') {
            try {
                const punctResult = await callPythonPunctService(text, detectedLang);
                result = punctResult.result;
                recordPunctCall(true, deviceId);
            } catch (e) {
                console.error('Python punct service error:', e.message);
                result = addChinesePunctuation(text);
                recordPunctCall(false, deviceId);
            }
        } else {
            result = addSimplePunctuation(text);
            recordPunctCall(true, deviceId);
        }
        
        res.json({ 
            original: text, 
            result: result,
            lang: detectedLang
        });
    } catch (err) {
        console.error('Punctuation error:', err);
        recordPunctCall(false);
        res.status(500).json({ error: err.message });
    }
});

// ==================== Stats API ====================

app.get('/api/stats', (req, res) => {
    const stats = {};
    
    db.get(`SELECT COUNT(*) as count FROM installs`, (err, row) => {
        stats.total_installs = row.count;
        
        db.get(`SELECT COUNT(*) as count FROM installs WHERE last_active > ?`, [Date.now() - 24*60*60*1000], (err, row) => {
            stats.active_today = row.count;
            
            db.get(`SELECT COUNT(*) as count FROM gallery_images`, (err, row) => {
                stats.total_images = row.count;
                
                db.get(`SELECT version, version_code FROM versions ORDER BY version_code DESC LIMIT 1`, (err, row) => {
                    stats.latest_version = row;
                    
                    // 加入 VoiceIME 標點統計
                    stats.voiceime_punct = {
                        total_calls: punctStats.total_calls,
                        success_calls: punctStats.success_calls,
                        failed_calls: punctStats.failed_calls,
                        last_call: punctStats.last_call,
                        unique_devices: punctStats.unique_devices.size
                    };
                    
                    res.json(stats);
                });
            });
        });
    });
});

// ==================== 靜態檔案 ====================
app.use('/apk', express.static('./static/apk'));
app.use('/gallery', express.static('./static/gallery'));
app.use('/thumbnails', express.static('./static/thumbnails'));

// ==================== 啟動 ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Auto Wallpaper Backend (Simple - No FCM)             ║
╠═══════════════════════════════════════════════════════════╣
║  📊 Stats:      http://localhost:${PORT}/api/stats           ║
║  🖼️  Gallery:   http://localhost:${PORT}/api/gallery        ║
║  📦 Version:    http://localhost:${PORT}/api/version/check  ║
║  ✏️  Punct:    http://localhost:${PORT}/api/punctuation/restore  ║
║  🔧 Admin:     http://localhost:${PORT}/api/admin/*       ║
║                                                           ║
║  ⚠️  需要單獨啟動 Python 標點服務:                          ║
║     python punctuation_service.py                         ║
╚═══════════════════════════════════════════════════════════╝
    `);
});
