/* ============================================================
   musik-player.js
   ----------------------------------------------------------
   Widget musik latar yang "selalu terputar" di semua halaman.

   Karena aplikasi ini adalah multi-halaman (bukan single-page
   app), tag <audio> akan selalu hilang & dibuat ulang setiap
   kali pindah halaman. Trik yang dipakai di sini:

   1. Semua file musik disimpan di IndexedDB (bukan localStorage,
      karena localStorage cuma untuk teks & kapasitasnya kecil,
      sedangkan file audio bisa besar).
   2. Status pemutaran (lagu keberapa yang aktif, sedang di detik
      keberapa, sedang play/pause, volume, mode ulang/acak)
      disimpan di localStorage sebagai "state bersama".
   3. Setiap halaman yang memuat musik-player.js akan:
        - Membaca state terakhir dari localStorage.
        - Memuat file lagu yang sesuai dari IndexedDB.
        - Melanjutkan pemutaran persis dari posisi detik terakhir.
      Efeknya terasa seperti musik "tidak pernah berhenti" walau
      pindah-pindah menu, walau sebenarnya di balik layar audio
      dibuat ulang tiap load halaman.
   4. Widget player mini (floating, pojok kanan bawah) dirender
      otomatis oleh skrip ini di semua halaman yang meng-include-nya,
      supaya kontrolnya selalu terlihat & bisa dipakai dari mana saja.

   "Selalu terputar walau mendengar musik lain": begitu ada file
   diimpor & playlist ini pertama kali dijalankan pengguna, ia
   akan terus lanjut di semua halaman aplikasi ini, tidak berhenti
   sendiri ketika berpindah menu (kecuali pengguna menekan pause).
   Catatan jujur: browser tidak mengizinkan dua tab situs yang
   berbeda saling mematikan audio satu sama lain, jadi "walau
   mendengar musik lain" di sini berarti "tetap lanjut jalan di
   semua halaman aplikasi ini", bukan mengendalikan aplikasi lain
   di luar situs ini.
   ============================================================ */

