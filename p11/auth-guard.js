(function () {
  'use strict';
  document.documentElement.style.visibility = 'hidden';
  fetch('/api/auth?action=me', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => r.json())
    .then((result) => {
      if (!result.authenticated) {
        window.location.replace('login.html');
        return;
      }
      document.documentElement.style.visibility = 'visible';
    })
    .catch(() => window.location.replace('login.html'));
})();
