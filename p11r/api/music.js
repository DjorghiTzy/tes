const { requireAuth } = require('../lib/auth');
const { getSql, ensureSchema } = require('../lib/db');
const { del } = require('@vercel/blob');

function bodyOf(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

async function ensureMusicSchema() {
  await ensureSchema();
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS music_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      order_no INTEGER NOT NULL DEFAULT 0,
      added_at BIGINT NOT NULL,
      url TEXT NOT NULL
    )
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;

  try {
    await ensureMusicSchema();
    const sql = getSql();

    if (req.method === 'GET') {
      const rows = await sql`SELECT id, name, content_type AS "tipe", size_bytes AS "ukuran", order_no AS "urutan", added_at AS "ditambahkan", url FROM music_items ORDER BY order_no ASC, added_at ASC`;
      return res.status(200).json({ ok: true, data: rows });
    }

    if (req.method === 'POST') {
      const body = bodyOf(req);
      const id = String(body.id || '');
      const name = String(body.nama || '');
      const url = String(body.url || '');
      const tipe = String(body.tipe || 'audio/mpeg');
      const ukuran = Number(body.ukuran || 0);
      const urutan = Number(body.urutan || 0);
      const ditambahkan = Number(body.ditambahkan || Date.now());
      if (!id || !name || !url) return res.status(400).json({ ok: false, error: 'Metadata musik tidak lengkap.' });

      await sql`
        INSERT INTO music_items (id, name, content_type, size_bytes, order_no, added_at, url)
        VALUES (${id}, ${name}, ${tipe}, ${ukuran}, ${urutan}, ${ditambahkan}, ${url})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          content_type = EXCLUDED.content_type,
          size_bytes = EXCLUDED.size_bytes,
          order_no = EXCLUDED.order_no,
          added_at = EXCLUDED.added_at,
          url = EXCLUDED.url
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const body = bodyOf(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      await sql`UPDATE music_items SET order_no = 1000000 + order_no`;
      for (let i = 0; i < ids.length; i += 1) {
        await sql`UPDATE music_items SET order_no = ${i} WHERE id = ${ids[i]}`;
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ ok: false, error: 'ID musik tidak ada.' });
      const rows = await sql`SELECT url FROM music_items WHERE id = ${id} LIMIT 1`;
      await sql`DELETE FROM music_items WHERE id = ${id}`;
      if (rows[0]?.url) {
        try { await del(rows[0].url); } catch (blobError) { console.warn('Gagal menghapus blob:', blobError); }
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method tidak didukung.' });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Gagal mengakses playlist.' });
  }
};
