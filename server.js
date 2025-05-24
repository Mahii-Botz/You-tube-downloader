const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost',
        'http://127.0.0.1',
        // Add your domain here when deploying
    ],
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from current directory (where index.html is)
app.use(express.static(path.join(__dirname)));

// Helper function to format duration
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
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
    if (!views || isNaN(views)) return '0';
    
    const num = parseInt(views);
    if (num >= 1000000000) {
        return `${(num / 1000000000).toFixed(1)}B`;
    } else if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
}

// Helper function to sanitize filename
function sanitizeFilename(filename) {
    if (!filename) return 'video';
    return filename
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100); // Limit length
}

// Helper function to validate YouTube URL
function validateYouTubeURL(url) {
    if (!url || typeof url !== 'string') return false;
    
    const patterns = [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
        /^https?:\/\/(www\.)?youtu\.be\/[\w-]{11}/,
        /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}/,
        /^https?:\/\/(www\.)?youtube\.com\/v\/[\w-]{11}/
    ];
    
    return patterns.some(pattern => pattern.test(url));
}

// Execute command with promise
const execAsync = promisify(exec);

// Check if yt-dlp is installed and install if needed
async function ensureYtDlp() {
    try {
        await execAsync('yt-dlp --version');
        console.log('✅ yt-dlp is available');
        return true;
    } catch (error) {
        console.log('❌ yt-dlp not found. Please install it:');
        console.log('   pip install yt-dlp');
        console.log('   or');
        console.log('   brew install yt-dlp (on macOS)');
        console.log('   or download from: https://github.com/yt-dlp/yt-dlp');
        return false;
    }
}

// Route to get video information
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate YouTube URL
        if (!validateYouTubeURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        console.log(`📋 Getting info for: ${url}`);

        // Use yt-dlp to get video information
        const command = `yt-dlp --dump-json --no-download "${url}"`;
        
        const { stdout, stderr } = await execAsync(command, {
            timeout: 30000 // 30 second timeout
        });

        if (stderr && !stdout) {
            throw new Error(`Failed to get video info: ${stderr}`);
        }

        const videoData = JSON.parse(stdout);

        const videoInfo = {
            title: videoData.title || 'Unknown Title',
            duration: formatDuration(videoData.duration),
            views: formatViews(videoData.view_count),
            author: videoData.uploader || videoData.channel || 'Unknown Channel',
            thumbnail: videoData.thumbnail || '',
            description: (videoData.description || '').slice(0, 200) + '...',
            uploadDate: videoData.upload_date || '',
            formats: videoData.formats ? videoData.formats.length : 0
        };

        console.log(`✅ Got info for: ${videoInfo.title}`);
        res.json(videoInfo);

    } catch (error) {
        console.error('❌ Error getting video info:', error.message);
        res.status(500).json({ 
            error: 'Failed to get video information',
            details: error.message.includes('yt-dlp') ? 
                'yt-dlp is not installed. Please install it first.' : 
                error.message 
        });
    }
});

