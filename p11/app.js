// ============================================================
// Konfigurasi dasar
// ============================================================

const STORAGE_KEY = "log-kegiatan-data";
const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// Aplikasi ini khusus untuk Tahun 2026: level "Semua Tahun" pada arsip hanya
// menampilkan tahun ini (tanpa embel-embel apa pun, cukup angka "2026"), dan
// level bulan di bawahnya selalu menampilkan ke-12 bulan Januari-Desember
// secara lengkap walau sebagian bulan belum berisi data sama sekali.
const APP_YEAR = 2026;

// Struktur data yang disimpan di localStorage:
// {
//   "2026-09-07": [ { nama, jamMulai, jamSelesai, selesai }, ... ],
//   "2026-09-08": [ ... ],
//   ...
// }
// Key selalu format YYYY-MM-DD, diurutkan menurun (terbaru di atas)
// saat ditampilkan di sidebar. "selesai" (boolean) menandai kegiatan yang
// sudah dikerjakan -> ditampilkan tercoret (lihat buildActivityCard).

let scheduleData = loadFromStorage();
let activeDate = todayISO();
let pendingConfirmAction = null;

// Lihat bagian "Arsip: navigasi breadcrumb" di bawah untuk penjelasan lengkap.
let archiveLevel = "all";
let archiveSelection = { year: null, month: null, week: null };
initArchiveSelectionFromActiveDate();

// Arah urutan tampilan untuk tiap level arsip ("desc" = besar/terbaru di atas,
// "asc" = kecil/terlama di atas). Disimpan terpisah per level supaya, misalnya,
// urutan Bulan tidak ikut berubah saat pengguna cuma membalik urutan Minggu.
// Ditoggle lewat tombol sort di archive-list-header (lihat renderArchiveListHeader).
// Default "asc" di semua level: tampilan selalu mulai dari yang paling lama/kecil
// (Januari dulu, Minggu 1 dulu, tanggal 1 dulu), bukan dari yang terbaru.
let sortDirection = { year: "asc", month: "asc", week: "asc", day: "asc" };

// ID baris (tanggal atau nomor level) yang menu titik-tiganya sedang terbuka,
// null kalau tidak ada yang terbuka. Dipakai supaya cuma satu menu yang
// terbuka dalam satu waktu.
let openItemMenuId = null;

// ============================================================
// Tanggal: helper format
// ============================================================

function todayISO() {
  return dateToISO(new Date());
}

function dateToISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Menghitung nomor "minggu ke berapa DALAM BULAN itu" untuk sebuah tanggal
// (bukan nomor minggu ISO global seperti 38/39/40). Aturannya sederhana:
// tanggal 1-7 = Minggu 1, 8-14 = Minggu 2, 15-21 = Minggu 3, 22-28 = Minggu 4,
// dan 29-31 (kalau bulan itu lebih dari 28 hari) = Minggu 5.
// Dipakai untuk mengelompokkan tanggal di level "Minggu" pada breadcrumb arsip,
// supaya nomornya selalu kecil (1-5) dan gampang dimengerti, tidak terikat
// hitungan minggu se-tahun.
function weekOfMonthNumber(date) {
  return Math.ceil(date.getDate() / 7);
}

function formatDayName(iso) {
  return NAMA_HARI[isoToDate(iso).getDay()];
}

