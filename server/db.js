const { Pool } = require('pg');

// Accounts need storage that survives restarts, which Render's free disk does not.
// Without DATABASE_URL (local runs and tests) the app keeps using JSON files instead.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
`;

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  // The connection string carries sslmode=require for hosted databases such as Neon.
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

async function ensureSchema() {
  const db = getPool();
  if (db) await db.query(SCHEMA);
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { getPool, ensureSchema, closePool };
