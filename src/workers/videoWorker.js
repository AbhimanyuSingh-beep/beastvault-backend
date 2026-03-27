require('dotenv').config();
const ffmpeg   = require('fluent-ffmpeg');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const { videoQueue } = require('../config/queue');
const { s3, uploadFile, uploadBuffer, publicUrl } = require('../config/storage');
const { query } = require('../db/pool');

// --- FORCE LINUX PATHS (Internal Safety) ---
const FFMPEG_BIN  = '/usr/bin/ffmpeg';
const FFPROBE_BIN = '/usr/bin/ffprobe';

if (fs.existsSync(FFMPEG_BIN)) {
    ffmpeg.setFfmpegPath(FFMPEG_BIN);
    console.log(`🎬 FFmpeg detected at: ${FFMPEG_BIN}`);
}
if (fs.existsSync(FFPROBE_BIN)) {
    ffmpeg.setFfprobePath(FFPROBE_BIN);
}

const BUCKET = process.env.S3_BUCKET_NAME;
const RESOLUTIONS = (process.env.TRANSCODE_RESOLUTIONS || '360,720').split(',').map(Number);

const RES_CONFIG = {
  360:  { width: 640,  height: 360,  bitrate: '800k',  audioBitrate: '96k'  },
  720:  { width: 1280, height: 720,  bitrate: '2500k', audioBitrate: '128k' },
};

async function downloadFromS3(storageKey, destPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(destPath);
    res.Body.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function transcodeToHLS(inputPath, outputDir, resolution) {
  const cfg = RES_CONFIG[resolution];
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-preset superfast', // Faster for testing
        `-b:v ${cfg.bitrate}`,
        `-vf scale=${cfg.width}:${cfg.height}`,
        '-c:a aac',
        '-hls_time 6',
        '-hls_playlist_type vod',
        `-hls_segment_filename ${path.join(outputDir, `${resolution}p_%04d.ts`)}`,
        '-f hls',
      ])
      .output(path.join(outputDir, `${resolution}p.m3u8`))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ── MAIN JOB PROCESSOR ───────────────────────────────────────────────
videoQueue.process(1, async (job) => { // Reduced to 1 to focus resources
  const { videoId, storageKey } = job.data;
  console.log(`\n🔥 BEAST MODE: Processing Job ${job.id} | Video: ${videoId}`);

  const tmpDir = path.join(os.tmpdir(), `bv_${uuidv4()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const rawPath = path.join(tmpDir, `raw.mp4`);
  const hlsDir  = path.join(tmpDir, 'hls');
  fs.mkdirSync(hlsDir);

  try {
    console.log(`  ⬇️  Downloading: ${storageKey}`);
    await downloadFromS3(storageKey, rawPath);

    console.log(`  🔄 Transcoding to 360p...`);
    await transcodeToHLS(rawPath, hlsDir, 360);

    const s3Prefix = `hls/${videoId}`;
    console.log(`  ⬆️  Uploading HLS to MinIO...`);
    
    // Upload files
    const files = fs.readdirSync(hlsDir);
    for (const file of files) {
        await uploadFile(path.join(hlsDir, file), `${s3Prefix}/${file}`);
    }

    const hlsUrl = publicUrl(`${s3Prefix}/360p.m3u8`);

    await query(
      `UPDATE videos SET status = 'ready', hls_url = $1, updated_at = NOW() WHERE id = $2`,
      [hlsUrl, videoId]
    );

    console.log(`  ✅ DONE! Video ${videoId} is now LIVE.`);
    return { status: 'success' };

  } catch (err) {
    console.error(`  ❌ CRITICAL ERROR for ${videoId}:`, err.message);
    await query(`UPDATE videos SET status='failed' WHERE id=$1`, [videoId]);
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

videoQueue.on('active', (job) => console.log(`🚀 Job ${job.id} is now ACTIVE`));
videoQueue.on('error', (err) => console.error(`❌ Queue Error:`, err));

console.log('🚀 BeastVault Worker: Connected and Listening to Redis...');