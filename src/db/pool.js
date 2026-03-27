const { Pool } = require('pg');

const isProduction = process.env.DATABASE_URL;

const poolConfig = isProduction 
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Required for Neon cloud hosting
    }
  : {
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased to 10 seconds for cloud reliability
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle DB client', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { pool, query, getClient };