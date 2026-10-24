/**
 * Upload fise tehnice (PDF + DOCX) in Cloudflare R2 (bucket "fise", acces public activat).
 * Login-ul si baza de date raman in Supabase - acest script atinge DOAR fisierele.
 *
 * RULARE (in folderul Online_R2):
 *   1. npm install @aws-sdk/client-s3
 *   2. Pune cheile R2 (Cloudflare -> R2 -> Manage R2 API Tokens):
 *        Windows PowerShell:
 *          $env:R2_ACCOUNT_ID="<account id>"
 *          $env:R2_ACCESS_KEY_ID="<access key id>"
 *          $env:R2_SECRET_ACCESS_KEY="<secret access key>"
 *          $env:R2_BUCKET="fise"          # optional, implicit "fise"
 *   3. node upload_fise_r2.mjs
 *
 * Se poate rula de mai multe ori (suprascrie ce exista).
 * Cheile obiectelor pastreaza structura "fise_tehnice/pdf/..." si "fise_tehnice/docx/...",
 * exact ca in Supabase, ca selectorul sa gaseasca fisierele doar schimband FISE_BASE.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .replace elimina spatii, ghilimele si caractere invizibile lipite la copiere
const clean = v => (v || '').replace(/[\s"'<>\u200B-\u200D\uFEFF]/g, '');
const ACCOUNT_ID = clean(process.env.R2_ACCOUNT_ID);
const KEY_ID     = clean(process.env.R2_ACCESS_KEY_ID);
const SECRET     = clean(process.env.R2_SECRET_ACCESS_KEY);
const BUCKET     = clean(process.env.R2_BUCKET) || 'fise';

if (!ACCOUNT_ID || !KEY_ID || !SECRET) {
  console.error('Lipsesc variabilele R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}
console.log(`Lungimi chei: Account ID ${ACCOUNT_ID.length} (trebuie 32), Access Key ID ${KEY_ID.length} (trebuie 32), Secret ${SECRET.length} (trebuie 64)`);
if (ACCOUNT_ID.length !== 32 || KEY_ID.length !== 32 || SECRET.length !== 64) {
  console.error('O cheie are lungimea gresita - verifica ce ai copiat (vezi mai sus). Opresc.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
});

const FISE_ROOT = join(__dirname, 'material_selector_mde', 'fise_tehnice');

const CONTENT_TYPE = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function ext(name){ const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i).toLowerCase(); }

// Aceeasi transformare ca la Supabase si ca in selector (linkHref): µ / μ -> u
function sanitizeKey(key){ return key.replace(/[µμ]/g, 'u'); }

function skip(name){
  const n = name.toLowerCase();
  if (n.endsWith('.tmp')) return true;
  if (name.startsWith('.~lock') || name.startsWith('~$')) return true;
  if (name.startsWith('.')) return true;
  return false;
}

function listFiles(dir, base){
  let out = [];
  for (const name of readdirSync(dir)){
    const full = join(dir, name);
    const rel  = base ? base + '/' + name : name;
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full, rel));
    else if (!skip(name)) out.push({ full, rel });
  }
  return out;
}

async function uploadOne(key, fullPath, contentType){
  let last;
  for (let attempt = 1; attempt <= 3; attempt++){
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: readFileSync(fullPath),
      ContentType: contentType || 'application/octet-stream',
    }));
    return null;
  } catch (e) {
    last = e;
    if (/credential|access ?denied|signature|NoSuchBucket/i.test(e.message || e.name || '')) return e; // nu are rost sa reincerce
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  }
  return last;
}

async function run(){
  const files = listFiles(FISE_ROOT, 'fise_tehnice');
  console.log(`Se incarca ${files.length} fise tehnice in R2 (bucket "${BUCKET}")...`);
  let ok = 0, fail = 0;
  const CONC = 4;
  for (let i = 0; i < files.length; i += CONC){
    const batch = files.slice(i, i + CONC);
    const results = await Promise.all(batch.map(f =>
      uploadOne(sanitizeKey(f.rel), f.full, CONTENT_TYPE[ext(f.rel)])
    ));
    results.forEach((err, j) => {
      if (err){ fail++; console.error('\n  EROARE:', batch[j].rel, '-', err.message); }
      else ok++;
    });
    process.stdout.write(`\r  Progres: ${ok + fail}/${files.length} (ok ${ok}, erori ${fail})   `);
  }
  console.log(`\nGata. ${ok} incarcate, ${fail} erori.`);
}

run();
