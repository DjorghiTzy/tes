const { ensureSchema } = require('../lib/db');

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    return res.status(200).json({ ok: true, database: true });
  } catch (error) {
    return res.status(500).json({ ok: false, database: false, error: error.message });
  }
};
