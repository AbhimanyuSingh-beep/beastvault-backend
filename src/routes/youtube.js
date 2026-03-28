const express = require('express');
const { google } = require('googleapis');
const { query } = require('../db/pool'); // Added DB connection
const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'https://beastvault-backend.onrender.com/api/youtube/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube'
];

// Auto-create table in Neon DB to store your token forever
query(`
  CREATE TABLE IF NOT EXISTS youtube_tokens (
    id SERIAL PRIMARY KEY,
    tokens JSONB NOT NULL
  )
`).catch(err => console.error('DB Table Init Error:', err));

// Helpers to get/save tokens from the DB instead of RAM
async function getTokens() {
  try {
    const { rows } = await query('SELECT tokens FROM youtube_tokens LIMIT 1');
    return rows[0] ? rows[0].tokens : null;
  } catch(e) {
    return null;
  }
}

async function saveTokens(tokens) {
  await query('DELETE FROM youtube_tokens'); // Keep only latest login
  await query('INSERT INTO youtube_tokens (tokens) VALUES ($1)', [tokens]);
}

// GET /api/youtube/auth
router.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

// GET /api/youtube/callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received.');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await saveTokens(tokens); // Save permanently to Database
    oauth2Client.setCredentials(tokens);
    console.log('YouTube tokens stored permanently in database.');
    res.send(`
      <html>
      <head><title>YouTube Connected</title></head>
      <body style="font-family:sans-serif;background:#080808;color:#f8fafc;text-align:center;padding:80px 20px;">
        <div style="font-size:64px;margin-bottom:20px;">✅</div>
        <h2 style="color:#10b981;font-size:28px;margin-bottom:8px;">YouTube Connected!</h2>
        <p style="color:#a0aec0;">Connection is now permanently saved. You can close this tab.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage('youtube-connected', '*');
            setTimeout(() => window.close(), 2000);
          }
        </script>
      </body></html>
    `);
  } catch (err) {
    console.error('YouTube auth error:', err.message);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// GET /api/youtube/status
router.get('/status', async (req, res) => {
  const tokens = await getTokens();
  res.json({ connected: !!tokens });
});

// POST /api/youtube/disconnect
router.post('/disconnect', async (req, res) => {
  await query('DELETE FROM youtube_tokens');
  res.json({ ok: true });
});

// GET /api/youtube/search?q=query&maxResults=12
router.get('/search', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) {
    return res.status(401).json({ error: 'YouTube not connected.' });
  }
  const q = req.query.q || 'trending';
  const maxResults = parseInt(req.query.maxResults) || 12;
  const type = req.query.type || 'video';

  try {
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await youtube.search.list({
      part: ['snippet'],
      q: q,
      type: ['video'],
      maxResults,
      videoEmbeddable: 'true',
      ...(type === 'short' ? { videoDuration: 'short' } : {})
    });

    const videos = response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      publishedAt: item.snippet.publishedAt,
      description: item.snippet.description
    }));

    res.json({ videos, query: q });
  } catch (err) {
    console.error('YouTube search error:', err.message);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// GET /api/youtube/trending
router.get('/trending', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) {
    return res.status(401).json({ error: 'YouTube not connected.' });
  }
  try {
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await youtube.videos.list({
      part: ['snippet', 'statistics'],
      chart: 'mostPopular',
      regionCode: 'IN',
      maxResults: 12
    });

    const videos = response.data.items.map(item => ({
      videoId: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url,
      views: parseInt(item.statistics?.viewCount || 0),
      publishedAt: item.snippet.publishedAt
    }));

    res.json({ videos });
  } catch (err) {
    console.error('YouTube trending error:', err.message);
    res.status(500).json({ error: 'Trending failed: ' + err.message });
  }
});

// POST /api/youtube/upload
router.post('/upload', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) {
    return res.status(401).json({ error: 'YouTube not connected.' });
  }
  const { videoUrl, title, description, tags, privacyStatus } = req.body;
  if (!videoUrl || !title) {
    return res.status(400).json({ error: 'videoUrl and title are required' });
  }
  try {
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const https = require('https');
    const http  = require('http');
    const protocol = videoUrl.startsWith('https') ? https : http;

    const videoStream = await new Promise((resolve, reject) => {
      protocol.get(videoUrl, (res) => resolve(res)).on('error', reject);
    });

    console.log(`Uploading "${title}" to YouTube...`);

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.substring(0, 100),
          description: description || '',
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          categoryId: '22', // Film & Animation
        },
        status: {
          privacyStatus: privacyStatus || 'public',
          selfDeclaredMadeForKids: false,
        }
      },
      media: { body: videoStream }
    });

    const videoId = response.data.id;
    console.log(`YouTube upload done! ID: ${videoId}`);
    res.json({ success: true, videoId, url: `https://www.youtube.com/shorts/${videoId}` });

  } catch (err) {
    console.error('YouTube upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;