// ============================================================
// Konfigurasi dasar
// ============================================================

const CB_QUEUE_KEY = "log-kegiatan-barcode-queue";
const CB_RIWAYAT_KEY = "log-kegiatan-barcode-riwayat";
const CB_MAX_RIWAYAT = 200;

// Struktur satu item SKU:
// { id, lokasi, nama, tipe, kode, dibuatPada }

let queue = [];
let riwayat = [];
let pendingConfirmAction = null;

// ============================================================
// Storage server (dengan cache lokal sebagai fallback/offline)
// ============================================================

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) { return fallback; }
}

function loadQueue() { return readLocalJson(CB_QUEUE_KEY, []); }
function loadRiwayat() { return readLocalJson(CB_RIWAYAT_KEY, []); }

function saveQueue() {
  try { localStorage.setItem(CB_QUEUE_KEY, JSON.stringify(queue)); } catch (_) {}
  window.KegiatanAPI.saveData("barcode_queue", queue).catch((err) => console.error("Gagal menyimpan antrean:", err));
}

function saveRiwayat() {
  try { localStorage.setItem(CB_RIWAYAT_KEY, JSON.stringify(riwayat)); } catch (_) {}
  window.KegiatanAPI.saveData("barcode_history", riwayat).catch((err) => console.error("Gagal menyimpan riwayat:", err));
}

async function bootstrapBarcodeData() {
  const localQueue = loadQueue();
  const localHistory = loadRiwayat();
  const [queueResult, historyResult] = await Promise.all([
    window.KegiatanAPI.getData("barcode_queue", localQueue),
    window.KegiatanAPI.getData("barcode_history", localHistory),
  ]);

  queue = queueResult.offline ? localQueue : (queueResult.exists ? queueResult.data : localQueue);
  riwayat = historyResult.offline ? localHistory : (historyResult.exists ? historyResult.data : localHistory);

  if (!queueResult.offline && !queueResult.exists && localQueue.length) await window.KegiatanAPI.saveData("barcode_queue", queue);
  if (!historyResult.offline && !historyResult.exists && localHistory.length) await window.KegiatanAPI.saveData("barcode_history", riwayat);

  renderQueue();
  renderRiwayat();
}

// ============================================================
// Validasi
// ============================================================

// EAN-13: 13 digit, dan digit terakhir harus sesuai check digit standar.
// Fungsi ini memvalidasi PANJANG & ANGKA saja secara longgar (12-13 digit
// diterima, 13 digit dianggap lengkap dengan check digit) supaya tidak
// menolak barcode asli dari kemasan karena selisih perhitungan checksum
// yang jarang terjadi pada barang re-pack/import.
function isValidBarcodeDigits(value) {
  return /^\d{12,13}$/.test(value);
}

function validateField(name, value) {
  switch (name) {
    case "lokasi":
      if (!value.trim()) return "Lokasi rak wajib diisi.";
      if (value.trim().length > 12) return "Lokasi rak terlalu panjang.";
      return "";
    case "nama":
      if (!value.trim()) return "Nama barang wajib diisi.";
      return "";
    case "tipe":
      if (!value.trim()) return "Tipe wajib dipilih atau diisi.";
      return "";
    case "kode":
      if (!value.trim()) return "Kode barcode wajib diisi.";
      if (!isValidBarcodeDigits(value.trim())) return "Kode harus berupa 12-13 digit angka.";
      return "";
    default:
      return "";
  }
}

// ============================================================
// Elemen DOM (form)
// ============================================================

const form = document.getElementById("barcode-form");
const inputLokasi = document.getElementById("input-lokasi");
const inputNama = document.getElementById("input-nama");
const selectTipe = document.getElementById("select-tipe");
const inputTipeCustom = document.getElementById("input-tipe-custom");
const inputKode = document.getElementById("input-kode");

const errLokasi = document.getElementById("err-lokasi");
const errNama = document.getElementById("err-nama");
const errTipe = document.getElementById("err-tipe");
const errKode = document.getElementById("err-kode");

const btnResetForm = document.getElementById("btn-reset-form");

// Tempel cepat
const tabForm = document.getElementById("tab-form");
const tabTempel = document.getElementById("tab-tempel");
const panelForm = document.getElementById("panel-form");
const panelTempel = document.getElementById("panel-tempel");
const inputTempel = document.getElementById("input-tempel");
const errTempel = document.getElementById("err-tempel");
const btnProsesTempel = document.getElementById("btn-proses-tempel");
const btnResetTempel = document.getElementById("btn-reset-tempel");

