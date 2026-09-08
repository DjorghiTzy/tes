const crypto = require('crypto');

const COOKIE_NAME = 'kg_session';
const SESSION_DAYS = 30;

function getSecret() {
  return process.env.AUTH_SECRET || 'change-this-secret-before-production';
}

function credentials() {
  return {
    username: process.env.AUTH_USERNAME || 'admin',
    password: process.env.AUTH_PASSWORD || 'admin123',
  };
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `admin.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const supplied = parts[2];
  if (supplied.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const result = {};
  raw.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result[key] = decodeURIComponent(value);
  });
  return result;
}

function isAuthenticated(req) {
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

function setSession(res) {
  const maxAge = SESSION_DAYS * 86400;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(makeToken())}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  return false;
}

module.exports = { credentials, isAuthenticated, setSession, clearSession, requireAuth };
