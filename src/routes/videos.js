const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { upload } = require('../middleware/uploader');
const { videoQueue } = require('../config/queue');

const router = express.Router();

// ── POST /videos/upload ──────────────────────────────────────────────
router.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });

  const { title, description, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const storageKey = req.file.key;
  const sizeBytes  = req.file.size;

  try {
    const userRes = await query('SELECT id FROM users LIMIT 1');
    if (userRes.rowCount === 0) {
        return res.status(500).json({ error: 'No users found in database. Create a user first!' });
    }
    
    const userId = req.user ? req.user.id : userRes.rows[0].id;

    const { rows } = await query(
      `INSERT INTO videos (user_id, title, description, category, status, raw_storage_key, size_bytes)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6)
       RETURNING id`,
      [userId, title, description || '', category || 'General', storageKey, sizeBytes]
    );
    const videoId = rows[0].id;

    await videoQueue.add(
      { videoId, userId, storageKey },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      }
    );

    res.status(202).json({
      message: 'Video uploaded and queued for processing',
      videoId,
      status: 'processing',
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── GET /videos ──────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '20'), 50);
  const offset = parseInt(req.query.offset || '0');
  const category = req.query.category;

  let sql = `
    SELECT v.id, v.title, v.description, v.category,
           v.hls_url, v.thumbnail_url, v.views, v.duration_secs,
           v.status, v.created_at,
           u.id   AS uploader_id,
           u.username AS uploader,
           u.avatar_url,
           COUNT(l.user_id) AS likes
    FROM videos v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN likes l ON l.video_id = v.id
    WHERE 1=1
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

// ── DELETE /videos/:id ───────────────────────────────────────────────
// UNLOCKED: Removed requireAuth so you can purge test videos easily
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT raw_storage_key, hls_url FROM videos WHERE id=$1',
      [req.params.id]
    );
    
    if (!rows[0]) return res.status(404).json({ error: 'Video not found' });

    // Delete from Database
    await query('DELETE FROM videos WHERE id=$1', [req.params.id]);
    
    res.json({ ok: true, message: "Video purged from vault" });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /videos/search ───────────────────────────────────────────────
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
         WHERE v.status = 'ready' AND v.search_vector @@ query
         ORDER BY rank DESC
         LIMIT 30`,
        [q]
      );
      res.json({ videos: rows, query: q });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Search failed' });
    }
  });
  
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
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});
  
router.post('/:id/view', async (req, res) => {
  try {
    await query('UPDATE videos SET views = views + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record view' });
  }
});

module.exports = router;