function formatFullDate(iso) {
  const date = isoToDate(iso);
  return `${date.getDate()} ${NAMA_BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

function formatShortDate(iso) {
  const date = isoToDate(iso);
  return `${date.getDate()} ${NAMA_BULAN[date.getMonth()].slice(0, 3)}`;
}

// ============================================================
// Storage (localStorage)
// ============================================================

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("Gagal membaca cache lokal:", err);
    return {};
  }
}

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleData)); } catch (_) {}
  window.KegiatanAPI.saveData("schedule", scheduleData).catch((err) => {
    console.error("Gagal menyimpan jadwal ke server:", err);
    showToast("Gagal menyimpan ke server");
  });
}

async function bootstrapServerData() {
  const localData = loadFromStorage();
  const result = await window.KegiatanAPI.getData("schedule", localData);

  if (result.offline) {
    scheduleData = localData;
    return;
  }

  if (!result.exists && Object.keys(localData).length > 0) {
    scheduleData = localData;
    await window.KegiatanAPI.saveData("schedule", scheduleData);
  } else {
    scheduleData = result.data || {};
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleData)); } catch (_) {}
}

function pickInitialDate() {
  const dates = sortedDates();
  if (dates.length > 0) return dates[0];
  // Belum ada data sama sekali, mulai dari hari ini
  const today = todayISO();
  scheduleData[today] = [];
  return today;
}

// Dipanggil sekali saat halaman dimuat: kalau URL membawa parameter
// ?date=YYYY-MM-DD (mis. dari klik tanggal di halaman Ringkasan),
// jadikan tanggal itu sebagai activeDate. Kalau tanggal itu belum
// pernah ada datanya, dibuatkan entry kosong dulu supaya tetap bisa
// langsung dibuka dan diisi kegiatannya.
function applyDateFromQueryString() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("date");
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return;

  if (!Object.prototype.hasOwnProperty.call(scheduleData, requested)) {
    scheduleData[requested] = [];
    saveToStorage();
  }
  activeDate = requested;

  // Bersihkan query string dari address bar supaya navigasi/refresh
  // berikutnya tidak "terjebak" terus di tanggal yang sama.
  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);
}

function sortedDates() {
  return Object.keys(scheduleData).sort((a, b) => (a < b ? 1 : -1)); // terbaru dulu
}

// ============================================================
// Arsip: navigasi breadcrumb Tahun > Bulan > Minggu > Hari
// ============================================================
//
// archiveLevel     : level yang sedang ditampilkan di sidebar —
//                    "all" (semua tahun), "year" (bulan-bulan di satu tahun),
//                    "month" (minggu-minggu di satu bulan), atau
//                    "week" (hari-hari di satu minggu, level paling detail).
// archiveSelection : nilai yang sedang dipilih di tiap level (tahun, bulan,
//                    nomor minggu dalam bulan), dipakai untuk memfilter isi & breadcrumb.
//
// Catatan penting: Tahun & Bulan dikelompokkan memakai kalender BIASA
// (date.getFullYear() / date.getMonth()). Nomor "Minggu" juga dihitung
// per-bulan (1-5, lihat weekOfMonthNumber) supaya selalu selaras dengan
// bulan yang sedang dibuka — tidak ada lagi nomor minggu besar (38, 39, dst)
// yang lompat lintas bulan/tahun.
//
// Aplikasi ini hanya menampilkan data untuk Tahun 2026, dengan daftar
// bulan yang selalu lengkap Januari-Desember walau sebagian bulan belum
// ada datanya (lihat renderMonthLevel & renderYearLevel).
//
// (State archiveLevel & archiveSelection dideklarasikan di bagian atas file,
// bersama scheduleData/activeDate, supaya siap dipakai saat inisialisasi awal.)

// Dipanggil setiap kali activeDate berpindah (buat hari baru, hapus hari,
// impor XLSX) supaya breadcrumb selalu ikut menunjuk ke lokasi activeDate
// yang baru, langsung ke level "week" (paling berguna: langsung lihat
// daftar harinya) bukan balik ke level "all" yang butuh klik ulang.
function initArchiveSelectionFromActiveDate() {
  const date = isoToDate(activeDate);
  archiveSelection = {
    year: date.getFullYear(),
    month: date.getMonth(),
    week: weekOfMonthNumber(date)
  };
  archiveLevel = "week";
}

// Mengelompokkan daftar tanggal (ISO) menjadi pohon { tahun: { bulan: { minggu: [iso, ...] } } }.
// tahun & bulan = kalender biasa, minggu = minggu ke-N dalam bulan (lihat weekOfMonthNumber).
function buildArchiveTree(dates) {
  const tree = {};

  dates.forEach(iso => {
    const date = isoToDate(iso);
    const year = date.getFullYear();
    const month = date.getMonth();
    const week = weekOfMonthNumber(date);

    if (!tree[year]) tree[year] = {};
    if (!tree[year][month]) tree[year][month] = {};
    if (!tree[year][month][week]) tree[year][month][week] = [];
    tree[year][month][week].push(iso);
  });

  return tree;
}

function countDaysInYear(tree, year) {
  let count = 0;
  Object.values(tree[year] || {}).forEach(monthObj => {
    Object.values(monthObj).forEach(weekArr => { count += weekArr.length; });
  });
  return count;
}

function countDaysInMonth(tree, year, month) {
  let count = 0;
  Object.values((tree[year] || {})[month] || {}).forEach(weekArr => { count += weekArr.length; });
  return count;
}

function goToArchiveLevel(level) {
  archiveLevel = level;
  closeItemMenu();
  renderDateList();
}

function selectArchiveYear(year) {
  archiveSelection.year = year;
  archiveLevel = "year";
  closeItemMenu();
  renderDateList();
}

function selectArchiveMonth(month) {
  archiveSelection.month = month;
  archiveLevel = "month";
  closeItemMenu();
  renderDateList();
}

function selectArchiveWeek(week) {
  archiveSelection.week = week;
  archiveLevel = "week";
  closeItemMenu();
  renderDateList();
}

// ============================================================
// Render: sidebar breadcrumb + daftar tanggal
// ============================================================

function renderDateList() {
  const dates = sortedDates();
  const tree = buildArchiveTree(dates);

  renderBreadcrumb();
  renderArchiveBody(tree, dates);
}

function renderBreadcrumb() {
  const container = document.getElementById("date-breadcrumb");
  container.innerHTML = "";

  const crumbs = [{ label: "Semua Tahun", level: "all" }];

  if (archiveSelection.year !== null && archiveLevel !== "all") {
    crumbs.push({ label: `${archiveSelection.year}`, level: "year" });
  }
  if (archiveSelection.month !== null && (archiveLevel === "month" || archiveLevel === "week")) {
    crumbs.push({ label: NAMA_BULAN[archiveSelection.month], level: "month" });
  }
  if (archiveSelection.week !== null && archiveLevel === "week") {
    crumbs.push({ label: `Minggu ${archiveSelection.week}`, level: "week" });
  }

  crumbs.forEach((crumb, i) => {
    const isCurrent = i === crumbs.length - 1;

    const btn = document.createElement("button");
    btn.className = "breadcrumb-item" + (isCurrent ? " current" : "");
    btn.textContent = crumb.label;
    btn.addEventListener("click", () => goToArchiveLevel(crumb.level));
    container.appendChild(btn);

    if (!isCurrent) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "\u203a";
      container.appendChild(sep);
    }
  });
}

function renderArchiveBody(tree, dates) {
  const container = document.getElementById("date-list");
  container.innerHTML = "";

  if (dates.length === 0) {
    renderArchiveListHeader(null);
    const empty = document.createElement("div");
    empty.className = "date-list-empty";
    empty.textContent = "Belum ada hari. Klik \"+\" untuk mulai.";
    container.appendChild(empty);
    return;
  }

  if (archiveLevel === "all") {
    renderArchiveListHeader(null); // cuma 1 baris (Tahun 2026), tidak perlu tombol sort
    renderYearLevel(container, tree);
  } else if (archiveLevel === "year") {
    renderArchiveListHeader("month");
    renderMonthLevel(container, tree);
  } else if (archiveLevel === "month") {
    renderArchiveListHeader("week");
    renderWeekLevel(container, tree);
  } else {
    renderArchiveListHeader("day");
    renderDayLevel(container, tree);
  }
}

// Judul kecil + tombol sort (naik/turun) di atas daftar arsip. sortKey null
// artinya level ini cuma berisi 1 baris (mis. "Semua Tahun" -> cuma "2026"),
// sehingga tombol sort tidak ada gunanya dan disembunyikan.
function renderArchiveListHeader(sortKey) {
  const header = document.getElementById("archive-list-header");
  header.innerHTML = "";

  if (!sortKey) return;

  const btn = document.createElement("button");
  btn.className = "btn-sort-toggle";
  btn.title = "Balik urutan tampilan";

  const isAsc = sortDirection[sortKey] === "asc";
  const icon = document.createElement("span");
  icon.className = "btn-sort-toggle-icon";
  icon.textContent = isAsc ? "\u2191" : "\u2193"; // ↑ naik (kecil di atas) / ↓ turun (besar di atas)

  const label = document.createElement("span");
  label.textContent = isAsc ? "Terlama" : "Terbaru";

  btn.appendChild(icon);
  btn.appendChild(label);

  btn.addEventListener("click", () => {
    sortDirection[sortKey] = isAsc ? "desc" : "asc";
    renderDateList();
  });

  header.appendChild(btn);
}

// Hanya menampilkan satu baris: Tahun 2026 (label angka tahun saja, tanpa
// embel-embel seperti "Tahun 2026"). Data di tahun lain (kalau ada, mis. dari
// hasil impor XLSX lama) tidak ditampilkan di sini karena aplikasi ini
// khusus untuk Tahun 2026.
function renderYearLevel(container, tree) {
  container.appendChild(
    buildArchiveRow(`${APP_YEAR}`, countDaysInYear(tree, APP_YEAR), () => selectArchiveYear(APP_YEAR))
  );
}

// Selalu menampilkan ke-12 bulan Januari-Desember secara lengkap, walau
// sebagian bulan belum ada datanya sama sekali (count = 0). Urutan mengikuti
// sortDirection.month: "desc" = Desember di atas, "asc" = Januari di atas.
// Bulan yang sudah punya data (dayCount > 0) mendapat menu titik-tiga dengan
// opsi "Hapus semua hari" untuk mengosongkan bulan itu sekaligus.
function renderMonthLevel(container, tree) {
  const year = archiveSelection.year;
  const months = [...Array(12).keys()]; // [0..11]
  if (sortDirection.month === "desc") months.reverse();

  months.forEach(month => {
    const dayCount = countDaysInMonth(tree, year, month);
    const menuEl = dayCount > 0 ? buildMonthItemMenu(year, month) : null;

    container.appendChild(
      buildArchiveRow(NAMA_BULAN[month], dayCount, () => selectArchiveMonth(month), menuEl)
    );
  });
}

// Menu titik-tiga khusus baris Bulan. menuId dibuat unik per bulan
// ("month-2026-8" untuk September 2026) supaya tidak bentrok dengan
// menuId tanggal (format ISO) yang dipakai buildItemMenu di level Hari.
function buildMonthItemMenu(year, month) {
  const menuId = `month-${year}-${month}`;
  return buildGenericItemMenu(menuId, [
    { label: "Hapus semua hari", onSelect: () => deleteMonth(year, month) }
  ]);
}

// Menampilkan baris Minggu 1..N pada bulan yang dipilih. Urutan mengikuti
// sortDirection.week: "desc" = minggu terbesar di atas (mis. Minggu 5 dulu),
// "asc" = Minggu 1 di atas.
function renderWeekLevel(container, tree) {
  const year = archiveSelection.year;
  const month = archiveSelection.month;
  const weeksObj = (tree[year] || {})[month] || {};
  const weeks = Object.keys(weeksObj).map(Number).sort((a, b) => a - b);
  if (sortDirection.week === "desc") weeks.reverse();

  weeks.forEach(week => {
    container.appendChild(
      buildArchiveRow(`Minggu ${week}`, weeksObj[week].length, () => selectArchiveWeek(week))
    );
  });
}

function renderDayLevel(container, tree) {
  archiveLevel = "week"; // jaga-jaga: level paling detail selalu "week" saat menampilkan daftar hari

  const year = archiveSelection.year;
  const month = archiveSelection.month;
  const week = archiveSelection.week;
  const isoList = [...(((tree[year] || {})[month] || {})[week] || [])];

  // isoList dari buildArchiveTree sudah terurut menurun (terbaru dulu, lihat
  // sortedDates), jadi untuk "asc" cukup dibalik.
  if (sortDirection.day === "asc") isoList.reverse();

  isoList.forEach(iso => {
    container.appendChild(buildDateItem(iso));
  });
}

// Baris satu tanggal (level "Hari") — dipakai oleh renderDayLevel.
// Berisi info tanggal + menu titik-tiga (opsi Hapus), menggantikan tombol
// "Hapus Hari" yang dulu ada di header panel utama.
function buildDateItem(iso) {
  const activities = scheduleData[iso] || [];
  const item = document.createElement("div");
  item.className = "date-item" + (iso === activeDate ? " active" : "");

  const content = document.createElement("div");
  content.className = "date-item-content";

  const main = document.createElement("div");
  main.className = "date-item-main";

  const dayName = document.createElement("span");
  dayName.className = "date-item-day";
  dayName.textContent = formatDayName(iso);

  const count = document.createElement("span");
  count.className = "date-item-count";
  count.textContent = `${activities.length}`;

  main.appendChild(dayName);
  main.appendChild(count);

  const full = document.createElement("div");
  full.className = "date-item-full";
  full.textContent = formatShortDate(iso);

  content.appendChild(main);
  content.appendChild(full);

  content.addEventListener("click", () => {
    activeDate = iso;
    closeItemMenu();
    renderAll();
  });

  item.appendChild(content);
  item.appendChild(buildItemMenu(iso));

  return item;
}

// Menu titik-tiga (⋮) di sisi kanan tiap baris hari. Menggantikan tombol
// "Hapus Hari" yang sebelumnya ada di header panel utama — sekarang opsi
// hapus muncul langsung di sebelah hari yang bersangkutan.
function buildItemMenu(iso) {
  return buildGenericItemMenu(iso, [
    { label: "Hapus", onSelect: () => deleteDay(iso) }
  ]);
}

// Versi umum dari menu titik-tiga: menerima menuId unik (dipakai untuk
// melacak menu mana yang sedang terbuka) dan daftar opsi { label, onSelect }.
// Dipakai baik untuk baris Hari (buildItemMenu, hapus 1 hari) maupun baris
// Bulan (buildMonthItemMenu, hapus semua hari dalam bulan itu).
function buildGenericItemMenu(menuId, options) {
  const wrap = document.createElement("div");
  wrap.className = "date-item-menu-wrap";

  const menuBtn = document.createElement("button");
  menuBtn.className = "btn-item-menu";
  menuBtn.innerHTML = "&#8942;"; // ⋮
  menuBtn.title = "Opsi";
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // jangan ikut memicu klik memilih tanggal/bulan
    toggleItemMenu(menuId);
  });

  const dropdown = document.createElement("div");
  dropdown.className = "item-menu-dropdown" + (openItemMenuId === menuId ? " show" : "");
  dropdown.dataset.menuId = menuId;

  options.forEach(({ label, onSelect }) => {
    const optionBtn = document.createElement("button");
    optionBtn.className = "item-menu-option";
    optionBtn.textContent = label;
    optionBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeItemMenu();
      onSelect();
    });
    dropdown.appendChild(optionBtn);
  });

  wrap.appendChild(menuBtn);
  wrap.appendChild(dropdown);

  return wrap;
}

function toggleItemMenu(iso) {
  openItemMenuId = openItemMenuId === iso ? null : iso;
  renderDateList();
}

function closeItemMenu() {
  openItemMenuId = null;
}

// Baris satu entri arsip (level Tahun/Bulan/Minggu) — mirip .date-item
// tapi tanpa nama hari, karena di level ini isinya bukan tanggal spesifik.
// menuEl opsional: elemen menu titik-tiga (mis. dari buildGenericItemMenu)
// yang ditaruh di sisi kanan baris, dipakai untuk baris Bulan supaya bisa
// "Hapus semua hari" dalam bulan itu tanpa perlu masuk ke level Minggu/Hari.
function buildArchiveRow(label, dayCount, onClick, menuEl) {
  const row = document.createElement("div");
  row.className = "archive-row";

  const main = document.createElement("div");
  main.className = "archive-row-main";

  const labelEl = document.createElement("span");
  labelEl.className = "archive-row-label";
  labelEl.textContent = label;

  const count = document.createElement("span");
  count.className = "archive-row-count";
  count.textContent = `${dayCount} hari`;

  main.appendChild(labelEl);
  main.appendChild(count);
  row.appendChild(main);

  row.addEventListener("click", onClick);

  if (menuEl) {
    row.appendChild(menuEl);
  }

  return row;
}

// ============================================================
// Render: header + ringkasan hari
// ============================================================

function renderDayHeader() {
  const hasData = Object.prototype.hasOwnProperty.call(scheduleData, activeDate);

  if (!hasData) {
    document.getElementById("day-title").textContent = "—";
    document.getElementById("day-subtitle").textContent = "";
    return;
  }

  document.getElementById("day-title").textContent = formatDayName(activeDate);
  document.getElementById("day-subtitle").textContent = formatFullDate(activeDate);
}

// ============================================================
// Render: daftar kegiatan pada tanggal aktif
// ============================================================

function renderActivityList() {
  const list = document.getElementById("activity-list");
  list.innerHTML = "";

  const hasData = Object.prototype.hasOwnProperty.call(scheduleData, activeDate);
  if (!hasData) {
    const empty = document.createElement("div");
    empty.className = "empty-state-main";
    empty.textContent = "Pilih tanggal di samping, atau buat hari baru untuk mulai mencatat.";
    list.appendChild(empty);
    return;
  }

  const activities = scheduleData[activeDate] || [];

  if (activities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Belum ada kegiatan di hari ini. Tambahkan lewat tombol di bawah.";
    list.appendChild(empty);
    return;
  }

  // Urutkan berdasarkan jam mulai untuk ditampilkan,
  // tapi tetap simpan index asli supaya edit/hapus tepat sasaran.
  const withOriginalIndex = activities.map((a, i) => ({ activity: a, originalIndex: i }));
  withOriginalIndex.sort((a, b) => (a.activity.jamMulai || "").localeCompare(b.activity.jamMulai || ""));

  const conflicts = findConflicts(activities);

  withOriginalIndex.forEach((entry, displayIndex) => {
    const isConflict = conflicts.has(entry.originalIndex);
    list.appendChild(buildActivityCard(entry.activity, entry.originalIndex, displayIndex, isConflict));
  });
}

function buildActivityCard(activity, index, displayIndex, isConflict) {
  const isDone = !!activity.selesai;

  const card = document.createElement("div");
  card.className = "activity-card" + (isConflict ? " conflict" : "") + (isDone ? " done" : "");
  card.title = isDone ? "Klik untuk menandai belum selesai" : "Klik untuk menandai selesai";

  // Klik di mana pun pada kartu (selain elemen interaktif di dalamnya, yang
  // masing-masing menghentikan propagasi klik-nya sendiri) -> toggle selesai.
  card.addEventListener("click", () => {
    toggleActivityDone(index);
  });

  // --- baris atas: nomor, nama kegiatan, hapus ---
  const rowTop = document.createElement("div");
  rowTop.className = "activity-row-top";

  const number = document.createElement("div");
  number.className = "activity-number";
  number.textContent = displayIndex + 1;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "activity-name";
  nameInput.value = activity.nama || "";
  nameInput.placeholder = "Nama kegiatan";
  nameInput.addEventListener("click", (e) => e.stopPropagation()); // jangan ikut toggle "selesai"
  nameInput.addEventListener("input", () => {
    scheduleData[activeDate][index].nama = nameInput.value;
    saveToStorage();
    renderDateList(); // jumlah kegiatan di sidebar tidak berubah, tapi jaga konsistensi
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-delete";
  deleteBtn.innerHTML = "&#128465;";
  deleteBtn.title = "Hapus kegiatan";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // jangan ikut toggle "selesai"
    confirmAction(`Hapus kegiatan "${activity.nama || "(tanpa nama)"}"?`, () => {
      scheduleData[activeDate].splice(index, 1);
      saveToStorage();
      renderAll();
    });
  });

  rowTop.appendChild(number);
  rowTop.appendChild(nameInput);
  rowTop.appendChild(deleteBtn);

  // --- baris bawah: jam mulai - jam selesai + durasi/bentrok ---
  const rowBottom = document.createElement("div");
  rowBottom.className = "activity-row-bottom";
  rowBottom.addEventListener("click", (e) => e.stopPropagation()); // jangan ikut toggle "selesai"

  const [startH, startM] = splitTime(activity.jamMulai);
  const [endH, endM] = splitTime(activity.jamSelesai);

  const startHourSel = buildTimeSelect(24, startH, val => {
    scheduleData[activeDate][index].jamMulai = combineTime(val, startM);
    saveToStorage();
    renderAll();
  });
  const startMinSel = buildTimeSelect(60, startM, val => {
    scheduleData[activeDate][index].jamMulai = combineTime(startH, val);
    saveToStorage();
    renderAll();
  });
  const endHourSel = buildTimeSelect(24, endH, val => {
    scheduleData[activeDate][index].jamSelesai = combineTime(val, endM);
    cascadeFromChange(index);
    saveToStorage();
    renderAll();
  });
  const endMinSel = buildTimeSelect(60, endM, val => {
    scheduleData[activeDate][index].jamSelesai = combineTime(endH, val);
    cascadeFromChange(index);
    saveToStorage();
    renderAll();
  });

  const sep1 = document.createElement("span");
  sep1.className = "time-sep";
  sep1.textContent = ":";
  const sep2 = document.createElement("span");
  sep2.className = "time-sep";
  sep2.textContent = ":";
  const dash = document.createElement("span");
  dash.className = "time-dash";
  dash.textContent = "–";

  rowBottom.appendChild(startHourSel);
  rowBottom.appendChild(sep1);
  rowBottom.appendChild(startMinSel);
  rowBottom.appendChild(dash);
  rowBottom.appendChild(endHourSel);
  rowBottom.appendChild(sep2);
  rowBottom.appendChild(endMinSel);

  if (isConflict) {
    const badge = document.createElement("span");
    badge.className = "conflict-badge";
    badge.textContent = "Bentrok jam";
    rowBottom.appendChild(badge);
  } else {
    const badge = document.createElement("span");
    badge.className = "duration-badge";
    badge.textContent = formatMinutesAsHours(durationMinutes(activity));
    rowBottom.appendChild(badge);
  }

  card.appendChild(rowTop);
  card.appendChild(rowBottom);

  return card;
}

// ============================================================
// Helper: durasi & deteksi bentrok
// ============================================================

function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// Kebalikan dari timeToMinutes. Dibungkus modulo 24 jam supaya hasil rantai
// (cascadeFromChange) yang lewat tengah malam tetap jadi jam yang valid
// untuk dropdown (00-23), bukan angka jam di luar rentang.
function minutesToTime(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function durationMinutes(activity) {
  const start = timeToMinutes(activity.jamMulai);
  const end = timeToMinutes(activity.jamSelesai);
  return Math.max(0, end - start);
}

function formatMinutesAsHours(totalMinutes) {
  if (totalMinutes <= 0) return "0 menit";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

// Mengembalikan Set berisi index (dari array asli) yang bentrok
// dengan kegiatan lain pada hari yang sama.
function findConflicts(activities) {
  const conflicting = new Set();

  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const aStart = timeToMinutes(activities[i].jamMulai);
      const aEnd = timeToMinutes(activities[i].jamSelesai);
      const bStart = timeToMinutes(activities[j].jamMulai);
      const bEnd = timeToMinutes(activities[j].jamSelesai);

      const overlap = aStart < bEnd && bStart < aEnd;
      if (overlap) {
        conflicting.add(i);
        conflicting.add(j);
      }
    }
  }

  return conflicting;
}

// ============================================================
// Helper: dropdown jam/menit
// ============================================================

function buildTimeSelect(max, selectedValue, onChange) {
  const select = document.createElement("select");
  select.className = "time-select";

  for (let i = 0; i < max; i++) {
    const opt = document.createElement("option");
    const padded = String(i).padStart(2, "0");
    opt.value = padded;
    opt.textContent = padded;
    if (padded === selectedValue) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function splitTime(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return ["00", "00"];
  const [h, m] = timeStr.split(":");
  return [h.padStart(2, "0"), m.padStart(2, "0")];
}

function combineTime(h, m) {
  return `${h}:${m}`;
}

// ============================================================
// Tambah / hapus hari
// ============================================================

// Menambahkan hari baru. Perilakunya kontekstual mengikuti breadcrumb yang
// sedang dibuka di sidebar:
// - Kalau pengguna sudah masuk ke sebuah BULAN (level "month" atau "week"),
//   hari baru dibuat di bulan itu juga: dicari tanggal kosong PERTAMA di
//   bulan tersebut (mulai dari tanggal 1), bukan asal H+1 dari tanggal
//   terbaru di seluruh data yang bisa jadi ada di bulan lain.
// - Kalau pengguna masih di level "Semua Tahun" (belum memilih bulan
//   tertentu), pakai perilaku lama: H+1 dari tanggal terbaru keseluruhan,
//   atau hari ini kalau belum ada data sama sekali.
//
// PENTING: fungsi ini TIDAK memaksa sidebar berpindah level/breadcrumb.
// activeDate (yang menentukan isi panel kanan) tetap diperbarui supaya
// hari baru langsung terlihat datanya, tapi archiveLevel & archiveSelection
// dibiarkan seperti apa adanya sehingga pengguna tetap berada di level
// (Bulan/Minggu/dst) yang sedang mereka lihat, bukan tiba-tiba "diseret"
// masuk ke level Hari pada hari yang baru dibuat.
function addNewDay() {
  const isInsideAMonth = (archiveLevel === "month" || archiveLevel === "week") && archiveSelection.month !== null;

  const nextDate = isInsideAMonth
    ? firstEmptyDateInMonth(archiveSelection.year, archiveSelection.month)
    : nextDateAfterLatest();

  if (!nextDate) {
    showToast("Bulan ini sudah penuh terisi semua tanggalnya");
    return;
  }

  if (scheduleData[nextDate]) {
    showToast(`Tanggal ${formatFullDate(nextDate)} sudah ada`);
    activeDate = nextDate;
    renderAll();
    return;
  }

  scheduleData[nextDate] = [];
  activeDate = nextDate;
  saveToStorage();
  renderAll();
  showToast(`Hari baru: ${formatFullDate(nextDate)}`);
}

// Perilaku lama: sehari setelah tanggal terbaru di SELURUH data,
// atau hari ini kalau belum ada data sama sekali. Dipakai saat pengguna
// belum membuka bulan tertentu di breadcrumb (masih level "Semua Tahun").
function nextDateAfterLatest() {
  const dates = sortedDates();
  if (dates.length === 0) return todayISO();

  const latest = isoToDate(dates[0]);
  latest.setDate(latest.getDate() + 1);
  return dateToISO(latest);
}

// Mencari tanggal kosong (belum ada di scheduleData) PERTAMA dalam sebuah
// bulan, dimulai dari tanggal 1. Mengembalikan null kalau semua tanggal
// di bulan itu sudah terisi (jarang terjadi, tapi dijaga supaya aman).
function firstEmptyDateInMonth(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = dateToISO(new Date(year, month, day));
    if (!Object.prototype.hasOwnProperty.call(scheduleData, iso)) {
      return iso;
    }
  }

  return null;
}

// Menghapus sebuah hari (dipanggil dari menu titik-tiga di sidebar, lihat
// buildItemMenu). Bisa menghapus hari manapun, tidak harus activeDate —
// kalau yang dihapus kebetulan sedang aktif, pindah activeDate ke hari lain.
function deleteDay(iso) {
  const hasData = Object.prototype.hasOwnProperty.call(scheduleData, iso);
  if (!hasData) return;

  confirmAction(`Hapus seluruh catatan tanggal ${formatFullDate(iso)}? Semua kegiatan di hari ini akan hilang.`, () => {
    delete scheduleData[iso];
    saveToStorage();

    if (activeDate === iso) {
      activeDate = pickInitialDate();
      initArchiveSelectionFromActiveDate();
    }

    renderAll();
    showToast("Hari berhasil dihapus");
  });
}

// Menghapus SEMUA hari dalam satu bulan sekaligus (dipanggil dari menu
// titik-tiga pada baris Bulan, lihat buildMonthItemMenu). Berguna untuk
// mengosongkan satu bulan penuh (mis. mau membuat ulang datanya dari awal)
// tanpa harus menghapus satu-satu di level Hari.
function deleteMonth(year, month) {
  const isoList = Object.keys(scheduleData).filter(iso => {
    const date = isoToDate(iso);
    return date.getFullYear() === year && date.getMonth() === month;
  });

  if (isoList.length === 0) return;

  confirmAction(
    `Hapus semua ${isoList.length} hari di bulan ${NAMA_BULAN[month]} ${year}? Seluruh kegiatan di bulan ini akan hilang.`,
    () => {
      const activeDateWasInMonth = isoList.includes(activeDate);

      isoList.forEach(iso => delete scheduleData[iso]);
      saveToStorage();

      if (activeDateWasInMonth) {
        activeDate = pickInitialDate();
        initArchiveSelectionFromActiveDate();
      }

      renderAll();
      showToast(`${isoList.length} hari di bulan ${NAMA_BULAN[month]} berhasil dihapus`);
    }
  );
}

// ============================================================
// Tambah kegiatan baru
// ============================================================

function addActivity() {
  if (!scheduleData[activeDate]) return;

  const activities = scheduleData[activeDate];
  const DEFAULT_DURATION_MINUTES = 60;

  let jamMulai = "05:00";
  let jamSelesai = "06:00";

  if (activities.length > 0) {
    // Kegiatan baru mulai dari jam selesai kegiatan dengan jam mulai TERBESAR
    // hari itu (kegiatan paling akhir dalam urutan tampil), bukan selalu 05:00.
    const last = activities.reduce((latest, a) =>
      timeToMinutes(a.jamMulai) > timeToMinutes(latest.jamMulai) ? a : latest
    );
    jamMulai = last.jamSelesai || jamMulai;
    jamSelesai = minutesToTime(timeToMinutes(jamMulai) + DEFAULT_DURATION_MINUTES);
  }

  activities.push({ nama: "", jamMulai, jamSelesai, selesai: false });
  saveToStorage();
  renderAll();

  const inputs = document.querySelectorAll(".activity-name");
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

// Menandai kegiatan selesai/belum selesai (dipanggil saat kartu kegiatan
// diklik). Nama kegiatan yang selesai ditampilkan tercoret (lihat CSS
// .activity-card.done) tapi datanya tetap tersimpan seperti biasa.
function toggleActivityDone(index) {
  const activity = scheduleData[activeDate][index];
  if (!activity) return;

  activity.selesai = !activity.selesai;
  saveToStorage();
  renderActivityList();
}

// ============================================================
// Rantai jam otomatis
// ============================================================
//
// Dipanggil setiap kali jam SELESAI suatu kegiatan berubah (jam mulai tidak
// memicu rantai ini, karena jam selesai yang menentukan kapan kegiatan
// berikutnya "harus" mulai). Kegiatan berikutnya dicari berdasarkan urutan
// TAMPIL (terurut menurut jam mulai, sama seperti renderActivityList), bukan
// urutan index array — supaya tetap benar walau array-nya sendiri tidak
// terurut. Jam mulai kegiatan berikutnya disamakan dengan jam selesai yang
// baru, lalu jam selesainya digeser secukupnya supaya durasi asli kegiatan
// itu tetap sama. Efeknya merambat terus sampai kegiatan terakhir hari itu.
function cascadeFromChange(changedIndex) {
  const activities = scheduleData[activeDate];
  if (!activities) return;

  const withOriginalIndex = activities.map((a, i) => ({ activity: a, originalIndex: i }));
  withOriginalIndex.sort((a, b) => (a.activity.jamMulai || "").localeCompare(b.activity.jamMulai || ""));

  const displayPos = withOriginalIndex.findIndex(entry => entry.originalIndex === changedIndex);
  if (displayPos === -1) return;

  let cursorEnd = timeToMinutes(activities[changedIndex].jamSelesai);

  for (let pos = displayPos + 1; pos < withOriginalIndex.length; pos++) {
    const nextActivity = activities[withOriginalIndex[pos].originalIndex];
    const originalDuration = durationMinutes(nextActivity);

    const newStart = cursorEnd;
    const newEnd = newStart + originalDuration;

    nextActivity.jamMulai = minutesToTime(newStart);
    nextActivity.jamSelesai = minutesToTime(newEnd);

    cursorEnd = newEnd;
  }

  saveToStorage();
}

// ============================================================
// Modal konfirmasi (pengganti window.confirm)
// ============================================================

function confirmAction(message, onConfirm) {
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-modal").classList.add("show");
  pendingConfirmAction = onConfirm;

  // Fokuskan langsung ke tombol "Hapus" saat modal terbuka. Tanpa ini,
  // fokus browser tertinggal di elemen sebelumnya (mis. tombol titik-tiga
  // yang baru saja ditekan Delete), sehingga urutan Tab terasa mulai dari
  // "Batal" dan perlu 2x Tab untuk sampai ke "Hapus". Dengan fokus awal di
  // "Hapus", pengguna bisa langsung tekan Enter untuk konfirmasi.
  // requestAnimationFrame supaya fokus diberikan setelah modal benar-benar
  // ditampilkan (class "show" sudah diterapkan ke DOM).
  requestAnimationFrame(() => {
    document.getElementById("confirm-ok").focus();
  });
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.remove("show");
  pendingConfirmAction = null;
}

// ============================================================
// Import XLSX
// ============================================================
//
// Format kolom yang diharapkan pada tiap sheet (baris pertama = header):
// | No | Kegiatan | Jam Mulai | Jam Selesai | Selesai |
// Kolom "Selesai" bersifat opsional (TRUE/FALSE) — kalau tidak ada di sheet,
// kegiatan akan diimpor sebagai belum selesai.
//
// Nama sheet harus berupa tanggal, salah satu format berikut:
//   - "2026-09-07"  (ISO, paling disarankan)
//   - "07-09-2026" atau "07/09/2026"  (DD-MM-YYYY)
// Sheet dengan nama yang tidak bisa dikenali sebagai tanggal akan dilewati.
//
// Import dibatasi HANYA untuk satu minggu (maksimal 7 hari) sekaligus,
// selaras dengan Export yang juga dibatasi per minggu. Kalau tanggal-tanggal
// pada file mencakup lebih dari 7 hari kalender, seluruh file DITOLAK
// (tidak ada yang diimpor sebagian) dan pengguna diminta memakai file
// hasil export per minggu.

const IMPORT_MAX_DAYS_SPAN = 7;

function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const result = importWorkbook(workbook);

      if (result.status === "no-valid-sheets") {
        showToast("Tidak ada sheet dengan nama tanggal yang valid ditemukan");
      } else if (result.status === "too-many-days") {
        showToast(`File berisi lebih dari 1 minggu (${result.dayCount} hari). Import hanya menerima maksimal 7 hari dalam satu minggu.`);
      } else {
        showToast(`Berhasil impor ${result.importedCount} hari`);
      }
    } catch (err) {
      console.error("Gagal mengimpor file:", err);
      showToast("Gagal membaca file. Pastikan formatnya sesuai.");
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = "";
}

function importWorkbook(workbook) {
  const candidates = []; // { iso, sheet }

  workbook.SheetNames.forEach(sheetName => {
    const iso = parseSheetNameAsDate(sheetName);
    if (!iso) return; // lewati sheet yang namanya bukan tanggal valid
    candidates.push({ iso, sheet: workbook.Sheets[sheetName] });
  });

  if (candidates.length === 0) {
    return { status: "no-valid-sheets", importedCount: 0 };
  }

  // Validasi rentang: seluruh tanggal pada file harus muat dalam jendela
  // 7 hari kalender (bukan cuma jumlah sheet <= 7 — dua sheet bisa jauh
  // terpisah tanggalnya walau cuma 2 sheet). Dicek dari selisih tanggal
  // paling awal ke paling akhir.
  const sortedIsos = candidates.map(c => c.iso).sort();
  const earliest = isoToDate(sortedIsos[0]);
  const latest = isoToDate(sortedIsos[sortedIsos.length - 1]);
  const spanDays = Math.round((latest - earliest) / (1000 * 60 * 60 * 24)) + 1;

  if (candidates.length > IMPORT_MAX_DAYS_SPAN || spanDays > IMPORT_MAX_DAYS_SPAN) {
    return { status: "too-many-days", importedCount: 0, dayCount: Math.max(candidates.length, spanDays) };
  }

  let lastImportedDate = null;
  candidates.forEach(({ iso, sheet }) => {
    scheduleData[iso] = parseSheetToActivities(sheet);
    lastImportedDate = iso;
  });

  saveToStorage();
  activeDate = lastImportedDate;
  initArchiveSelectionFromActiveDate();

  return { status: "ok", importedCount: candidates.length };
}

// Menerima nama sheet dalam beberapa format tanggal umum,
// mengembalikan null kalau tidak bisa dikenali.
function parseSheetNameAsDate(name) {
  const trimmed = name.trim();

  // Format ISO: 2026-09-07
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Format DD-MM-YYYY atau DD/MM/YYYY
  m = trimmed.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

function parseSheetToActivities(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const activities = [];

  rows.forEach(row => {
    const nama = row["Kegiatan"] ?? row["kegiatan"] ?? row["Nama Kegiatan"] ?? "";
    if (!nama) return;

    const jamMulai = normalizeTimeValue(row["Jam Mulai"] ?? row["jam mulai"] ?? "");
    const jamSelesai = normalizeTimeValue(row["Jam Selesai"] ?? row["jam selesai"] ?? "");
    const selesaiValue = row["Selesai"] ?? row["selesai"] ?? "";
    const selesai = selesaiValue === true || selesaiValue === "TRUE" || selesaiValue === "true" || selesaiValue === 1 || selesaiValue === "1";

    activities.push({ nama, jamMulai, jamSelesai, selesai });
  });

  return activities;
}

function normalizeTimeValue(value) {
  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (typeof value === "string" && value.includes(":")) {
    const [h, m] = value.split(":");
    return `${h.padStart(2, "0")}:${(m || "00").padStart(2, "0")}`;
  }
  return "00:00";
}

// ============================================================
// Export XLSX
// ============================================================
//
// Export dibatasi HANYA untuk satu minggu (maksimal 7 hari) sekaligus,
// bukan seluruh data aplikasi — supaya ukuran file tidak membengkak.
// Minggu yang diekspor adalah minggu yang SEDANG dibuka di breadcrumb
// sidebar (archiveLevel === "week"). Kalau pengguna belum masuk ke level
// Minggu (masih di "Semua Tahun" / level Bulan), export ditolak dengan
// toast yang meminta memilih minggu dulu.

function handleExport() {
  if (archiveLevel !== "week") {
    showToast("Pilih salah satu minggu dulu di sidebar untuk mengekspor");
    return;
  }

  const year = archiveSelection.year;
  const month = archiveSelection.month;
  const week = archiveSelection.week;

  const dates = sortedDates().filter(iso => {
    const date = isoToDate(iso);
    return date.getFullYear() === year && date.getMonth() === month && weekOfMonthNumber(date) === week;
  });

  if (dates.length === 0) {
    showToast("Minggu ini belum ada data untuk diekspor");
    return;
  }

  const workbook = XLSX.utils.book_new();

  dates.forEach(iso => {
    const activities = scheduleData[iso] || [];
    const rows = activities.map((activity, index) => ({
      No: index + 1,
      Kegiatan: activity.nama,
      "Jam Mulai": activity.jamMulai,
      "Jam Selesai": activity.jamSelesai,
      Selesai: activity.selesai ? "TRUE" : "FALSE"
    }));

    const sheet = XLSX.utils.json_to_sheet(
      rows.length > 0 ? rows : [{ No: "", Kegiatan: "", "Jam Mulai": "", "Jam Selesai": "", Selesai: "" }]
    );
    // Nama sheet Excel tidak boleh mengandung karakter tertentu atau lebih dari 31 karakter;
    // format ISO (2026-09-07) sudah aman untuk itu.
    XLSX.utils.book_append_sheet(workbook, sheet, iso);
  });

  const fileName = `log-kegiatan_${NAMA_BULAN[month]}-${year}_minggu-${week}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  showToast(`File minggu ${week} (${dates.length} hari) berhasil diunduh`);
}

