const express = require('express');
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8080;
// اگر ریلوے (Railway) وغیرہ پر ہوسٹ کریں تو وہاں کی ڈومین کا ویری ایبل یہاں آئے گا
const HOST = process.env.HOST_URL || `https://play-link-gen-production.up.railway.app:${PORT}`; 

// ویڈیوز محفوظ کرنے کے لیے فولڈر بنائیں
const VIDEOS_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR);
}

app.get('/api/download', async (req, res) => {
    const { url, resolution } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "URL is required" });
    }

    try {
        // 1. اوریجنل API کو کال کریں
        const originalApiUrl = `https://silent-yt-dwn.up.railway.app/api/download?url=${encodeURIComponent(url)}&resolution=${resolution || '360'}`;
        const response = await axios.get(originalApiUrl);
        const data = response.data;

        // اگر اوریجنل API سے ایرر آئے
        if (!data.success) {
            return res.json(data);
        }

        // 2. ویڈیو کے لیے ایک منفرد نام بنائیں
        const fileName = `video_${Date.now()}.mp4`;
        const filePath = path.join(VIDEOS_DIR, fileName);

        console.log(`Downloading and processing: ${data.title}...`);

        // 3. FFmpeg کمانڈ: ویڈیو ڈاؤن لوڈ کرے گی اور moov atom کو شروع میں رکھے گی
        const ffmpegCommand = `ffmpeg -i "${data.download_url}" -c copy -movflags faststart "${filePath}"`;

        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error("FFmpeg error:", error);
                return res.status(500).json({ success: false, message: "Error processing video with FFmpeg" });
            }
            
            console.log(`Processing complete: ${fileName}`);

            // 4. آپ کی ڈیمانڈ کے مطابق بالکل سیم JSON رسپانس، بس لنک ہمارا اپنا ہوگا
            const playUrl = `${HOST}/play/${fileName}`;
            
            res.json({
                success: true,
                title: data.title,
                resolution: data.resolution,
                download_url: playUrl
            });
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// یہ روٹ ویڈیو کو پلے (Stream) کروانے کے لیے ہے۔ Express خود بخود Range Headers ہینڈل کرتا ہے۔
app.use('/play', express.static(VIDEOS_DIR, {
    setHeaders: function (res, path, stat) {
        res.set('Content-Disposition', 'inline'); // ڈاؤن لوڈ کے بجائے پلے کروائے گا
        res.set('Content-Type', 'video/mp4');
    }
}));

// سرور کو کریش ہونے سے بچانے کے لیے آٹو کلین اپ (ہر 1 گھنٹے بعد چلے گا)
setInterval(() => {
    fs.readdir(VIDEOS_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(VIDEOS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                // اگر فائل 2 گھنٹے سے زیادہ پرانی ہے تو اسے ڈیلیٹ کر دیں
                if (now - stats.mtimeMs > 2 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => console.log(`Deleted old file: ${file}`));
                }
            });
        });
    });
}, 60 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
