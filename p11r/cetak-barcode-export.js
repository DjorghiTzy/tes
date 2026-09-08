// ============================================================
// Ekspor Label: warna per Lokasi Rak (mirip conditional formatting
// Excel) + unduh PDF / DOCX.
// Ukuran fisik label tetap presisi: tinggi 3 cm, lebar 10 cm.
// ============================================================

const CB_WARNA_MAP_KEY = "log-kegiatan-barcode-warna-map";
const CB_DEFAULT_WARNA = "#c00000";

// ------------------------------------------------------------
// 1) Peta warna per lokasi: { "C1": "#2f6fed", "C2": "#c00000", ... }
//    Disimpan di localStorage, dipakai oleh preview/antrean/riwayat/
//    cetak/ekspor.
// ------------------------------------------------------------

let cbWarnaMapCache = {};

function cbGetWarnaMap() {
  return cbWarnaMapCache;
}

function cbSaveWarnaMap(map) {
  cbWarnaMapCache = map;
  if (window.KegiatanAPI) {
    window.KegiatanAPI.saveData("barcode_warna_map", map).catch((err) => console.error("Gagal menyimpan peta warna lokasi:", err));
  }
}

async function cbLoadWarnaMap() {
  let local = {};
  try {
    const raw = localStorage.getItem(CB_WARNA_MAP_KEY);
    local = raw ? JSON.parse(raw) : {};
  } catch (_) {}

  if (!window.KegiatanAPI) { cbWarnaMapCache = local; return; }
  const result = await window.KegiatanAPI.getData("barcode_warna_map", local);
  cbWarnaMapCache = result.offline ? local : (result.data || {});
  if (!result.offline && !result.exists && Object.keys(local).length) {
    await window.KegiatanAPI.saveData("barcode_warna_map", cbWarnaMapCache);
  }
  try { localStorage.setItem(CB_WARNA_MAP_KEY, JSON.stringify(cbWarnaMapCache)); } catch (_) {}
}

// Kunci lokasi dinormalisasi (uppercase, trim) supaya "c2" dan "C2"
// dianggap lokasi yang sama, sesuai cara lokasi ditampilkan di label.
function cbNormLokasi(lokasi) {
  return String(lokasi || "").trim().toUpperCase();
}

function cbGetWarnaUntukLokasi(lokasi) {
  const key = cbNormLokasi(lokasi);
  if (!key) return CB_DEFAULT_WARNA;
  const map = cbGetWarnaMap();
  return map[key] || CB_DEFAULT_WARNA;
}

function cbSetWarnaUntukLokasi(lokasi, hex) {
  const key = cbNormLokasi(lokasi);
  if (!key) return;
  const map = cbGetWarnaMap();
  map[key] = hex;
  cbSaveWarnaMap(map);
  if (typeof cbSyncWarnaInlineDenganLokasi === "function") cbSyncWarnaInlineDenganLokasi();
  if (typeof updatePreview === "function") updatePreview();
  if (typeof renderQueue === "function") renderQueue();
  if (typeof renderRiwayat === "function") renderRiwayat();
}

function cbHapusWarnaLokasi(lokasi) {
  const key = cbNormLokasi(lokasi);
  const map = cbGetWarnaMap();
  delete map[key];
  cbSaveWarnaMap(map);
  if (typeof cbSyncWarnaInlineDenganLokasi === "function") cbSyncWarnaInlineDenganLokasi();
  if (typeof updatePreview === "function") updatePreview();
  if (typeof renderQueue === "function") renderQueue();
  if (typeof renderRiwayat === "function") renderRiwayat();
}

// Terapkan warna ke preview label, item antrean, dan item riwayat yang
// cocok dengan lokasi tsb. Kalau lokasi masih kosong, warna tetap
// diterapkan ke kotak preview label saja (murni visual, belum terikat
// ke kode lokasi manapun).
window.cbWarnaPreviewManual = false;

function cbPreviewWarnaSementara(lokasi, hex) {
  const key = cbNormLokasi(lokasi);
  const labelLeftEl = document.querySelector("#label-preview .cb-label-left");
  window.cbWarnaPreviewManual = true;

  if (!key) {
    if (labelLeftEl) labelLeftEl.style.background = hex;
    return;
  }

  const previewLokasiEl = document.getElementById("input-lokasi");
  if (previewLokasiEl && cbNormLokasi(previewLokasiEl.value) === key) {
    if (labelLeftEl) labelLeftEl.style.background = hex;
  }

  document.querySelectorAll(".cb-queue-item-rak, .cb-riwayat-item-rak").forEach((el) => {
    if (cbNormLokasi(el.textContent) === key) {
      el.style.background = hex;
    }
  });
}