(function () {
  "use strict";

  var DB_NAME = "musik-kegiatan-db";
  var DB_VERSION = 1;
  var STORE_NAME = "lagu";
  var STATE_KEY = "musik-kegiatan-state";
  var BROADCAST_CHANNEL_NAME = "musik-kegiatan-sync";

  /* ---------------------------------------------------------
     0. Util kecil
     --------------------------------------------------------- */

  function formatWaktu(detik) {
    if (!isFinite(detik) || detik < 0) detik = 0;
    var m = Math.floor(detik / 60);
    var s = Math.floor(detik % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function buatId() {
    return "lg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------------------------------------------------
     1. Penyimpanan online: metadata di Neon + audio di Vercel Blob
     --------------------------------------------------------- */

  var MusikDB = (function () {
    var uploadModulePromise = null;

    function api(path, options) {
      return fetch(path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {}))
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
            return data;
          });
        });
    }

    function ambilSemua() {
      return api("/api/music", { method: "GET" }).then(function (result) {
        return result.data || [];
      });
    }

    function ambilSatu(id) {
      return ambilSemua().then(function (list) {
        return list.find(function (item) { return item.id === id; }) || null;
      });
    }

    function getUploadModule() {
      if (!uploadModulePromise) {
        uploadModulePromise = import("https://esm.sh/@vercel/blob@2.8.0/client?bundle");
      }
      return uploadModulePromise;
    }

    function tambahLagu(file, meta) {
      return getUploadModule().then(function (mod) {
        var pathname = "musik/" + Date.now() + "-" + String(meta.nama || "audio").replace(/[^a-zA-Z0-9._-]/g, "_");
        return mod.upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/music-upload",
          contentType: meta.tipe || file.type || "audio/mpeg",
          multipart: file.size > 4 * 1024 * 1024,
          clientPayload: JSON.stringify({ id: meta.id || buatId(), nama: meta.nama, tipe: meta.tipe, ukuran: meta.ukuran })
        }).then(function (blob) {
          var data = {
            id: meta.id || buatId(),
            nama: meta.nama,
            tipe: meta.tipe || file.type || "audio/mpeg",
            ukuran: meta.ukuran || file.size,
            urutan: meta.urutan || 0,
            ditambahkan: meta.ditambahkan || Date.now(),
            url: blob.url
          };
          return api("/api/music", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          }).then(function () { return data; });
        });
      });
    }

    function hapusLagu(id) {
      return api("/api/music?id=" + encodeURIComponent(id), { method: "DELETE" });
    }

    function updateUrutan(daftarId) {
      return api("/api/music", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: daftarId })
      });
    }

    function migrasiLegacy() {
      if (localStorage.getItem("musik-online-migrated") === "1") return Promise.resolve(false);
      return ambilSemua().then(function (onlineList) {
        if (onlineList.length) {
          localStorage.setItem("musik-online-migrated", "1");
          return false;
        }
        return new Promise(function (resolve) {
          var request;
          try { request = indexedDB.open("musik-kegiatan-db", 1); } catch (e) { resolve(false); return; }
          request.onerror = function () { resolve(false); };
          request.onsuccess = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains("lagu")) {
              resolve(false);
              return;
            }
            var tx = db.transaction("lagu", "readonly");
            var getAll = tx.objectStore("lagu").getAll();
            getAll.onerror = function () { resolve(false); };
            getAll.onsuccess = function () {
              var legacy = (getAll.result || []).sort(function (a, b) { return a.urutan - b.urutan; });
              var chain = Promise.resolve();
              legacy.forEach(function (item, index) {
                chain = chain.then(function () {
                  if (!item.blob) return;
                  return tambahLagu(item.blob, {
                    nama: item.nama, tipe: item.tipe, ukuran: item.ukuran, urutan: index, ditambahkan: item.ditambahkan
                  });
                });
              });
              chain.then(function () {
                localStorage.setItem("musik-online-migrated", "1");
                resolve(legacy.length > 0);
              }).catch(function () { resolve(false); });
            };
          };
        });
      });
    }

    return {
      tambahLagu: tambahLagu,
      ambilSemua: ambilSemua,
      ambilSatu: ambilSatu,
      hapusLagu: hapusLagu,
      updateUrutan: updateUrutan,
      migrasiLegacy: migrasiLegacy
    };
  })();

  /* ---------------------------------------------------------
     2. State pemutaran online: Neon (dengan cache fallback)
     --------------------------------------------------------- */

  var MusikState = (function () {
    var defaultState = {
      laguAktifId: null,
      posisiDetik: 0,
      sedangPutar: false,
      volume: 0.8,
      mode: "urut",
      diperbaruiPada: 0
    };
    var cache = Object.assign({}, defaultState);
    var saveTimer = null;

    function baca() {
      return Object.assign({}, cache);
    }

    function load() {
      return fetch("/api/data?key=music_state", { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (result) {
          cache = Object.assign({}, defaultState, result.data || {});
          try { localStorage.setItem(STATE_KEY, JSON.stringify(cache)); } catch (e) {}
          return cache;
        })
        .catch(function () {
          try {
            var raw = localStorage.getItem(STATE_KEY);
            if (raw) cache = Object.assign({}, defaultState, JSON.parse(raw));
          } catch (e) {}
          return cache;
        });
    }

    function simpan(state) {
      cache = Object.assign({}, defaultState, state, { diperbaruiPada: Date.now() });
      try { localStorage.setItem(STATE_KEY, JSON.stringify(cache)); } catch (e) {}
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fetch("/api/data?key=music_state", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: cache })
        }).catch(function (e) { console.warn("Gagal menyimpan state musik:", e); });
      }, 250);
    }

    return { baca: baca, simpan: simpan, load: load };
  })();

  /* ---------------------------------------------------------
     3. Widget floating player (dirender di semua halaman)
     --------------------------------------------------------- */

  function suntikCss() {
    if (document.getElementById("musik-player-css")) return;
    var link = document.createElement("link");
    link.id = "musik-player-css";
    link.rel = "stylesheet";
    link.href = resolvePath("musik-player.css");
    document.head.appendChild(link);
  }

  // Supaya musik-player.js bisa di-include dari halaman di root
  // tanpa mengharuskan tiap file menuliskan path yang sama persis.
  function resolvePath(namaFile) {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("musik-player.js") !== -1) {
        return src.replace("musik-player.js", namaFile);
      }
    }
    return namaFile;
  }

  function buatWidget() {
    if (document.getElementById("musik-widget")) return;

    var wrap = document.createElement("div");
    wrap.id = "musik-widget";
    wrap.className = "musik-widget musik-widget-collapsed";
    wrap.innerHTML =
      '<button class="musik-widget-toggle" id="musik-toggle" title="Buka/tutup pemutar musik">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>' +
      '</button>' +
      '<div class="musik-widget-panel">' +
        '<div class="musik-widget-info">' +
          '<div class="musik-widget-judul" id="musik-judul">Belum ada musik</div>' +
          '<div class="musik-widget-sub" id="musik-sub">Buka menu Musik untuk mengimpor lagu</div>' +
        '</div>' +
        '<div class="musik-widget-progress">' +
          '<span class="musik-time" id="musik-time-now">0:00</span>' +
          '<input type="range" id="musik-seek" min="0" max="100" value="0" step="1">' +
          '<span class="musik-time" id="musik-time-total">0:00</span>' +
        '</div>' +
        '<div class="musik-widget-controls">' +
          '<button class="musik-ctrl" id="musik-prev" title="Sebelumnya">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"></path></svg>' +
          '</button>' +
          '<button class="musik-ctrl musik-ctrl-main" id="musik-toggle-play" title="Putar/Jeda">' +
            '<svg id="musik-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>' +
          '</button>' +
          '<button class="musik-ctrl" id="musik-next" title="Berikutnya">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 18h2V6h-2zM6 18l8.5-6L6 6z"></path></svg>' +
          '</button>' +
          '<button class="musik-ctrl musik-ctrl-mode" id="musik-mode" title="Mode ulang">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>' +
          '</button>' +
        '</div>' +
        '<div class="musik-widget-volume">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M3 10v4h4l5 5V5L7 10H3z"></path></svg>' +
          '<input type="range" id="musik-volume" min="0" max="100" value="80" step="1">' +
        '</div>' +
        '<a class="musik-widget-link" href="' + resolveHtmlPath() + '">Kelola playlist &rarr;</a>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  function resolveHtmlPath() {
    // musik.html selalu ada di direktori yang sama dengan musik-player.js
    return resolvePath("musik.html");
  }

  /* ---------------------------------------------------------
     4. Kontroler utama: menyambungkan <audio>, state, & widget
     --------------------------------------------------------- */

  function initController() {
    var audio = new Audio();
    audio.preload = "auto";

    var els = {};
    function q(id) { return document.getElementById(id); }

    function ambilEls() {
      els.judul = q("musik-judul");
      els.sub = q("musik-sub");
      els.seek = q("musik-seek");
      els.timeNow = q("musik-time-now");
      els.timeTotal = q("musik-time-total");
      els.prev = q("musik-prev");
      els.next = q("musik-next");
      els.togglePlay = q("musik-toggle-play");
      els.iconPlay = q("musik-icon-play");
      els.mode = q("musik-mode");
      els.volume = q("musik-volume");
      els.toggleWidget = q("musik-toggle");
      els.widget = q("musik-widget");
    }

    var playlist = [];
    var state = MusikState.baca();
    var isSeeking = false;

    var channel = null;
    try {
      if ("BroadcastChannel" in window) {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      }
    } catch (e) { channel = null; }

    function siarkanState() {
      MusikState.simpan(state);
      if (channel) {
        try { channel.postMessage({ tipe: "state-berubah" }); } catch (e) {}
      }
    }

    function updateIconPlay() {
      if (!els.iconPlay) return;
      els.iconPlay.innerHTML = state.sedangPutar
        ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"></path>'
        : '<path d="M8 5v14l11-7z"></path>';
    }

    function updateModeIcon() {
      if (!els.mode) return;
      els.mode.classList.toggle("musik-ctrl-active", state.mode !== "urut");
      els.mode.title = state.mode === "urut" ? "Mode: Urut"
        : state.mode === "ulang-satu" ? "Mode: Ulang satu lagu"
        : "Mode: Acak";
    }

    function cariLaguIndex(id) {
      for (var i = 0; i < playlist.length; i++) {
        if (playlist[i].id === id) return i;
      }
      return -1;
    }

    function laguBerikutnya(dariId, arah) {
      if (playlist.length === 0) return null;
      if (state.mode === "acak") {
        if (playlist.length === 1) return playlist[0];
        var idx;
        do {
          idx = Math.floor(Math.random() * playlist.length);
        } while (playlist[idx].id === dariId);
        return playlist[idx];
      }
      var curIdx = cariLaguIndex(dariId);
      if (curIdx === -1) return playlist[0];
      var nextIdx = (curIdx + arah + playlist.length) % playlist.length;
      return playlist[nextIdx];
    }

    function muatMetaLagu(lagu) {
      if (!els.judul) return;
      if (!lagu) {
        els.judul.textContent = "Belum ada musik";
        els.sub.textContent = "Buka menu Musik untuk mengimpor lagu";
        return;
      }
      els.judul.textContent = lagu.nama.replace(/\.[a-zA-Z0-9]+$/, "");
      var posisi = cariLaguIndex(lagu.id) + 1;
      els.sub.textContent = "Lagu " + posisi + " dari " + playlist.length;
    }

    function muatLagu(id, autoplay, posisiAwal) {
      return MusikDB.ambilSatu(id).then(function (data) {
        if (!data) return;
        audio.src = data.url;
        audio.volume = state.volume;
        muatMetaLagu(data);
        var mulai = function () {
          if (posisiAwal && isFinite(posisiAwal)) {
            audio.currentTime = posisiAwal;
          }
          if (autoplay) {
            var p = audio.play();
            if (p && p.catch) {
              p.catch(function () {
                // Browser memblokir autoplay sebelum ada interaksi pengguna;
                // status tetap "sedang putar" di data, tapi audio nyala
                // begitu pengguna menyentuh halaman (lihat tryResumeOnInteraction).
                tryResumeOnInteraction();
              });
            }
          }
          audio.removeEventListener("loadedmetadata", mulai);
        };
        audio.addEventListener("loadedmetadata", mulai);
      });
    }

    var sudahPasangResumeListener = false;
    function tryResumeOnInteraction() {
      if (sudahPasangResumeListener) return;
      sudahPasangResumeListener = true;
      var resume = function () {
        if (state.sedangPutar && audio.paused) {
          audio.play().catch(function () {});
        }
        document.removeEventListener("click", resume);
        document.removeEventListener("keydown", resume);
        sudahPasangResumeListener = false;
      };
      document.addEventListener("click", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }

    function putar() {
      if (!audio.src) return;
      audio.play().then(function () {
        state.sedangPutar = true;
        updateIconPlay();
        siarkanState();
      }).catch(function () {
        tryResumeOnInteraction();
      });
    }

    function jeda() {
      audio.pause();
      state.sedangPutar = false;
      updateIconPlay();
      siarkanState();
    }

    function pindahLagu(arah) {
      var target = laguBerikutnya(state.laguAktifId, arah);
      if (!target) return;
      // Simpan niat "lanjut putar" SEBELUM audio.src diganti. Mengganti
      // audio.src pada lagu yang sedang ended/playing memicu event "pause"
      // bawaan browser lebih dulu — kalau kita baca state.sedangPutar
      // setelah itu, nilainya sudah keburu ditimpa jadi false oleh handler
      // pause. Maka niat ini disimpan lebih dulu, lalu dipakai apa adanya.
      var lanjutkanPutar = state.sedangPutar;
      state.laguAktifId = target.id;
      state.posisiDetik = 0;
      muatLagu(target.id, lanjutkanPutar, 0);
      siarkanState();
    }

    function pasangEventUI() {
      if (els.togglePlay) {
        els.togglePlay.addEventListener("click", function () {
          if (!audio.src) return;
          if (audio.paused) putar(); else jeda();
        });
      }
      if (els.prev) els.prev.addEventListener("click", function () { pindahLagu(-1); });
      if (els.next) els.next.addEventListener("click", function () { pindahLagu(1); });

      if (els.mode) {
        els.mode.addEventListener("click", function () {
          state.mode = state.mode === "urut" ? "ulang-satu"
            : state.mode === "ulang-satu" ? "acak" : "urut";
          updateModeIcon();
          siarkanState();
        });
      }

      if (els.volume) {
        els.volume.value = Math.round(state.volume * 100);
        els.volume.addEventListener("input", function () {
          state.volume = els.volume.value / 100;
          audio.volume = state.volume;
          siarkanState();
        });
      }

      if (els.seek) {
        els.seek.addEventListener("mousedown", function () { isSeeking = true; });
        els.seek.addEventListener("touchstart", function () { isSeeking = true; });
        els.seek.addEventListener("change", function () {
          if (audio.duration) {
            audio.currentTime = (els.seek.value / 100) * audio.duration;
            state.posisiDetik = audio.currentTime;
            siarkanState();
          }
          isSeeking = false;
        });
      }

      if (els.toggleWidget && els.widget) {
        els.toggleWidget.addEventListener("click", function () {
          els.widget.classList.toggle("musik-widget-collapsed");
        });
      }
    }

    function pasangEventAudio() {
      audio.addEventListener("timeupdate", function () {
        if (isSeeking) return;
        state.posisiDetik = audio.currentTime;
        if (els.timeNow) els.timeNow.textContent = formatWaktu(audio.currentTime);
        if (els.timeTotal) els.timeTotal.textContent = formatWaktu(audio.duration);
        if (els.seek && audio.duration) {
          els.seek.value = (audio.currentTime / audio.duration) * 100;
        }
        // Simpan posisi secara berkala (bukan tiap tick) supaya hemat.
        if (Math.floor(audio.currentTime) % 3 === 0) {
          MusikState.simpan(state);
        }
      });

      audio.addEventListener("ended", function () {
        if (state.mode === "ulang-satu") {
          audio.currentTime = 0;
          audio.play();
          return;
        }
        pindahLagu(1);
      });

      audio.addEventListener("play", function () {
        state.sedangPutar = true;
        updateIconPlay();
      });

      audio.addEventListener("pause", function () {
        // Sengaja TIDAK mengubah state.sedangPutar di sini. Event "pause"
        // juga terpicu secara pasif oleh browser saat audio.src diganti
        // (pindah lagu) maupun sesaat sebelum event "ended" — bukan cuma
        // saat pengguna menekan tombol jeda. Kalau state diubah dari sini,
        // "lanjut otomatis ke lagu berikutnya" bisa salah kebaca sebagai
        // "berhenti", padahal seharusnya tetap lanjut. Perubahan status
        // eksplisit "berhenti" hanya dilakukan oleh fungsi jeda() saat
        // pengguna benar-benar menekan tombol jeda.
        updateIconPlay();
      });
    }

    // Ketika ada perubahan playlist/state dari tab atau halaman lain.
    if (channel) {
      channel.onmessage = function (e) {
        if (e.data && e.data.tipe === "playlist-berubah") {
          muatPlaylistDanMulai(false);
        }
      };
    }

    function muatPlaylistDanMulai(bolehAutoplayAwal) {
      return MusikDB.ambilSemua().then(function (daftar) {
        playlist = daftar;
        state = MusikState.baca();

        if (playlist.length === 0) {
          muatMetaLagu(null);
          return;
        }

        var aktifId = state.laguAktifId;
        if (!aktifId || cariLaguIndex(aktifId) === -1) {
          aktifId = playlist[0].id;
          state.laguAktifId = aktifId;
        }

        muatMetaLagu(playlist[cariLaguIndex(aktifId)]);

        var autoplay = bolehAutoplayAwal && state.sedangPutar;
        muatLagu(aktifId, autoplay, state.posisiDetik || 0);
        updateModeIcon();
        updateIconPlay();
      });
    }

    // Setiap kali halaman ini akan ditinggalkan (pindah menu), simpan
    // posisi & status terkini supaya halaman berikutnya bisa melanjutkan
    // persis dari titik yang sama.
    window.addEventListener("beforeunload", function () {
      state.posisiDetik = audio.currentTime || state.posisiDetik;
      MusikState.simpan(state);
    });

    ambilEls();
    pasangEventUI();
    pasangEventAudio();
    updateModeIcon();
    updateIconPlay();
    MusikState.load().then(function () {
      state = MusikState.baca();
      return muatPlaylistDanMulai(true);
    }).catch(function () {
      muatPlaylistDanMulai(true);
    });

    // API publik minimal, dipakai oleh halaman musik.html untuk
    // memberi tahu widget bahwa playlist berubah (tambah/hapus lagu)
    // atau untuk memutar lagu tertentu langsung dari daftar.
    window.MusikPlayerAPI = {
      refreshPlaylist: function () { return muatPlaylistDanMulai(false); },
      putarLagu: function (id) {
        state.laguAktifId = id;
        state.posisiDetik = 0;
        muatLagu(id, true, 0);
        siarkanState();
      },
      putar: putar,
      jeda: jeda,
      getState: function () { return Object.assign({}, state); },
      getPlaylist: function () { return playlist.slice(); },
      broadcastPlaylistBerubah: function () {
        if (channel) { try { channel.postMessage({ tipe: "playlist-berubah" }); } catch (e) {} }
      }
    };
  }

  function mulai() {
    suntikCss();
    buatWidget();
    initController();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mulai);
  } else {
    mulai();
  }

  // Ekspos lapisan DB supaya halaman musik.html bisa mengelola playlist
  // (tambah / hapus / urutkan) tanpa menulis ulang logika IndexedDB.
  window.MusikDB = MusikDB;
})();
