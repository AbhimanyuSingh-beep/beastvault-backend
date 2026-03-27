const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createReadStream } = require('fs');
const path = require('path');

const s3 = new S3Client({
  region:   process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,        // Cloudflare R2 or AWS
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,                    // true only for MinIO local dev
});

const BUCKET = process.env.S3_BUCKET_NAME;
const CDN    = process.env.S3_PUBLIC_URL;   // e.g. https://cdn.yourdomain.com

// Upload a local file to S3/R2
async function uploadFile(localPath, storageKey, contentType = 'application/octet-stream') {
  const stream = createReadStream(localPath);
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         storageKey,
    Body:        stream,
    ContentType: contentType,
  }));
  return `${CDN}/${storageKey}`;
}

// Upload raw buffer / string (for small files like .m3u8 playlists)
async function uploadBuffer(buffer, storageKey, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         storageKey,
    Body:        buffer,
    ContentType: contentType,
  }));
  return `${CDN}/${storageKey}`;
}

// Delete a key
async function deleteFile(storageKey) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

// Generate a presigned upload URL (frontend uploads directly to S3 — skips your server)
async function presignedUploadUrl(storageKey, contentType, expiresIn = 3600) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// Public CDN URL for a key
function publicUrl(storageKey) {
  return `${CDN}/${storageKey}`;
}

module.exports = { s3, uploadFile, uploadBuffer, deleteFile, presignedUploadUrl, publicUrl };
