const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'https://beastvault-backend.onrender.com/api/youtube/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
];

let storedTokens = null;

// GET /api/youtube/auth - start OAuth flow
router.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

// GET /api/youtube/callback - Google redirects here
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received from Google.');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    storedTokens = tokens;
    oauth2Client.setCredentials(tokens);
    console.log('YouTube tokens stored successfully.');
    res.send(`
      <html>
      <head><title>YouTube Connected</title></head>
      <body style="font-family:sans-serif;background:#080808;color:#f8fafc;text-align:center;padding:80px 20px;">
        <div style="font-size:64px;margin-bottom:20px;">✅</div>
        <h2 style="color:#10b981;font-size:28px;margin-bottom:8px;">YouTube Connected!</h2>
        <p style="color:#a0aec0;">You can close this tab and go back to BeastVault.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage('youtube-connected', '*');
            setTimeout(() => window.close(), 2000);
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('YouTube auth error:', err.message);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// GET /api/youtube/status
router.get('/status', (req, res) => {
  res.json({ connected: !!storedTokens });
});

// POST /api/youtube/disconnect
router.post('/disconnect', (req, res) => {
  storedTokens = null;
  res.json({ ok: true, message: 'YouTube disconnected.' });
});

// POST /api/youtube/upload
router.post('/upload', async (req, res) => {
  if (!storedTokens) {
    return res.status(401).json({ error: 'YouTube not connected. Please connect first.' });
  }

  const { videoUrl, title, description, tags, privacyStatus } = req.body;
  if (!videoUrl || !title) {
    return res.status(400).json({ error: 'videoUrl and title are required' });
  }

  try {
    oauth2Client.setCredentials(storedTokens);
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
          categoryId: '22',
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

    res.json({
      success: true,
      videoId,
      url: `https://www.youtube.com/shorts/${videoId}`
    });

  } catch (err) {
    console.error('YouTube upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;
