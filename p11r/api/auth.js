const { credentials, isAuthenticated, setSession, clearSession } = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const action = String(req.query.action || 'me');

    if (action === 'me' && req.method === 'GET') {
      return res.status(200).json({ authenticated: isAuthenticated(req) });
    }

    if (action === 'login' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { username, password } = credentials();
      if (String(body.username || '').trim().toLowerCase() !== username.toLowerCase() || String(body.password || '') !== password) {
        return res.status(401).json({ ok: false, error: 'Username atau kata sandi salah.' });
      }
      setSession(res);
      return res.status(200).json({ ok: true });
    }

    if (action === 'logout' && req.method === 'POST') {
      clearSession(res);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method tidak didukung.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
};
