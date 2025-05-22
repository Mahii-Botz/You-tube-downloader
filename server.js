const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper function to format duration
function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper function to format view count
function formatViews(views) {
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M`;
    } else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K`;
    }
    return views.toString();
}

// Helper function to sanitize filename
function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]/g, '').trim();
}

// Route to get video information
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Get video info
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;

        const videoInfo = {
            title: videoDetails.title,
            duration: formatDuration(parseInt(videoDetails.lengthSeconds)),
            views: formatViews(parseInt(videoDetails.viewCount)),
            author: videoDetails.author.name,
            thumbnail: videoDetails.thumbnails[0]?.url,
            description: videoDetails.shortDescription?.slice(0, 200) + '...',
            uploadDate: videoDetails.uploadDate
        };

        res.json(videoInfo);

    } catch (error) {
        console.error('Error getting video info:', error);
        res.status(500).json({ 
            error: 'Failed to get video information',
            details: error.message 
        });
    }
});

// Route to download video
app.post('/api/download', async (req, res) => {
    try {
        const { url, quality = 'highest' } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Get video info for filename
        const info = await ytdl.getInfo(url);
        const videoDetails = info.videoDetails;
        
        // Determine format based on quality selection
        let format;
        let fileExt = 'mp4';
        
        switch (quality) {
            case 'highest':
                format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
                break;
            case 'lowest':
                format = ytdl.chooseFormat(info.formats, { quality: 'lowest' });
                break;
            case 'highestaudio':
                format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
                fileExt = 'mp3';
                break;
            case 'lowestaudio':
                format = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio' });
                fileExt = 'mp3';
                break;
            default:
                format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
        }

        // Create safe filename
        const safeTitle = sanitizeFilename(videoDetails.title);
        const filename = `${safeTitle}.${fileExt}`;

        // Set response headers
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', format.mimeType || 'video/mp4');

        // Create download stream
        const videoStream = ytdl(url, {
            format: format,
            quality: quality === 'highestaudio' || quality === 'lowestaudio' ? undefined : quality
        });

        // Handle stream events
        videoStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed', details: error.message });
            }
        });

        videoStream.on('progress', (chunkLength, downloaded, total) => {
            const percent = (downloaded / total) * 100;
            console.log(`Download progress: ${percent.toFixed(2)}%`);
        });

        // Pipe the video stream to response
        videoStream.pipe(res);

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Download failed',
                details: error.message 
            });
        }
    }
});

// Route to get available formats
app.post('/api/formats', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(url);
        const formats = info.formats.map(format => ({
            itag: format.itag,
            quality: format.qualityLabel,
            container: format.container,
            hasVideo: format.hasVideo,
            hasAudio: format.hasAudio,
            contentLength: format.contentLength,
            mimeType: format.mimeType
        }));

        res.json({ formats });

    } catch (error) {
        console.error('Error getting formats:', error);
        res.status(500).json({ 
            error: 'Failed to get video formats',
            details: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'YouTube Downloader API is running',
        timestamp: new Date().toISOString()
    });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 YouTube Downloader server running on port ${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API: http://localhost:${PORT}/api`);
});

module.exports = app;