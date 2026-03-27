const express = require('express');
const { query } = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /users/:id ───────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.avatar_url, u.bio, u.created_at,
              COUNT(DISTINCT v.id)  AS video_count,
              COUNT(DISTINCT s.follower_id) AS subscriber_count
       FROM users u
       LEFT JOIN videos v ON v.user_id = u.id AND v.status = 'ready'
       LEFT JOIN subscriptions s ON s.following_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── GET /users/:id/videos ────────────────────────────────────────────
router.get('/:id/videos', optionalAuth, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || '20'), 50);
  const offset = parseInt(req.query.offset || '0');
  try {
    const { rows } = await query(
      `SELECT v.id, v.title, v.thumbnail_url, v.hls_url, v.views,
              v.duration_secs, v.category, v.created_at,
              COUNT(l.video_id) AS likes
       FROM videos v
       LEFT JOIN likes l ON l.video_id = v.id
       WHERE v.user_id = $1 AND v.status = 'ready'
       GROUP BY v.id
       ORDER BY v.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json({ videos: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user videos' });
  }
});

// ── POST /users/:id/subscribe ────────────────────────────────────────
router.post('/:id/subscribe', requireAuth, async (req, res) => {
  const followingId = req.params.id;
  const followerId  = req.user.id;
  if (followerId === followingId)
    return res.status(400).json({ error: 'You cannot subscribe to yourself' });

  try {
    const existing = await query(
      'SELECT 1 FROM subscriptions WHERE follower_id=$1 AND following_id=$2',
      [followerId, followingId]
    );
    if (existing.rowCount > 0) {
      await query('DELETE FROM subscriptions WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]);
      res.json({ subscribed: false });
    } else {
      await query('INSERT INTO subscriptions (follower_id, following_id) VALUES ($1,$2)', [followerId, followingId]);
      res.json({ subscribed: true });
    }
  } catch (err) {
    res.status(500).json({ error: 'Subscribe action failed' });
  }
});

module.exports = router;
