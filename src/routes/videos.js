const express    = require('express');
const { query }  = require('../db/pool');
const { optionalAuth } = require('../middleware/auth');
const { upload } = require('../middleware/uploader');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

// ── Helper: upload buffer to Cloudinary ─────────────────────────────
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: 'beastvault',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ── POST /api/videos/upload ──────────────────────────────────────────
router.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });

  // 1. Extract is_private from body
  const { title, description, category, is_private } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  // 2. Convert string "true"/"false" to actual Boolean
  const privateFlag = is_private === 'true' || is_private === true;

  try {
    console.log(`⬆️  Uploading "${title}" to Cloudinary...`);

    const result = await uploadToCloudinary(req.file.buffer);

    const videoUrl     = result.secure_url;
    const thumbnailUrl = cloudinary.url(result.public_id + '.jpg', {
      resource_type: 'video',
      transformation: [{ width: 640, height: 360, crop: 'fill' }],
      secure: true,
    });

    const userRes = await query('SELECT id FROM users LIMIT 1');
    if (userRes.rowCount === 0)
      return res.status(500).json({ error: 'No users found. Create a user first.' });

    const userId = req.user ? req.user.id : userRes.rows[0].id;

    // 3. Save to DB including the is_private flag
    const { rows } = await query(
      `INSERT INTO videos
         (user_id, title, description, category, status, hls_url, thumbnail_url, raw_storage_key, size_bytes, is_private)
       VALUES ($1, $2, $3, $4, 'ready', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        title,
        description || '',
        category || 'General',
        videoUrl,
        thumbnailUrl,
        result.public_id,
        req.file.size,
        privateFlag
      ]
    );

    console.log(`✅ Video "${title}" is LIVE — Private: ${privateFlag} — ID: ${rows[0].id}`);

    res.status(202).json({
      message: 'Video unleashed to the vault!',
      videoId: rows[0].id,
      status:  'ready',
      url:     videoUrl,
    });
  } catch (err) {
    console.error('UPLOAD ERROR:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /api/videos ──────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit  || '20'), 50);
  const offset   = parseInt(req.query.offset || '0');
  const category = req.query.category;

  // RULE: By default, we only show PUBLIC videos (is_private = false)
  let sql = `
    SELECT v.id, v.title, v.description, v.category,
           v.hls_url, v.thumbnail_url, v.views, v.duration_secs,
           v.status, v.created_at, v.is_private,
           u.id AS uploader_id,
           u.username AS uploader,
           u.avatar_url,
           COUNT(l.user_id) AS likes
    FROM videos v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN likes l ON l.video_id = v.id
    WHERE v.is_private = false
  `;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    sql += ` AND v.category = $${params.length}`;
  }

  sql += `
    GROUP BY v.id, u.id
    ORDER BY v.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(limit, offset);

  try {
    const { rows } = await query(sql, params);
    res.json({ videos: rows, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// ── GET /api/videos/search ───────────────────────────────────────────
router.get('/search', optionalAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ videos: [] });
  try {
    const { rows } = await query(
      `SELECT v.id, v.title, v.description, v.category,
              v.hls_url, v.thumbnail_url, v.views, v.duration_secs,
              v.created_at, u.username AS uploader, u.avatar_url,
              ts_rank(v.search_vector, query) AS rank
       FROM videos v
       JOIN users u ON u.id = v.user_id,
       plainto_tsquery('english', $1) query
       WHERE v.status = 'ready' 
         AND v.is_private = false 
         AND v.search_vector @@ query
       ORDER BY rank DESC LIMIT 30`,
      [q]
    );
    res.json({ videos: rows, query: q });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── GET /api/videos/:id ──────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT v.*,
              u.username AS uploader, u.avatar_url, u.bio,
              COUNT(DISTINCT l.user_id) AS likes,
              COUNT(DISTINCT s.follower_id) AS subscriber_count
       FROM videos v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN likes l ON l.video_id = v.id
       LEFT JOIN subscriptions s ON s.following_id = v.user_id
       WHERE v.id = $1
       GROUP BY v.id, u.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Video not found' });
    res.json({ video: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// ── POST /api/videos/:id/view ────────────────────────────────────────
router.post('/:id/view', async (req, res) => {
  try {
    await query('UPDATE videos SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// ── DELETE /api/videos/:id ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT raw_storage_key FROM videos WHERE id=$1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Video not found' });

    if (rows[0].raw_storage_key) {
      await cloudinary.uploader.destroy(rows[0].raw_storage_key, { resource_type: 'video' });
    }

    await query('DELETE FROM videos WHERE id=$1', [req.params.id]);
    res.json({ ok: true, message: 'Video purged from vault' });
  } catch (err) {
    console.error('DELETE ERROR:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/videos/:id/comments ─────────────────────────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, content, created_at 
       FROM comments 
       WHERE video_id = $1 
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  } catch (err) {
    console.error('FETCH COMMENTS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// ── POST /api/videos/:id/comments ────────────────────────────────────
router.post('/:id/comments', optionalAuth, async (req, res) => {
  const { content, username } = req.body;
  const videoId = req.params.id;
  const userId = req.user ? req.user.id : null;
  const authorName = username || (req.user ? req.user.username : 'Anonymous');

  if (!content) return res.status(400).json({ error: 'Comment content is required' });

  try {
    const { rows } = await query(
      `INSERT INTO comments (video_id, user_id, username, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, content, created_at`,
      [videoId, userId, authorName, content]
    );
    res.status(201).json({ comment: rows[0] });
  } catch (err) {
    console.error('POST COMMENT ERROR:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

module.exports = router;