// Preview
const previewLokasi = document.getElementById("preview-lokasi");
const previewNama = document.getElementById("preview-nama");
const previewTipe = document.getElementById("preview-tipe");
const previewKode = document.getElementById("preview-kode");
const previewBarcodeSvg = document.getElementById("preview-barcode-svg");
const previewEmptyNote = document.getElementById("preview-empty-note");

// Aksi setelah simpan
const afterSaveActions = document.getElementById("after-save-actions");
const btnTambahLagi = document.getElementById("btn-tambah-lagi");
const btnSelesaiCetak = document.getElementById("btn-selesai-cetak");

// Sidebar
const queueList = document.getElementById("queue-list");
const queueCount = document.getElementById("queue-count");
const riwayatList = document.getElementById("riwayat-list");
const riwayatCount = document.getElementById("riwayat-count");
const btnClearQueue = document.getElementById("btn-clear-queue");

// ============================================================
// Mode tab: Isi Form <-> Tempel Cepat
// ============================================================

function switchMode(mode) {
  const isForm = mode === "form";
  tabForm.classList.toggle("active", isForm);
  tabTempel.classList.toggle("active", !isForm);
  panelForm.classList.toggle("active", isForm);
  panelTempel.classList.toggle("active", !isForm);
}

tabForm.addEventListener("click", () => switchMode("form"));
tabTempel.addEventListener("click", () => switchMode("tempel"));

// ============================================================
// Tipe: dropdown -> munculkan input custom bila "Isi sendiri"
// ============================================================

selectTipe.addEventListener("change", () => {
  const isCustom = selectTipe.value === "__custom__";
  inputTipeCustom.hidden = !isCustom;
  if (isCustom) {
    inputTipeCustom.focus();
  }
  updatePreview();
});

function getTipeValue() {
  if (selectTipe.value === "__custom__") {
    return inputTipeCustom.value.trim();
  }
  return selectTipe.value || "";
}

// ============================================================
// Parsing mode "Tempel Cepat"
// Format yang diterima (urutan bebas, spasi fleksibel, case-insensitive):
//   Lokasi: C2
//   Nama: Olike Mic1 Tarnish White
//   Tipe: Lifestyle
//   Kode: 8999123456789
// ============================================================

function parseTempelText(text) {
  const result = { lokasi: "", nama: "", tipe: "", kode: "" };
  const lines = text.split(/\r?\n/);

  const patterns = {
    lokasi: /^\s*lokasi\s*[:\-]\s*(.+)$/i,
    nama: /^\s*nama\s*[:\-]\s*(.+)$/i,
    tipe: /^\s*tipe\s*[:\-]\s*(.+)$/i,
    kode: /^\s*kode\s*[:\-]\s*(.+)$/i,
  };

  lines.forEach((line) => {
    for (const key in patterns) {
      const match = line.match(patterns[key]);
      if (match) {
        result[key] = match[1].trim();
      }
    }
  });

  return result;
}

btnProsesTempel.addEventListener("click", () => {
  const text = inputTempel.value;
  if (!text.trim()) {
    showTempelError("Tempel teks terlebih dahulu sebelum diproses.");
    return;
  }

  const parsed = parseTempelText(text);

  if (!parsed.lokasi && !parsed.nama && !parsed.tipe && !parsed.kode) {
    showTempelError("Format tidak dikenali. Pastikan menggunakan format Lokasi/Nama/Tipe/Kode seperti contoh.");
    return;
  }

  // Isikan ke form
  inputLokasi.value = parsed.lokasi;
  inputNama.value = parsed.nama;
  inputKode.value = parsed.kode.replace(/\D/g, "");

  // Cocokkan tipe ke opsi dropdown yang ada (case-insensitive); kalau tidak
  // ketemu, otomatis dialihkan ke opsi "Isi sendiri" berisi teks tersebut.
  const tipeLower = parsed.tipe.toLowerCase();
  let matched = false;
  for (const opt of selectTipe.options) {
    if (opt.value && opt.value !== "__custom__" && opt.value.toLowerCase() === tipeLower) {
      selectTipe.value = opt.value;
      inputTipeCustom.hidden = true;
      matched = true;
      break;
    }
  }
  if (!matched && parsed.tipe) {
    selectTipe.value = "__custom__";
    inputTipeCustom.hidden = false;
    inputTipeCustom.value = parsed.tipe;
  }

  clearTempelError();
  switchMode("form");
  updatePreview();
  showToast("Teks berhasil diproses. Periksa form lalu klik Simpan.");
});

