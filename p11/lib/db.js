const { neon } = require('@neondatabase/serverless');

let readyPromise;

function getSql() {
  if (!process.env.DATABASE_URL) {
    const err = new Error('DATABASE_URL belum dikonfigurasi. Hubungkan Neon Postgres ke project Vercel.');
    err.statusCode = 500;
    throw err;
  }
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema() {
  if (!readyPromise) {
    const sql = getSql();
    readyPromise = sql`
      CREATE TABLE IF NOT EXISTS app_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  }
  try {
    await readyPromise;
  } catch (error) {
    readyPromise = null;
    throw error;
  }
}

async function readStore(key) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT value FROM app_store WHERE key = ${key} LIMIT 1`;
  return rows[0] ? rows[0].value : null;
}

async function writeStore(key, value) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO app_store (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return value;
}

module.exports = { getSql, ensureSchema, readStore, writeStore };