// ------------------------------------------------------------
// 1b) Color picker warna lokasi, ditempatkan di kolom kanan (pratinjau).
//     Bisa dipakai kapan saja untuk mengubah warna kotak label secara
//     langsung; kalau kolom Lokasi Rak sudah diisi, warnanya juga bisa
//     disimpan permanen untuk kode lokasi tsb lewat tombol "Simpan".
// ------------------------------------------------------------
function cbSyncWarnaInlineDenganLokasi() {
  const inputLokasi = document.getElementById("input-lokasi");
  const inputWarnaInline = document.getElementById("input-warna-inline");
  if (!inputLokasi || !inputWarnaInline) return;
  const kode = inputLokasi.value.trim();
  inputWarnaInline.dataset.lokasiAktif = kode;
  inputWarnaInline.value = kode ? cbGetWarnaUntukLokasi(kode) : CB_DEFAULT_WARNA;
}

document.addEventListener("DOMContentLoaded", async () => {
  try { await cbLoadWarnaMap(); } catch (error) { console.error(error); }
  // Bersihkan sisa data lama: versi sebelumnya sempat memungkinkan warna
  // tersimpan untuk kode lokasi kosong ("") kalau tombol tambah warna
  // diklik sebelum kolom lokasi diisi. Hapus supaya tidak "bocor" jadi
  // warna default palsu.
  (function cbBersihkanWarnaKosong() {
    const map = cbGetWarnaMap();
    if (Object.prototype.hasOwnProperty.call(map, "")) {
      delete map[""];
      cbSaveWarnaMap(map);
    }
  })();

  const inputLokasi = document.getElementById("input-lokasi");
  const inputWarnaInline = document.getElementById("input-warna-inline");
  const btnWarnaInlineSave = document.getElementById("btn-warna-inline-save");
  const btnWarnaInlineReset = document.getElementById("btn-warna-inline-reset");

  cbSyncWarnaInlineDenganLokasi();

  // Saat kode lokasi di form diketik/berubah, color picker ikut
  // menampilkan warna lokasi tsb (kalau sudah pernah disimpan), dan
  // tombol "Simpan" disembunyikan lagi karena belum ada perubahan baru.
  if (inputLokasi) {
    inputLokasi.addEventListener("input", () => {
      window.cbWarnaPreviewManual = false;
      cbSyncWarnaInlineDenganLokasi();
      if (btnWarnaInlineSave) btnWarnaInlineSave.hidden = true;
    });
  }

  // Geser warna (event "input", terus-menerus saat drag): SELALU langsung
  // mengubah pratinjau di layar secara real-time, apa pun isi kolom
  // Lokasi Rak. Tombol "Simpan" hanya muncul kalau ada kode lokasi yang
  // bisa dijadikan tempat menyimpan warna itu secara permanen.
  if (inputWarnaInline) {
    inputWarnaInline.addEventListener("input", () => {
      const kode = inputWarnaInline.dataset.lokasiAktif || (inputLokasi ? inputLokasi.value.trim() : "");
      cbPreviewWarnaSementara(kode, inputWarnaInline.value);
      if (btnWarnaInlineSave) {
        if (!kode) {
          btnWarnaInlineSave.hidden = true;
        } else {
          const warnaTersimpan = cbGetWarnaUntukLokasi(kode).toLowerCase();
          btnWarnaInlineSave.hidden = inputWarnaInline.value.toLowerCase() === warnaTersimpan;
        }
      }
    });
  }

  // Tombol "Simpan": baru di titik inilah warna benar-benar ditulis ke
  // localStorage, supaya tersimpan permanen untuk lokasi tsb.
  if (btnWarnaInlineSave) {
    btnWarnaInlineSave.addEventListener("click", () => {
      const kode = inputWarnaInline.dataset.lokasiAktif || (inputLokasi ? inputLokasi.value.trim() : "");
      if (!kode) {
        if (typeof showToast === "function") showToast("Isi dulu kode lokasi rak di form");
        return;
      }
      cbSetWarnaUntukLokasi(kode, inputWarnaInline.value);
      window.cbWarnaPreviewManual = false;
      btnWarnaInlineSave.hidden = true;
      if (typeof showToast === "function") showToast(`Warna untuk lokasi "${cbNormLokasi(kode)}" disimpan`);
    });
  }

  if (btnWarnaInlineReset) {
    btnWarnaInlineReset.addEventListener("click", () => {
      const kode = inputWarnaInline ? (inputWarnaInline.dataset.lokasiAktif || (inputLokasi ? inputLokasi.value.trim() : "")) : "";
      window.cbWarnaPreviewManual = false;
      if (!kode) {
        cbSyncWarnaInlineDenganLokasi();
        if (btnWarnaInlineSave) btnWarnaInlineSave.hidden = true;
        return;
      }
      cbHapusWarnaLokasi(kode);
      cbSyncWarnaInlineDenganLokasi();
      if (btnWarnaInlineSave) btnWarnaInlineSave.hidden = true;
    });
  }

  // ------------------------------------------------------------
  // 2) Modal pilih format ekspor
  // ------------------------------------------------------------
  const btnExport = document.getElementById("btn-export");
  const exportModal = document.getElementById("export-modal");
  const exportCancel = document.getElementById("export-cancel");
  const exportPdfBtn = document.getElementById("export-pdf");
  const exportDocxBtn = document.getElementById("export-docx");

  function getQueueSafely() {
    try { return typeof queue !== "undefined" ? queue.slice() : []; } catch (_) { return []; }
  }

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      const items = getQueueSafely();
      if (!items.length) {
        if (typeof showToast === "function") {
          showToast("Antrean cetak kosong, tidak ada label untuk diekspor");
        } else {
          alert("Antrean cetak kosong, tidak ada label untuk diekspor");
        }
        return;
      }
      exportModal.classList.add("show");
    });
  }

  if (exportCancel) {
    exportCancel.addEventListener("click", () => {
      exportModal.classList.remove("show");
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", async () => {
      exportModal.classList.remove("show");
      const items = getQueueSafely();
      if (!items.length) return;
      try {
        await cbExportPdf(items);
      } catch (err) {
        console.error("Gagal membuat PDF:", err);
        alert("Gagal membuat PDF: " + err.message);
      }
    });
  }

  if (exportDocxBtn) {
    exportDocxBtn.addEventListener("click", async () => {
      exportModal.classList.remove("show");
      const items = getQueueSafely();
      if (!items.length) return;
      try {
        await cbExportDocx(items);
      } catch (err) {
        console.error("Gagal membuat DOCX:", err);
        alert("Gagal membuat DOCX: " + err.message);
      }
    });
  }
});