// ============================================================
// Toast notifikasi kecil
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
// Render gabungan
// ============================================================

function renderAll() {
  renderDateList();
  renderDayHeader();
  renderActivityList();
}

// ============================================================
// Inisialisasi
// ============================================================

function init() {
  renderAll();

  document.getElementById("btn-new-day").addEventListener("click", addNewDay);
  document.getElementById("btn-add-activity").addEventListener("click", addActivity);
  document.getElementById("file-import").addEventListener("change", handleFileImport);
  document.getElementById("btn-export").addEventListener("click", handleExport);

  document.getElementById("confirm-cancel").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-ok").addEventListener("click", () => {
    if (pendingConfirmAction) pendingConfirmAction();
    closeConfirmModal();
  });

  // Escape untuk membatalkan modal konfirmasi tanpa perlu Tab ke "Batal".
  // Enter tidak perlu ditangani manual: fokus sudah diarahkan ke tombol
  // "Hapus" saat modal dibuka (lihat confirmAction), jadi Enter bawaan
  // browser pada tombol yang fokus otomatis memicu klik tombol tersebut.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = document.getElementById("confirm-modal");
    if (modal.classList.contains("show")) {
      closeConfirmModal();
    }
  });

  // Klik di luar menu titik-tiga manapun -> tutup menu yang sedang terbuka.
  // Klik PADA tombol menu itu sendiri sudah di-stopPropagation di buildItemMenu,
  // jadi listener ini aman dipasang global di document.
  document.addEventListener("click", () => {
    if (openItemMenuId !== null) {
      closeItemMenu();
      renderDateList();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await bootstrapServerData();
  const initial = pickInitialDate();
  activeDate = initial;
  applyDateFromQueryString();
  initArchiveSelectionFromActiveDate();
  init();
});
