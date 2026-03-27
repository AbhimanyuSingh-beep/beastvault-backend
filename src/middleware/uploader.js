const multer = require('multer');
const multerS3 = require('multer-s3');
const { s3 } = require('../config/storage');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const MAX_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '500');

const ALLOWED_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-msvideo', 'video/x-matroska', 'video/mpeg',
];

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      
      // FIX: If user is not logged in, use 'anonymous' instead of crashing
      const userId = req.user ? req.user.id : 'anonymous';
      
      const key = `raw/${userId}/${uuidv4()}${ext}`;
      cb(null, key);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

module.exports = { upload };