// ------------------------------------------------------------
// Util bersama: buat PNG barcode (data URL) dari kode EAN/CODE128
// menggunakan JsBarcode -> canvas, supaya bisa disisipkan sebagai
// gambar baik di PDF maupun DOCX.
// ------------------------------------------------------------

function cbBuatBarcodePng(kode) {
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, kode, {
      format: /^\d{13}$/.test(kode) ? "EAN13" : "CODE128",
      displayValue: false,
      margin: 0,
      height: 120,
      background: "#ffffff",
    });
  } catch (err) {
    // fallback CODE128 jika EAN13 gagal (mis. check digit tidak pas)
    JsBarcode(canvas, kode, {
      format: "CODE128",
      displayValue: false,
      margin: 0,
      height: 120,
      background: "#ffffff",
    });
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

function cbHexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function cbTanggalHariIni() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Baca pengaturan font/warna font (2 section) dari cetak-barcode-style.js.
// Kalau file itu tidak dimuat untuk alasan apa pun, pakai default supaya
// ekspor PDF/DOCX tetap jalan seperti sebelumnya.
function cbGetStyleUntukEkspor() {
  if (typeof cbGetStyle === "function") return cbGetStyle();
  return {
    kiriFont: "Arial, Helvetica, sans-serif",
    kiriWarnaFont: "#ffffff",
    kananFont: "Arial, Helvetica, sans-serif",
    kananWarnaFont: "#000000",
  };
}

// jsPDF hanya menerima keluarga font bawaan (helvetica/times/courier).
// Petakan pilihan CSS di panel pengaturan ke font PDF terdekat yang valid.
function cbCssFontKeJsPdf(cssFont) {
  const f = String(cssFont || "").toLowerCase();
  if (f.includes("times") || f.includes("georgia")) return "times";
  if (f.includes("courier")) return "courier";
  return "helvetica"; // Arial, Verdana, Tahoma, Segoe UI, Trebuchet -> helvetica (paling dekat)
}

// ------------------------------------------------------------
// PDF — satu halaman berukuran persis 10cm x 3cm per label,
// menggunakan jsPDF (window.jspdf.jsPDF).
// ------------------------------------------------------------

async function cbExportPdf(items) {
  const { jsPDF } = window.jspdf;
  const LEBAR = 10; // cm
  const TINGGI = 3; // cm

  const style = cbGetStyleUntukEkspor();
  const kiriFontPdf = cbCssFontKeJsPdf(style.kiriFont);
  const kananFontPdf = cbCssFontKeJsPdf(style.kananFont);
  const kiriWarnaRgb = cbHexToRgb(style.kiriWarnaFont);
  const kananWarnaRgb = cbHexToRgb(style.kananWarnaFont);

  const doc = new jsPDF({
    unit: "cm",
    format: [LEBAR, TINGGI],
    orientation: "landscape",
  });

  items.forEach((item, idx) => {
    if (idx > 0) doc.addPage([LEBAR, TINGGI], "landscape");

    const rgb = cbHexToRgb(cbGetWarnaUntukLokasi(item.lokasi));

    // Kotak lokasi rak (kiri, 28% lebar) — Section 1: font & warna font
    const kolomKiriLebar = LEBAR * 0.28;
    doc.setFillColor(rgb.r, rgb.g, rgb.b);
    doc.rect(0, 0, kolomKiriLebar, TINGGI, "F");

    doc.setTextColor(kiriWarnaRgb.r, kiriWarnaRgb.g, kiriWarnaRgb.b);
    doc.setFont(kiriFontPdf, "bold");
    doc.setFontSize(6.5);
    doc.text("LOKASI RAK", kolomKiriLebar / 2, 0.55, { align: "center" });

    doc.setDrawColor(kiriWarnaRgb.r, kiriWarnaRgb.g, kiriWarnaRgb.b);
    doc.setLineWidth(0.02);
    doc.line(kolomKiriLebar * 0.15, 0.75, kolomKiriLebar * 0.85, 0.75);

    doc.setFontSize(item.lokasi.length > 3 ? 14 : 20);
    doc.text(String(item.lokasi), kolomKiriLebar / 2, TINGGI / 2 + 0.35, {
      align: "center",
      maxWidth: kolomKiriLebar - 0.2,
    });

    // Kolom kanan: info barang + barcode — Section 2: font & warna font
    const kananX = kolomKiriLebar + 0.35;
    const kananLebar = LEBAR - kolomKiriLebar - 0.55;

    doc.setTextColor(kananWarnaRgb.r, kananWarnaRgb.g, kananWarnaRgb.b);
    doc.setFont(kananFontPdf, "normal");
    doc.setFontSize(6);
    doc.text(`Tgl: ${cbTanggalHariIni()}`, kananX, 0.35);
    doc.text("PIC: _______", kananX + kananLebar, 0.35, { align: "right" });

    doc.setTextColor(kananWarnaRgb.r, kananWarnaRgb.g, kananWarnaRgb.b);
    doc.setFont(kananFontPdf, "bold");
    doc.setFontSize(11);
    const namaTeks = doc.splitTextToSize(item.nama, kananLebar)[0] || item.nama;
    doc.text(namaTeks, kananX, 0.78);

    // Badge tipe
    doc.setFontSize(6.5);
    const tipeTeks = String(item.tipe).toUpperCase();
    const tipeLebar = doc.getTextWidth(tipeTeks) + 0.3;
    doc.setDrawColor(kananWarnaRgb.r, kananWarnaRgb.g, kananWarnaRgb.b);
    doc.setLineWidth(0.015);
    doc.rect(kananX, 0.92, tipeLebar, 0.34);
    doc.text(tipeTeks, kananX + tipeLebar / 2, 1.15, { align: "center" });

    // Barcode (gambar PNG)
    const { dataUrl, width, height } = cbBuatBarcodePng(item.kode);
    const bcTinggi = 0.85;
    const bcLebar = kananLebar;
    const rasio = width / height;
    let drawW = bcLebar;
    let drawH = drawW / rasio;
    if (drawH > bcTinggi) {
      drawH = bcTinggi;
      drawW = drawH * rasio;
    }
    const bcY = 1.4;
    doc.addImage(dataUrl, "PNG", kananX, bcY, drawW, drawH);

    doc.setFont(kananFontPdf === "helvetica" ? "courier" : kananFontPdf, "normal");
    doc.setFontSize(6.5);
    doc.text(String(item.kode), kananX + kananLebar / 2, bcY + drawH + 0.28, {
      align: "center",
    });
  });

  doc.save(`label-barcode-${Date.now()}.pdf`);
}

// ------------------------------------------------------------
// DOCX — tabel 1x2 di dalam section berukuran persis 10cm x 3cm,
// menggunakan docx.js (window.docx). Satu section per label.
// ------------------------------------------------------------

async function cbExportDocx(items) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    ImageRun,
    AlignmentType,
    VerticalAlign,
    WidthType,
    BorderStyle,
    ShadingType,
    HeightRule,
    TabStopType,
  } = window.docx;

  const CM_TO_TWIP = 566.929; // 1 cm = 566.929 twip (EMU standar Word)
  const LEBAR_TWIP = Math.round(10 * CM_TO_TWIP);
  const TINGGI_TWIP = Math.round(3 * CM_TO_TWIP);
  const KIRI_TWIP = Math.round(LEBAR_TWIP * 0.28);
  const KANAN_TWIP = LEBAR_TWIP - KIRI_TWIP;

  // Pengaturan tampilan (2 section, dari panel "Pengaturan Tampilan Label").
  const style = cbGetStyleUntukEkspor();
  // docx.js butuh nama font tunggal (bukan daftar CSS font-family), ambil
  // font pertama dari daftar dan bersihkan tanda kutip.
  const cbFontDocx = (cssFont) =>
    String(cssFont || "Arial").split(",")[0].replace(/['"]/g, "").trim() || "Arial";
  const kiriFontDocx = cbFontDocx(style.kiriFont);
  const kananFontDocx = cbFontDocx(style.kananFont);
  const kiriWarnaHex = style.kiriWarnaFont.replace("#", "").toUpperCase();
  const kananWarnaHex = style.kananWarnaFont.replace("#", "").toUpperCase();

  const sections = items.map((item) => {
    const warnaTanpaPagar = cbGetWarnaUntukLokasi(item.lokasi).replace("#", "").toUpperCase();

    // --- Sel kiri: kotak warna berisi "LOKASI RAK" + kode lokasi ---
    // Section 1: font & warna font dari panel pengaturan.
    const selKiri = new TableCell({
      width: { size: KIRI_TWIP, type: WidthType.DXA },
      shading: { fill: warnaTanpaPagar, type: ShadingType.CLEAR, color: "auto" },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 60, right: 60 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "LOKASI RAK", bold: true, color: kiriWarnaHex, size: 12, font: kiriFontDocx }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: kiriWarnaHex } },
          children: [new TextRun({ text: "", size: 2 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: String(item.lokasi), bold: true, color: kiriWarnaHex, size: 40, font: kiriFontDocx }),
          ],
        }),
      ],
    });

    // --- Barcode sebagai gambar PNG ---
    const bc = cbBuatBarcodePng(item.kode);
    const bcRasio = bc.width / bc.height;
    const bcTinggiPx = 34;
    const bcLebarPx = Math.round(bcTinggiPx * bcRasio);
    const base64 = bc.dataUrl.split(",")[1];
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);

    // --- Sel kanan: tgl/PIC, nama barang, badge tipe, barcode, angka kode ---
    // Section 2: font & warna font dari panel pengaturan.
    const selKanan = new TableCell({
      width: { size: KANAN_TWIP, type: WidthType.DXA },
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 100, bottom: 60, left: 140, right: 100 },
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: KANAN_TWIP - 260 }],
          children: [
            new TextRun({ text: `Tgl: ${cbTanggalHariIni()}`, size: 10, color: kananWarnaHex, font: kananFontDocx }),
            new TextRun({ text: "\tPIC: _______", size: 10, color: kananWarnaHex, font: kananFontDocx }),
          ],
        }),
        new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: item.nama, bold: true, size: 20, color: kananWarnaHex, font: kananFontDocx })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: kananWarnaHex },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: kananWarnaHex },
            left: { style: BorderStyle.SINGLE, size: 6, color: kananWarnaHex },
            right: { style: BorderStyle.SINGLE, size: 6, color: kananWarnaHex },
          },
          children: [
            new TextRun({ text: `  ${String(item.tipe).toUpperCase()}  `, bold: true, size: 13, color: kananWarnaHex, font: kananFontDocx }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: byteArray,
              transformation: { width: bcLebarPx, height: bcTinggiPx },
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: String(item.kode), size: 13, font: kananFontDocx, color: kananWarnaHex })],
        }),
      ],
    });

    const tabel = new Table({
      width: { size: LEBAR_TWIP, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        left: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [
        new TableRow({
          height: { value: TINGGI_TWIP - 40, rule: HeightRule.EXACT },
          children: [selKiri, selKanan],
        }),
      ],
    });

    return {
      properties: {
        page: {
          size: { width: LEBAR_TWIP, height: TINGGI_TWIP },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: [tabel],
    };
  });

  const doc = new Document({ sections });
  const blob = await Packer.toBlob(doc);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `label-barcode-${Date.now()}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
