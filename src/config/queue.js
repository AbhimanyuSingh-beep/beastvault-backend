const { createClient } = require('redis');
const Bull = require('bull');

let redisClient;

// The core Redis settings - defaulting to 'redis' for Docker
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASS = process.env.REDIS_PASSWORD || undefined;

async function getRedis() {
  if (redisClient) return redisClient;
  
  redisClient = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    password: REDIS_PASS,
  });

  redisClient.on('error', (err) => console.error('❌ Redis Client Error:', err));
  
  try {
    await redisClient.connect();
    console.log('✅ Connected to Redis successfully');
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err);
  }
  
  return redisClient;
}

// Bull queue configuration
const REDIS_OPTS = {
  redis: {
    host:     REDIS_HOST,
    port:     REDIS_PORT,
    password: REDIS_PASS,
  },
};

// Ensure the name is 'video-processing' to match the Worker
const videoQueue = new Bull('video-processing', REDIS_OPTS);

console.log(`📡 Bull Queue 'video-processing' initialized (Host: ${REDIS_HOST})`);

module.exports = { getRedis, videoQueue };