// Route to download video
app.post('/api/download', async (req, res) => {
    try {
        const { url, quality = 'best', format = 'mp4' } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Validate YouTube URL
        if (!validateYouTubeURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        console.log(`📥 Starting download: ${url} (${quality}, ${format})`);

        // Create downloads directory if it doesn't exist
        const downloadsDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        // Generate unique filename
        const timestamp = Date.now();
        const tempFile = path.join(downloadsDir, `temp_${timestamp}`);

        // Build yt-dlp command based on requirements
        let ytDlpCommand;
        let outputExt = format;

        if (format === 'mp3' || quality.includes('audio')) {
            // Audio only download
            ytDlpCommand = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${tempFile}.%(ext)s" "${url}"`;
            outputExt = 'mp3';
        } else {
            // Video download
            let qualityFlag = 'best';
            
            switch (quality) {
                case '2160p':
                case 'highest':
                    qualityFlag = 'best[height<=2160]';
                    break;
                case '1440p':
                    qualityFlag = 'best[height<=1440]';
                    break;
                case '1080p':
                    qualityFlag = 'best[height<=1080]';
                    break;
                case '720p':
                    qualityFlag = 'best[height<=720]';
                    break;
                case '480p':
                    qualityFlag = 'best[height<=480]';
                    break;
                case '360p':
                    qualityFlag = 'best[height<=360]';
                    break;
                case 'lowest':
                    qualityFlag = 'worst';
                    break;
                default:
                    qualityFlag = 'best';
            }

            if (format === 'webm') {
                ytDlpCommand = `yt-dlp -f "${qualityFlag}[ext=webm]" -o "${tempFile}.%(ext)s" "${url}"`;
            } else {
                ytDlpCommand = `yt-dlp -f "${qualityFlag}[ext=mp4]/best" -o "${tempFile}.%(ext)s" "${url}"`;
            }
        }

        // Execute download command
        console.log(`🚀 Executing: ${ytDlpCommand}`);
        
        const { stdout, stderr } = await execAsync(ytDlpCommand, {
            timeout: 300000 // 5 minute timeout
        });

        // Find the downloaded file
        const files = fs.readdirSync(downloadsDir).filter(file => 
            file.startsWith(`temp_${timestamp}`)
        );

        if (files.length === 0) {
            throw new Error('Download completed but file not found');
        }

        const downloadedFile = path.join(downloadsDir, files[0]);
        const actualExt = files[0].split('.').pop();
        
        // Get file info for response
        const stats = fs.statSync(downloadedFile);
        
        // Get video title for filename
        let videoTitle = 'video';
        try {
            const infoCommand = `yt-dlp --get-title "${url}"`;
            const { stdout: titleOutput } = await execAsync(infoCommand, { timeout: 10000 });
            videoTitle = sanitizeFilename(titleOutput.trim());
        } catch (titleError) {
            console.log('Could not get video title, using default');
        }

        const filename = `${videoTitle}.${actualExt}`;

        // Set response headers
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', getContentType(actualExt));
        res.setHeader('Content-Length', stats.size);

        console.log(`✅ Sending file: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // Stream file to response
        const fileStream = fs.createReadStream(downloadedFile);
        
        fileStream.on('error', (error) => {
            console.error('❌ File stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'File streaming failed' });
            }
        });

        fileStream.on('end', () => {
            console.log('✅ File streamed successfully');
            // Clean up downloaded file after a delay
            setTimeout(() => {
                try {
                    fs.unlinkSync(downloadedFile);
                    console.log('🗑️  Cleaned up temporary file');
                } catch (cleanupError) {
                    console.error('Warning: Could not clean up file:', cleanupError.message);
                }
            }, 5000);
        });

        fileStream.pipe(res);

    } catch (error) {
        console.error('❌ Download error:', error);
        
        if (!res.headersSent) {
            let errorMessage = error.message;
            
            if (error.message.includes('yt-dlp')) {
                errorMessage = 'yt-dlp is not installed. Please install it first.';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Download timed out. Please try again.';
            } else if (error.message.includes('unavailable')) {
                errorMessage = 'Video is unavailable or private.';
            }
            
            res.status(500).json({ 
                error: 'Download failed',
                details: errorMessage 
            });
        }
    }
});

// Helper function to get content type
function getContentType(extension) {
    const contentTypes = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'flac': 'audio/flac',
        'm4a': 'audio/mp4'
    };
    
    return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
}

// Route to get available formats
app.post('/api/formats', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!validateYouTubeURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        console.log(`📋 Getting formats for: ${url}`);

        const command = `yt-dlp -F "${url}"`;
        const { stdout } = await execAsync(command, { timeout: 30000 });

        // Parse format output (simplified)
        const lines = stdout.split('\n');
        const formats = [];
        
        for (const line of lines) {
            if (line.includes('mp4') || line.includes('webm') || line.includes('m4a')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    formats.push({
                        formatId: parts[0],
                        extension: parts[1],
                        quality: parts[2] || 'unknown'
                    });
                }
            }
        }

        res.json({ formats: formats.slice(0, 20) }); // Limit to 20 formats

    } catch (error) {
        console.error('❌ Error getting formats:', error);
        res.status(500).json({ 
            error: 'Failed to get video formats',
            details: error.message 
        });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const ytDlpAvailable = await ensureYtDlp();
    
    res.json({ 
        status: 'OK', 
        message: 'MAHII-MODZ YouTube Downloader API is running',
        timestamp: new Date().toISOString(),
        ytDlpAvailable
    });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Enhanced error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
    }
    
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    
    res.status(500).json({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📴 SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start server
app.listen(PORT, async () => {
    console.log('\n🚀 MAHII-MODZ YouTube Downloader Server');
    console.log('=====================================');
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API: http://localhost:${PORT}/api`);
    console.log(`💾 Downloads: ${path.join(__dirname, 'downloads')}`);
    
    // Check dependencies
    const ytDlpAvailable = await ensureYtDlp();
    if (!ytDlpAvailable) {
        console.log('\n⚠️  WARNING: yt-dlp is not installed!');
        console.log('   The downloader will not work without it.');
        console.log('   Install with: pip install yt-dlp');
    } else {
        console.log('✅ All dependencies are ready');
    }
    
    console.log('\n🎯 Server is ready to handle downloads!');
});

module.exports = app;