btnResetTempel.addEventListener("click", () => {
  inputTempel.value = "";
  clearTempelError();
});

function showTempelError(message) {
  errTempel.textContent = message;
  errTempel.classList.add("show");
}

function clearTempelError() {
  errTempel.textContent = "";
  errTempel.classList.remove("show");
}

// ============================================================
// Preview label real-time
// ============================================================

function updatePreview() {
  const lokasi = inputLokasi.value.trim();
  const nama = inputNama.value.trim();
  const tipe = getTipeValue();
  const kode = inputKode.value.trim();

  previewLokasi.textContent = lokasi || "—";
  previewNama.textContent = nama || "Nama Barang";
  previewTipe.textContent = tipe || "TIPE";
  previewKode.textContent = kode || "0000000000000";

  // Terapkan warna label sesuai lokasi rak yang sedang diisi (peta warna
  // per lokasi disediakan oleh cetak-barcode-export.js). Dilewati kalau
  // user sedang mem-preview warna secara manual (drag color picker),
  // supaya preview tidak tiba-tiba tertimpa balik saat mengetik field lain.
  const labelLeftEl = document.querySelector("#label-preview .cb-label-left");
  if (labelLeftEl && typeof cbGetWarnaUntukLokasi === "function" && !window.cbWarnaPreviewManual) {
    labelLeftEl.style.background = cbGetWarnaUntukLokasi(lokasi);
  }
  if (typeof cbSyncWarnaInlineDenganLokasi === "function" && !window.cbWarnaPreviewManual) cbSyncWarnaInlineDenganLokasi();

  renderBarcodeSvg(previewBarcodeSvg, kode);

  const hasAny = lokasi || nama || tipe || kode;
  previewEmptyNote.style.display = hasAny ? "none" : "block";
}

function renderBarcodeSvg(svgEl, kode) {
  if (!kode || !isValidBarcodeDigits(kode)) {
    svgEl.innerHTML = "";
    return;
  }

  if (typeof JsBarcode === "undefined") {
    // Library gagal dimuat (file vendor-jsbarcode.min.js hilang / tidak
    // ditemukan). Tampilkan pesan jelas di tempat barcode seharusnya
    // muncul, supaya masalahnya langsung terlihat, bukan diam kosong.
    svgEl.innerHTML =
      '<text x="0" y="20" font-size="10" fill="#d64545">Library barcode tidak termuat (vendor-jsbarcode.min.js)</text>';
    return;
  }

  try {
    JsBarcode(svgEl, kode, {
      format: kode.length === 13 ? "EAN13" : "CODE128",
      displayValue: false,
      margin: 0,
      height: 42,
      background: "transparent",
    });
  } catch (err) {
    // Barcode tidak valid untuk format EAN13 (mis. check digit salah) ->
    // tetap coba tampilkan sebagai CODE128 supaya user tetap dapat pratinjau.
    try {
      JsBarcode(svgEl, kode, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 42,
        background: "transparent",
      });
    } catch (err2) {
      svgEl.innerHTML = "";
    }
  }
}

[inputLokasi, inputNama, inputKode].forEach((el) => {
  el.addEventListener("input", updatePreview);
});
inputTipeCustom.addEventListener("input", updatePreview);

// ============================================================
// Validasi & submit form
// ============================================================

function setFieldError(inputEl, errEl, message) {
  const field = inputEl.closest(".cb-field");
  if (message) {
    errEl.textContent = message;
    errEl.classList.add("show");
    if (field) field.classList.add("has-error");
  } else {
    errEl.textContent = "";
    errEl.classList.remove("show");
    if (field) field.classList.remove("has-error");
  }
}

