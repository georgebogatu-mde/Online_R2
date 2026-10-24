# Online_R2 – copie de TEST pentru migrarea Supabase -> Cloudflare

Copiat din `Online` la 24.10.2026. Originalul rămâne neatins și continuă să folosească Supabase.

ATENȚIE: această copie are același remote git (panou-central-rd) ca originalul.
Nu face push pe `main` din acest folder până nu e gata migrarea – ar suprascrie versiunea de producție.

## Ce folosește proiectul din Supabase (inventar inițial)
- Auth: login email+parolă (signInWithPassword, getSession în ~19 pagini, signOut, updateUser)
- Baza de date (Postgres): tabelele rd_permissions, rd_order, rd_paths, rd_categories, shared_data, user_data (vezi supabase_setup.sql), cu RLS pe user
- Realtime: .channel() în ~9 pagini (sincronizare live între utilizatori)
- Storage: fișele tehnice (109 MB, material_selector_mde/fise_tehnice) – încărcate cu upload_fise_supabase.mjs, citite din index.html

## Ce înlocuiește Cloudflare
- Storage -> R2 (direct)
- Baza de date -> D1 + Worker API
- Auth / Realtime -> de decis (vezi discuția)

## Decizie (24.10.2026)
- Cloudflare R2: DOAR fisiere (fise tehnice PDF/DOCX, documentatii mari)
- Supabase: ramane pentru login, baza de date, realtime si bucket-ul privat "portal"
- GitHub: repository nou `panou-central-rd-r2` (remote-ul copiei a fost schimbat)
- Upload in R2: `upload_fise_r2.mjs`; in selector se schimba doar `FISE_BASE` (material_selector_mde/index.html)
