const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
];

// Store tokens in memory (simple approach)
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
  try {
    const { tokens } = await oauth2Client.getToken(code);
    storedTokens = tokens;
    oauth2Client.setCredentials(tokens);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>YouTube connected!</h2>
        <p>You can close this tab and go back to BeastVault.</p>
        <script>
          if(window.opener) {
            window.opener.postMessage('youtube-connected', '*');
            setTimeout(() => window.close(), 2000);
          }
        </script>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// GET /api/youtube/status - check if connected
router.get('/status', (req, res) => {
  res.json({ connected: !!storedTokens });
});

// POST /api/youtube/upload - upload video as Short
router.post('/upload', async (req, res) => {
  if (!storedTokens) {
    return res.status(401).json({ error: 'YouTube not connected. Please connect first.' });
  }

  const { videoUrl, title, description, tags } = req.body;
  if (!videoUrl || !title) {
    return res.status(400).json({ error: 'videoUrl and title are required' });
  }

  try {
    oauth2Client.setCredentials(storedTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Fetch the video from Cloudinary
    const https = require('https');
    const http = require('http');
    const protocol = videoUrl.startsWith('https') ? https : http;

    const videoStream = await new Promise((resolve, reject) => {
      protocol.get(videoUrl, resolve).on('error', reject);
    });

    console.log(`Uploading "${title}" to YouTube as Short...`);

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.substring(0, 100),
          description: description || '',
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        }
      },
      media: {
        body: videoStream
      }
    });

    const videoId = response.data.id;
    console.log(`Uploaded to YouTube! ID: ${videoId}`);

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