function validateForm() {
  const lokasi = inputLokasi.value;
  const nama = inputNama.value;
  const tipe = getTipeValue();
  const kode = inputKode.value;

  const eLokasi = validateField("lokasi", lokasi);
  const eNama = validateField("nama", nama);
  const eTipe = validateField("tipe", tipe);
  const eKode = validateField("kode", kode);

  setFieldError(inputLokasi, errLokasi, eLokasi);
  setFieldError(inputNama, errNama, eNama);
  setFieldError(selectTipe, errTipe, eTipe);
  setFieldError(inputKode, errKode, eKode);

  return !eLokasi && !eNama && !eTipe && !eKode;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!validateForm()) {
    showToast("Periksa kembali data yang diisi");
    return;
  }

  const item = {
    id: makeId(),
    lokasi: inputLokasi.value.trim(),
    nama: inputNama.value.trim(),
    tipe: getTipeValue(),
    kode: inputKode.value.trim(),
    dibuatPada: new Date().toISOString(),
  };

  queue.push(item);
  saveQueue();

  riwayat.unshift(item);
  if (riwayat.length > CB_MAX_RIWAYAT) riwayat = riwayat.slice(0, CB_MAX_RIWAYAT);
  saveRiwayat();

  renderQueue();
  renderRiwayat();

  afterSaveActions.hidden = false;
  showToast(`"${item.nama}" berhasil disimpan`);
});

btnResetForm.addEventListener("click", () => {
  resetForm();
});

function resetForm() {
  form.reset();
  inputTipeCustom.hidden = true;
  inputTipeCustom.value = "";
  [inputLokasi, errLokasi, inputNama, errNama, selectTipe, errTipe, inputKode, errKode].forEach(() => {});
  setFieldError(inputLokasi, errLokasi, "");
  setFieldError(inputNama, errNama, "");
  setFieldError(selectTipe, errTipe, "");
  setFieldError(inputKode, errKode, "");
  const btnWarnaInlineSaveEl = document.getElementById("btn-warna-inline-save");
  if (btnWarnaInlineSaveEl) btnWarnaInlineSaveEl.hidden = true;
  window.cbWarnaPreviewManual = false;
  updatePreview();
}

// ============================================================
// Setelah simpan: Tambah SKU lagi / Selesai & Cetak
// ============================================================

btnTambahLagi.addEventListener("click", () => {
  resetForm();
  afterSaveActions.hidden = true;
  inputLokasi.focus();
});

btnSelesaiCetak.addEventListener("click", () => {
  if (queue.length === 0) {
    showToast("Antrean cetak kosong");
    return;
  }
  printQueue();
});

// ============================================================
// Antrean cetak: render, hapus item, kosongkan
// ============================================================

function renderQueue() {
  queueCount.textContent = String(queue.length);

  if (queue.length === 0) {
    queueList.innerHTML = '<div class="cb-queue-empty">Belum ada SKU dalam antrean.</div>';
    return;
  }

  queueList.innerHTML = "";
  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cb-queue-item";
    const warnaRak = typeof cbGetWarnaUntukLokasi === "function" ? cbGetWarnaUntukLokasi(item.lokasi) : "";
    row.innerHTML = `
      <span class="cb-queue-item-rak" style="background:${warnaRak}">${escapeHtml(item.lokasi)}</span>
      <span class="cb-queue-item-info">
        <div class="cb-queue-item-name">${escapeHtml(item.nama)}</div>
        <div class="cb-queue-item-sub">${escapeHtml(item.tipe)} &middot; ${escapeHtml(item.kode)}</div>
      </span>
      <button type="button" class="cb-queue-item-remove" title="Hapus dari antrean" data-id="${item.id}">&#10005;</button>
    `;
    queueList.appendChild(row);
  });

  queueList.querySelectorAll(".cb-queue-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      queue = queue.filter((it) => it.id !== btn.dataset.id);
      saveQueue();
      renderQueue();
    });
  });
}

btnClearQueue.addEventListener("click", () => {
  if (queue.length === 0) {
    showToast("Antrean sudah kosong");
    return;
  }
  askConfirm("Kosongkan seluruh antrean cetak? Data di Riwayat tidak akan terhapus.", () => {
    queue = [];
    saveQueue();
    renderQueue();
    showToast("Antrean cetak dikosongkan");
  });
});

// ============================================================
// Riwayat SKU: render, cetak ulang
// ============================================================

