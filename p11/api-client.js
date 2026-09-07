(function () {
  'use strict';

  async function request(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function getData(key, fallback) {
    try {
      const result = await request(`/api/data?key=${encodeURIComponent(key)}`);
      return { data: result.data, exists: result.exists };
    } catch (error) {
      console.error(`Gagal memuat ${key}:`, error);
      return { data: fallback, exists: false, offline: true };
    }
  }

  async function saveData(key, data) {
    const result = await request(`/api/data?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    return result.data;
  }

  window.KegiatanAPI = {
    request,
    getData,
    saveData,
    login: (username, password) => request('/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    logout: () => request('/api/auth?action=logout', { method: 'POST' }),
    me: () => request('/api/auth?action=me'),
  };
})();
