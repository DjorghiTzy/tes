// ============================================================
// musik.js
// Logika halaman "Musik" (musik.html): impor file, tampilkan
// daftar putar, hapus lagu, dan pilih lagu untuk diputar.
//
// Penyimpanan file lagu memakai IndexedDB lewat window.MusikDB
// yang disediakan oleh musik-player.js (di-include lebih dulu
// di musik.html). Status "sedang diputar yang mana" & kontrol
// play/pause/next dikendalikan oleh widget floating yang sama
// lewat window.MusikPlayerAPI.
// ============================================================

let pendingHapusId = null;

const FORMAT_DIDUKUNG = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac"];
const EKSTENSI_DIDUKUNG = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];

function formatUkuran(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function isFormatDidukung(file) {
  if (FORMAT_DIDUKUNG.indexOf(file.type) !== -1) return true;
  const nama = file.name.toLowerCase();
  return EKSTENSI_DIDUKUNG.some((ext) => nama.endsWith(ext));
}

// ============================================================
// Render daftar putar
// ============================================================

function iconPlaySvg() {
  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
}

function iconPauseSvg() {
  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
}

function iconHapusSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>';
}

async function renderDaftarPutar() {
  const list = document.getElementById("musik-list");
  const empty = document.getElementById("musik-empty");

  const playlist = await window.MusikDB.ambilSemua();
  const state = window.MusikPlayerAPI ? window.MusikPlayerAPI.getState() : { laguAktifId: null, sedangPutar: false };

  if (playlist.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  list.innerHTML = playlist.map((lagu) => {
    const aktif = lagu.id === state.laguAktifId;
    const sedangPutarLaguIni = aktif && state.sedangPutar;
    const namaTanpaEkstensi = lagu.nama.replace(/\.[a-zA-Z0-9]+$/, "");
    return `
      <div class="musik-item ${aktif ? "is-aktif" : ""}" data-id="${lagu.id}">
        <button class="musik-item-play" data-aksi="toggle-play" title="${sedangPutarLaguIni ? "Jeda" : "Putar"}">
          ${sedangPutarLaguIni ? iconPauseSvg() : iconPlaySvg()}
        </button>
        <div class="musik-item-info">
          <div class="musik-item-nama">${escapeHtml(namaTanpaEkstensi)}</div>
          <div class="musik-item-meta">${formatUkuran(lagu.ukuran)}</div>
        </div>
        <button class="musik-item-hapus" data-aksi="hapus" title="Hapus lagu">
          ${iconHapusSvg()}
        </button>
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Impor file musik -> unggah ke Vercel Blob + metadata ke database
// ============================================================

async function handleImportMusik(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const progressBar = document.getElementById("musik-progress-bar");
  const progressFill = document.getElementById("musik-progress-bar-fill");
  progressBar.classList.add("show");

  const existing = await window.MusikDB.ambilSemua();
  let urutan = existing.length;
  let berhasil = 0;
  let ditolak = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progressFill.style.width = Math.round(((i) / files.length) * 100) + "%";

    if (!isFormatDidukung(file)) {
      ditolak.push(file.name);
      continue;
    }

    try {
      await window.MusikDB.tambahLagu(file, {
        nama: file.name,
        tipe: file.type || "audio/mpeg",
        ukuran: file.size,
        urutan: urutan++
      });
      berhasil++;
    } catch (error) {
      console.error(error);
      ditolak.push(file.name + " (gagal upload)");
    }
  }

  progressFill.style.width = "100%";
  setTimeout(() => {
    progressBar.classList.remove("show");
    progressFill.style.width = "0%";
  }, 400);

  e.target.value = "";

  if (berhasil > 0) {
    showToast(berhasil === 1 ? "1 lagu berhasil diimpor" : berhasil + " lagu berhasil diimpor");
    if (window.MusikPlayerAPI) {
      await window.MusikPlayerAPI.refreshPlaylist();
      window.MusikPlayerAPI.broadcastPlaylistBerubah();
    }
  }
  if (ditolak.length > 0) {
    showToast("Format tidak didukung: " + ditolak.join(", "));
  }

  renderDaftarPutar();
}

// ============================================================
// Aksi pada item playlist (klik play / hapus)
// ============================================================

function handleKlikList(e) {
  const itemEl = e.target.closest(".musik-item");
  if (!itemEl) return;
  const id = itemEl.getAttribute("data-id");

  const aksiEl = e.target.closest("[data-aksi]");
  if (!aksiEl) return;
  const aksi = aksiEl.getAttribute("data-aksi");

  if (aksi === "toggle-play") {
    handleTogglePlay(id);
  } else if (aksi === "hapus") {
    pendingHapusId = id;
    const nama = itemEl.querySelector(".musik-item-nama").textContent;
    document.getElementById("confirm-message").textContent = 'Yakin ingin menghapus "' + nama + '"?';
    document.getElementById("confirm-modal").classList.add("show");
    requestAnimationFrame(() => {
      document.getElementById("confirm-ok").focus();
    });
  }
}

function handleTogglePlay(id) {
  if (!window.MusikPlayerAPI) return;
  const state = window.MusikPlayerAPI.getState();
  if (state.laguAktifId === id && state.sedangPutar) {
    window.MusikPlayerAPI.jeda();
  } else if (state.laguAktifId === id && !state.sedangPutar) {
    window.MusikPlayerAPI.putar();
  } else {
    window.MusikPlayerAPI.putarLagu(id);
  }
  // Beri sedikit waktu agar status "sedang putar" ter-update sebelum re-render.
  setTimeout(renderDaftarPutar, 150);
}

async function handleHapusKonfirmasi() {
  if (!pendingHapusId) return;
  const state = window.MusikPlayerAPI ? window.MusikPlayerAPI.getState() : {};
  const sedangDihapusAdalahLaguAktif = state.laguAktifId === pendingHapusId;

  await window.MusikDB.hapusLagu(pendingHapusId);
  pendingHapusId = null;
  document.getElementById("confirm-modal").classList.remove("show");

  showToast("Lagu dihapus");

  if (window.MusikPlayerAPI) {
    await window.MusikPlayerAPI.refreshPlaylist();
    window.MusikPlayerAPI.broadcastPlaylistBerubah();
  }
  renderDaftarPutar();

  if (sedangDihapusAdalahLaguAktif) {
    showToast("Melanjutkan ke lagu berikutnya");
  }
}

// ============================================================
// Toast (pola sama dengan app.js)
// ============================================================

let toastTimeout;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// ============================================================
// Inisialisasi
// ============================================================

function initMusikPage() {
  document.getElementById("musik-file-input").addEventListener("change", handleImportMusik);
  document.getElementById("musik-list").addEventListener("click", handleKlikList);

  document.getElementById("confirm-cancel").addEventListener("click", () => {
    pendingHapusId = null;
    document.getElementById("confirm-modal").classList.remove("show");
  });
  document.getElementById("confirm-ok").addEventListener("click", handleHapusKonfirmasi);

  // musik-player.js menyiapkan window.MusikPlayerAPI & window.MusikDB secara
  // sinkron saat DOMContentLoaded, tapi kalau suatu saat urutan pemuatan
  // berubah, jaga-jaga dengan menunggu sebentar sebelum render pertama.
  async function migrasiDanRender() {
    try {
      if (window.MusikDB && window.MusikDB.migrasiLegacy) {
        const migrated = await window.MusikDB.migrasiLegacy();
        if (migrated && window.MusikPlayerAPI) await window.MusikPlayerAPI.refreshPlaylist();
      }
    } catch (error) {
      console.warn("Migrasi musik lokal dilewati:", error);
    }
    renderDaftarPutar();
  }

  function tungguDanRender(percobaan) {
    if ((window.MusikDB && window.MusikPlayerAPI) || percobaan > 20) {
      migrasiDanRender();
      return;
    }
    setTimeout(() => tungguDanRender(percobaan + 1), 50);
  }
  tungguDanRender(0);

  // Perbarui tampilan daftar (ikon play/pause & item aktif) setiap kali
  // status pemutar berubah dari widget floating, tanpa perlu reload.
  setInterval(renderDaftarPutar, 2000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMusikPage);
} else {
  initMusikPage();
}