function renderRiwayat() {
  riwayatCount.textContent = String(riwayat.length);

  if (riwayat.length === 0) {
    riwayatList.innerHTML = '<div class="cb-riwayat-empty">Belum ada riwayat SKU.</div>';
    return;
  }

  riwayatList.innerHTML = "";
  riwayat.forEach((item) => {
    const row = document.createElement("div");
    row.className = "cb-riwayat-item";
    const warnaRak = typeof cbGetWarnaUntukLokasi === "function" ? cbGetWarnaUntukLokasi(item.lokasi) : "";
    row.innerHTML = `
      <span class="cb-riwayat-item-rak" style="background:${warnaRak}">${escapeHtml(item.lokasi)}</span>
      <span class="cb-riwayat-item-info">
        <div class="cb-riwayat-item-name">${escapeHtml(item.nama)}</div>
        <div class="cb-riwayat-item-sub">${escapeHtml(item.tipe)} &middot; ${escapeHtml(item.kode)}</div>
      </span>
      <button type="button" class="cb-riwayat-item-reprint" title="Tambahkan ke antrean cetak lagi" data-id="${item.id}">+ Antre</button>
    `;
    riwayatList.appendChild(row);
  });

  riwayatList.querySelectorAll(".cb-riwayat-item-reprint").forEach((btn) => {
    btn.addEventListener("click", () => {
      const original = riwayat.find((it) => it.id === btn.dataset.id);
      if (!original) return;
      const clone = Object.assign({}, original, { id: makeId(), dibuatPada: new Date().toISOString() });
      queue.push(clone);
      saveQueue();
      renderQueue();
      showToast(`"${original.nama}" ditambahkan ke antrean cetak`);
    });
  });
}

// ============================================================
// Cetak: bangun area cetak dari antrean, lalu window.print()
// ============================================================

function printQueue() {
  const printArea = document.getElementById("print-area");
  printArea.innerHTML = "";

  queue.forEach((item) => {
    const label = document.createElement("div");
    label.className = "print-label";
    label.innerHTML = `
      <div class="print-label-left">
        <div class="print-label-rak-title">LOKASI RAK</div>
        <div class="print-label-rak-divider"></div>
        <div class="print-label-rak-code">${escapeHtml(item.lokasi)}</div>
      </div>
      <div class="print-label-right">
        <div class="print-label-topline">
          <span>Tgl: _______</span>
          <span>PIC: _______</span>
        </div>
        <div class="print-label-nama">${escapeHtml(item.nama)}</div>
        <div class="print-label-tipe-badge">${escapeHtml(item.tipe.toUpperCase())}</div>
        <svg class="print-label-barcode-svg" data-kode="${escapeHtml(item.kode)}"></svg>
        <div class="print-label-barcode-number">${escapeHtml(item.kode)}</div>
      </div>
    `;
    printArea.appendChild(label);

    // Terapkan warna sesuai lokasi rak item ini secara langsung lewat JS
    // (pakai setProperty + "important" supaya menang atas !important di CSS).
    const warnaRak = typeof cbGetWarnaUntukLokasi === "function" ? cbGetWarnaUntukLokasi(item.lokasi) : "";
    const kotakKiri = label.querySelector(".print-label-left");
    if (kotakKiri && warnaRak) {
      kotakKiri.style.setProperty("background", warnaRak, "important");
    }
  });

  printArea.querySelectorAll(".print-label-barcode-svg").forEach((svgEl) => {
    renderBarcodeSvg(svgEl, svgEl.dataset.kode);
  });

  // Beri waktu sedikit agar SVG barcode selesai dirender sebelum dialog print muncul.
  setTimeout(() => {
    window.print();
  }, 80);
}

window.addEventListener("afterprint", () => {
  askConfirm("Cetak selesai. Kosongkan antrean sekarang?", () => {
    queue = [];
    saveQueue();
    renderQueue();
    showToast("Antrean cetak dikosongkan");
  });
});

// ============================================================
// Modal konfirmasi (pola sama dengan app.js)
// ============================================================

const confirmModal = document.getElementById("confirm-modal");
const confirmMessage = document.getElementById("confirm-message");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");

function askConfirm(message, onConfirm) {
  confirmMessage.textContent = message;
  pendingConfirmAction = onConfirm;
  confirmModal.classList.add("show");
}

confirmOk.addEventListener("click", () => {
  confirmModal.classList.remove("show");
  if (typeof pendingConfirmAction === "function") pendingConfirmAction();
  pendingConfirmAction = null;
});

confirmCancel.addEventListener("click", () => {
  confirmModal.classList.remove("show");
  pendingConfirmAction = null;
});

// ============================================================
// Toast notifikasi kecil (pola sama dengan app.js)
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
// Util
// ============================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Inisialisasi
// ============================================================

function init() {
  renderQueue();
  renderRiwayat();
  updatePreview();
}

init();


document.addEventListener("DOMContentLoaded", () => { bootstrapBarcodeData().catch(console.error); });
