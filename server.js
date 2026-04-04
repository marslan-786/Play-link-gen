const express = require('express');
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST_URL || `https://play-link-gen-production.up.railway.app`; 

// ویڈیوز محفوظ کرنے کے لیے فولڈر بنائیں
const VIDEOS_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR);
}

// کیشنگ کے لیے میموری ابجیکٹ
// سٹرکچر: { "video_url_resolution": { fileName, title, resolution, timestamp } }
const urlCache = {}; 

app.get('/api/download', async (req, res) => {
    const { url, resolution } = req.query;
    const resValue = resolution || '360';

    if (!url) {
        return res.status(400).json({ success: false, message: "URL is required" });
    }

    // 1. کیشے چیک کریں (Cache Check)
    const cacheKey = `${url}_${resValue}`;
    if (urlCache[cacheKey]) {
        const cachedData = urlCache[cacheKey];
        const filePath = path.join(VIDEOS_DIR, cachedData.fileName);
        
        // چیک کریں کہ کیا فائل واقعی ہارڈ ڈرائیو پر موجود ہے اور 2 گھنٹے سے پرانی تو نہیں
        const isFileExists = fs.existsSync(filePath);
        const isNotExpired = (Date.now() - cachedData.timestamp) < (2 * 60 * 60 * 1000);

        if (isFileExists && isNotExpired) {
            console.log(`Served from Cache: ${cachedData.title}`);
            return res.json({
                success: true,
                title: cachedData.title,
                resolution: cachedData.resolution,
                download_url: `${HOST}/play/${cachedData.fileName}`,
                is_cached: true // یہ بتانے کے لیے کہ رسپانس کیشے سے آیا ہے
            });
        } else {
            // اگر فائل ڈیلیٹ ہو چکی ہے یا ایکسپائر ہو گئی ہے تو کیشے سے نکال دیں
            delete urlCache[cacheKey];
        }
    }

    // 2. اگر کیشے میں نہیں ہے تو ڈاؤن لوڈ کریں
    try {
        const originalApiUrl = `https://silent-yt-dwn.up.railway.app/api/download?url=${encodeURIComponent(url)}&resolution=${resValue}`;
        const response = await axios.get(originalApiUrl);
        const data = response.data;

        if (!data.success) {
            return res.json(data);
        }

        const fileName = `video_${Date.now()}.mp4`;
        const filePath = path.join(VIDEOS_DIR, fileName);

        console.log(`Downloading new video: ${data.title}...`);

        const ffmpegCommand = `ffmpeg -i "${data.download_url}" -c copy -movflags faststart "${filePath}"`;

        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`[FFmpeg Error] Processing failed for: ${data.title}`);
                return res.status(500).json({ success: false, message: "Error processing video with FFmpeg" });
            }
            
            console.log(`Download complete: ${fileName}`);

            // 3. کیشے میں محفوظ کریں (Save to Cache)
            urlCache[cacheKey] = {
                fileName: fileName,
                title: data.title,
                resolution: data.resolution,
                timestamp: Date.now()
            };

            const playUrl = `${HOST}/play/${fileName}`;
            
            res.json({
                success: true,
                title: data.title,
                resolution: data.resolution,
                download_url: playUrl,
                is_cached: false
            });
        });

    } catch (error) {
        // 4. کلین ایرر ہینڈلنگ (Clean Error Handling)
        if (error.response) {
            // جب پیچھے والی API (Original API) 500 یا کوئی اور ایرر دے
            console.error(`[Original API Error] Status: ${error.response.status} - Target URL: ${url}`);
            return res.status(error.response.status).json({ 
                success: false, 
                message: `Original API returned error: ${error.response.status}`,
            });
        } else if (error.request) {
            // جب پیچھے والی API رسپانس ہی نہ دے (Timeout/Offline)
            console.error(`[Network Error] Original API is unreachable.`);
            return res.status(503).json({ success: false, message: "Original API is offline or unreachable." });
        } else {
            // کوئی اور انٹرنل ایرر
            console.error(`[Internal Error] ${error.message}`);
            return res.status(500).json({ success: false, message: "Internal Server Error" });
        }
    }
});

// ویڈیو پلے کرنے کا روٹ
app.use('/play', express.static(VIDEOS_DIR, {
    setHeaders: function (res, path, stat) {
        res.set('Content-Disposition', 'inline'); 
        res.set('Content-Type', 'video/mp4');
    }
}));

// آٹو کلین اپ (ہر 1 گھنٹے بعد چلے گا)
setInterval(() => {
    const now = Date.now();
    
    // 1. پرانی ویڈیوز ڈیلیٹ کریں
    fs.readdir(VIDEOS_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(VIDEOS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                // 2 گھنٹے (2 * 60 * 60 * 1000 ms) سے پرانی فائلز
                if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => console.log(`Deleted expired file: ${file}`));
                }
            });
        });
    });

    // 2. پرانے لنکس کو RAM کیشے سے بھی نکالیں تاکہ میموری فل نہ ہو
    for (const key in urlCache) {
        if (now - urlCache[key].timestamp > 2 * 60 * 60 * 1000) {
            delete urlCache[key];
        }
    }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});