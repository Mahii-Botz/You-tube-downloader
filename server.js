const express = require('express');
const ytdl = require('ytdl-core');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve the single HTML file directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Download endpoint
app.get('/download', async (req, res) => {
  const { url, type } = req.query;

  if (!ytdl.validateURL(url)) return res.status(400).send('Invalid YouTube URL');

  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');

  if (type === 'audio') {
    res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
    ytdl(url, { filter: 'audioonly', quality: 'highestaudio' }).pipe(res);
  } else {
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    ytdl(url, { quality: 'highestvideo' }).pipe(res);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
