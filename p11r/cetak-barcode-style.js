// ============================================================
// Pengaturan Tampilan Label — 2 section independen:
//   1) Kotak "LOKASI RAK" (kiri)   -> font family + warna font
//   2) Info Barang (kanan)          -> font family + warna font
// Disimpan di localStorage, berlaku global untuk SEMUA label
// (preview, antrean, riwayat, cetak, ekspor PDF, ekspor DOCX).
// Warna KOTAK "Lokasi Rak" (background) tetap diatur per-lokasi
// lewat mekanisme yang sudah ada di cetak-barcode-export.js
// (cbGetWarnaUntukLokasi) — TIDAK diubah oleh file ini.
// ============================================================

const CB_STYLE_KEY = "log-kegiatan-barcode-style";

const CB_STYLE_DEFAULT = {
  kiriFont: "Arial, Helvetica, sans-serif",
  kiriWarnaFont: "#ffffff",
  kananFont: "Arial, Helvetica, sans-serif",
  kananWarnaFont: "#000000",
};

function cbGetStyle() {
  try {
    const raw = localStorage.getItem(CB_STYLE_KEY);
    if (!raw) return { ...CB_STYLE_DEFAULT };
    return { ...CB_STYLE_DEFAULT, ...JSON.parse(raw) };
  } catch (err) { return { ...CB_STYLE_DEFAULT }; }
}

function cbSaveStyle(style) {
  try { localStorage.setItem(CB_STYLE_KEY, JSON.stringify(style)); } catch (_) {}
  if (window.KegiatanAPI) {
    window.KegiatanAPI.saveData("barcode_style", style).catch(console.error);
  }
}

async function cbLoadStyleFromServer() {
  const local = cbGetStyle();
  if (!window.KegiatanAPI) return local;
  const result = await window.KegiatanAPI.getData("barcode_style", local);
  const style = result.offline ? local : (result.exists ? { ...CB_STYLE_DEFAULT, ...result.data } : local);
  if (!result.offline && !result.exists && JSON.stringify(style) !== JSON.stringify(CB_STYLE_DEFAULT)) {
    await window.KegiatanAPI.saveData("barcode_style", style);
  }
  try { localStorage.setItem(CB_STYLE_KEY, JSON.stringify(style)); } catch (_) {}
  return style;
}

// Terapkan style tersimpan ke variabel CSS pada label preview (dan area
// cetak, kalau sedang dirender). Dipanggil saat halaman dimuat & setiap
// kali salah satu kontrol di panel berubah.
function cbTerapkanStyleKeCss(style) {
  const root = document.documentElement;
  root.style.setProperty("--cb-kiri-font", style.kiriFont);
  root.style.setProperty("--cb-kiri-warna-font", style.kiriWarnaFont);
  root.style.setProperty("--cb-kanan-font", style.kananFont);
  root.style.setProperty("--cb-kanan-warna-font", style.kananWarnaFont);
}

document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("cb-style-panel");
  const toggleBtn = document.getElementById("cb-style-panel-toggle");
  const body = document.getElementById("cb-style-panel-body");

  const selKiriFont = document.getElementById("style-kiri-font");
  const selKiriWarna = document.getElementById("style-kiri-warna-font");
  const selKananFont = document.getElementById("style-kanan-font");
  const selKananWarna = document.getElementById("style-kanan-warna-font");
  const btnReset = document.getElementById("btn-style-reset");

  async function muatDanTerapkan() {
    const style = await cbLoadStyleFromServer();
    cbTerapkanStyleKeCss(style);
    if (selKiriFont) selKiriFont.value = style.kiriFont;
    if (selKiriWarna) selKiriWarna.value = style.kiriWarnaFont;
    if (selKananFont) selKananFont.value = style.kananFont;
    if (selKananWarna) selKananWarna.value = style.kananWarnaFont;
  }

  muatDanTerapkan().catch(console.error);

  // Buka/tutup panel (accordion sederhana, supaya form utama tidak penuh).
  if (toggleBtn && body && panel) {
    toggleBtn.addEventListener("click", () => {
      const sedangTerbuka = !body.hidden;
      body.hidden = sedangTerbuka;
      panel.classList.toggle("open", !sedangTerbuka);
    });
  }

  function simpanDariForm() {
    const style = {
      kiriFont: selKiriFont ? selKiriFont.value : CB_STYLE_DEFAULT.kiriFont,
      kiriWarnaFont: selKiriWarna ? selKiriWarna.value : CB_STYLE_DEFAULT.kiriWarnaFont,
      kananFont: selKananFont ? selKananFont.value : CB_STYLE_DEFAULT.kananFont,
      kananWarnaFont: selKananWarna ? selKananWarna.value : CB_STYLE_DEFAULT.kananWarnaFont,
    };
    cbSaveStyle(style);
    cbTerapkanStyleKeCss(style);
  }

  // Section 1: Kotak "LOKASI RAK"
  if (selKiriFont) selKiriFont.addEventListener("change", simpanDariForm);
  if (selKiriWarna) selKiriWarna.addEventListener("input", simpanDariForm);

  // Section 2: Info Barang (kanan)
  if (selKananFont) selKananFont.addEventListener("change", simpanDariForm);
  if (selKananWarna) selKananWarna.addEventListener("input", simpanDariForm);

  // Kembalikan ke default (kedua section sekaligus).
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      cbSaveStyle({ ...CB_STYLE_DEFAULT });
      muatDanTerapkan();
      if (typeof showToast === "function") showToast("Tampilan label dikembalikan ke default");
    });
  }
});
