const express = require('express');
const ytdl = require('ytdl-core');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the index.html file from root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Download endpoint with full error handling
app.get('/download', async (req, res) => {
  try {
    const { url, type } = req.query;

    if (!url || !type) {
      return res.status(400).send('Missing URL or type');
    }

    if (!ytdl.validateURL(url)) {
      return res.status(400).send('Invalid YouTube URL');
    }

    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50); // limit filename length

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${title}.${type === 'audio' ? 'mp3' : 'mp4'}"`
    );

    const downloadStream =
      type === 'audio'
        ? ytdl(url, { filter: 'audioonly', quality: 'highestaudio' })
        : ytdl(url, { quality: 'highestvideo' });

    // Handle stream errors
    downloadStream.on('error', (err) => {
      console.error('🚫 Stream error:', err.message);
      return res.status(500).send('Error during streaming.');
    });

    downloadStream.pipe(res);
  } catch (err) {
    console.error('🔥 Server error:', err.message);
    res.status(500).send('Something went wrong on the server.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
