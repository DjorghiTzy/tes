# Kegiatan Online di Vercel

Versi ini tidak lagi memakai penyimpanan browser sebagai sumber utama.

- Jadwal + ringkasan: Neon Postgres
- Antrean/riwayat barcode + warna + pengaturan label: Neon Postgres
- Playlist + status pemutar: Neon Postgres
- File musik: Vercel Blob
- Login: Vercel Function + HttpOnly signed cookie
- Cache browser hanya dipakai sebagai fallback/offline dan untuk migrasi data lama

## Deploy

1. Upload/push folder ini ke GitHub lalu import project ke Vercel.
2. Di Vercel, tambahkan Neon dari Storage/Marketplace dan pastikan `DATABASE_URL` tersedia.
3. Buat Vercel Blob Store untuk project. Untuk cara paling sederhana, pilih **Public** karena file audio diputar langsung dari URL Blob. Vercel Blob memang ditujukan untuk media besar seperti audio dan menyediakan upload langsung dari browser. 
4. Tambahkan Environment Variables:
   - `AUTH_USERNAME` = username login, contoh `admin`
   - `AUTH_PASSWORD` = password login
   - `AUTH_SECRET` = string acak panjang
   - `DATABASE_URL` = otomatis dari Neon/Vercel
   - ``BLOB_READ_WRITE_TOKEN` = gunakan token Blob bila project Anda tidak memakai OIDC otomatis
5. Redeploy.
6. Buka `/login.html`.

## Catatan

Database akan membuat tabel sendiri saat API pertama kali dipanggil, jadi tidak perlu menjalankan SQL manual.

Audio yang sebelumnya tersimpan di IndexedDB akan dicoba dipindahkan otomatis ke Vercel Blob saat halaman Musik pertama kali dibuka.

Batas request Vercel Functions adalah 4.5 MB, sehingga upload musik menggunakan client upload langsung ke Vercel Blob, termasuk multipart untuk file besar.
