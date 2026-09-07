const { requireAuth } = require('../lib/auth');
const { readStore, writeStore } = require('../lib/db');

const ALLOWED_KEYS = new Set(['schedule', 'barcode_queue', 'barcode_history', 'barcode_style', 'music_state', 'barcode_warna_map']);
const DEFAULTS = {
  schedule: {},
  barcode_queue: [],
  barcode_history: [],
  barcode_style: {
    kiriFont: 'Arial, Helvetica, sans-serif',
    kiriWarnaFont: '#ffffff',
    kananFont: 'Arial, Helvetica, sans-serif',
    kananWarnaFont: '#000000',
  },
  barcode_warna_map: {},
  music_state: {
    laguAktifId: null,
    posisiDetik: 0,
    sedangPutar: false,
    volume: 0.8,
    mode: 'urut',
    diperbaruiPada: 0,
  },
};

function jsonBody(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAuth(req, res)) return;

  const key = String(req.query.key || '');
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ ok: false, error: 'Key tidak valid.' });

  try {
    if (req.method === 'GET') {
      const data = await readStore(key);
      return res.status(200).json({ ok: true, data: data === null ? DEFAULTS[key] : data, exists: data !== null });
    }

    if (req.method === 'PUT') {
      const body = jsonBody(req);
      const value = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
      if (value === undefined) return res.status(400).json({ ok: false, error: 'Data kosong.' });
      await writeStore(key, value);
      return res.status(200).json({ ok: true, data: value });
    }

    return res.status(405).json({ ok: false, error: 'Method tidak didukung.' });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Gagal mengakses database.' });
  }
};
