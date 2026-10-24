/**
 * Centralizator Teste R&D -> Panou Central R&D + Cloudflare R2
 *
 * Ce face:
 *   1. Ia "Teste Adeziune - Proceduri + Rezultate/Centralizator Teste R&D.html" (versiunea locala)
 *      si scrie copia publicata in  teste_adeziune/index.html  (linkurile arata spre R2 + buton "Panou Central").
 *   2. Urca in R2 (bucket "fise", prefix "teste_adeziune/") toate rapoartele si procedurile
 *      (PDF, XLSX, DOCX, PPTX). Urca DOAR fisierele noi sau modificate (compara dimensiunea).
 *
 * RULARE (PowerShell, in folderul Online_R2):
 *   $env:R2_ACCOUNT_ID="..."; $env:R2_ACCESS_KEY_ID="..."; $env:R2_SECRET_ACCESS_KEY="..."
 *   node upload_teste_r2.mjs              -> regenereaza HTML-ul publicat + urca fisierele
 *   node upload_teste_r2.mjs --doar-html  -> doar regenereaza teste_adeziune/index.html (fara chei R2)
 *
 * Dupa rulare: commit + push in GitHub (teste_adeziune/index.html si index.html).
 * Cand adaugi rapoarte noi: regenerezi centralizatorul local, apoi rulezi din nou acest script.
 */
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR   = join(__dirname, 'Teste Adeziune - Proceduri + Rezultate');
const SRC_HTML  = join(SRC_DIR, 'Centralizator Teste R&D.html');
const OUT_DIR   = join(__dirname, 'teste_adeziune');
const OUT_HTML  = join(OUT_DIR, 'index.html');
const PREFIX    = 'teste_adeziune/';
const PUBLIC_BASE = 'https://pub-676258017af84988bc5ac8b9059c4b3e.r2.dev/' + PREFIX; // acelasi bucket public ca FISE_BASE

// ---------- 1. HTML publicat ----------
function buildHtml(){
  let s = readFileSync(SRC_HTML, 'utf8');
  const OLD = "const href=p=>p.split('/').map(encodeURIComponent).join('/');";
  if (!s.includes(OLD)) { console.error('Nu gasesc functia href in centralizator - formatul s-a schimbat. Opresc.'); process.exit(1); }
  s = s.replace(OLD, `const TESTE_BASE='${PUBLIC_BASE}';\nconst href=p=>TESTE_BASE+p.split('/').map(encodeURIComponent).join('/');`);
  s = s.replace('Linkul funcționează când acest fișier HTML stă în folderul „Teste Adeziune - Proceduri + Rezultate”.', 'Fișierul se deschide din arhiva online (Cloudflare R2).');
  const BACK = `
<!-- BUTON REVENIRE LA PANOU -->
<style>#backToHub{position:fixed;bottom:24px;left:24px;z-index:9999;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#1A3A5C,#1565C0);color:#fff;border:none;border-radius:12px;padding:10px 18px 10px 14px;font-family:"Segoe UI",system-ui,sans-serif;font-size:.82rem;font-weight:700;box-shadow:0 4px 18px rgba(26,58,92,.35);cursor:pointer;text-decoration:none}#backToHub:hover{opacity:.92;transform:translateY(-2px)}</style>
<a id="backToHub" href="../index.html" title="Inapoi la Panou Central"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Panou Central</a>
<!-- END BUTON REVENIRE -->
`;
  s = s.replace(/\n<!-- BUTON REVENIRE LA PANOU -->[\s\S]*?<!-- END BUTON REVENIRE -->\n/g, '');
  s = s.replace(/<body[^>]*>/, m => m + BACK);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_HTML, s, 'utf8');
  console.log(`HTML publicat: teste_adeziune/index.html (${(s.length/1e6).toFixed(1)} MB)`);
}
buildHtml();
if (process.argv.includes('--doar-html')) process.exit(0);

// ---------- 2. Upload R2 ----------
const clean = v => (v || '').replace(/[\s"'<>\u200B-\u200D\uFEFF]/g, '');
const ACCOUNT_ID = clean(process.env.R2_ACCOUNT_ID);
const KEY_ID     = clean(process.env.R2_ACCESS_KEY_ID);
const SECRET     = clean(process.env.R2_SECRET_ACCESS_KEY);
const BUCKET     = clean(process.env.R2_BUCKET) || 'fise';
if (!ACCOUNT_ID || !KEY_ID || !SECRET) { console.error('Lipsesc variabilele R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.'); process.exit(1); }

const s3 = new S3Client({ region: 'auto', endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET } });

const CT = { '.pdf':'application/pdf',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const ext = n => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i).toLowerCase(); };

function listFiles(dir, base){
  let out = [];
  for (const name of readdirSync(dir)){
    if (name.startsWith('.') || name.startsWith('~$') || name.startsWith('_Generator')) continue;
    const full = join(dir, name), rel = base ? base + '/' + name : name;
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full, rel));
    else if (CT[ext(name)]) out.push({ full, rel, size: statSync(full).size });
  }
  return out;
}

async function existing(){
  const map = new Map(); let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    (r.Contents || []).forEach(o => map.set(o.Key, o.Size));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return map;
}

async function put(f){
  for (let a = 1; a <= 3; a++){
    try { await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: PREFIX + f.rel, Body: readFileSync(f.full), ContentType: CT[ext(f.rel)] })); return null; }
    catch (e){ if (/credential|access ?denied|signature|NoSuchBucket/i.test(e.message || e.name || '')) return e;
      if (a === 3) return e; await new Promise(r => setTimeout(r, 1500 * a)); }
  }
}

const all = listFiles(SRC_DIR, '');
const have = await existing();
const todo = all.filter(f => have.get(PREFIX + f.rel) !== f.size);
const mb = todo.reduce((s, f) => s + f.size, 0) / 1e6;
console.log(`${all.length} fisiere locale, ${all.length - todo.length} deja in R2, de urcat: ${todo.length} (${mb.toFixed(0)} MB)`);
let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i += 6){
  const b = todo.slice(i, i + 6);
  (await Promise.all(b.map(put))).forEach((e, j) => { if (e){ fail++; console.error('\n  EROARE:', b[j].rel, '-', e.message); } else ok++; });
  process.stdout.write(`\r  Progres: ${ok + fail}/${todo.length} (ok ${ok}, erori ${fail})   `);
}
console.log(`\nGata. ${ok} urcate, ${fail} erori.`);
