/**
 * Every Font Awesome class the module ships must exist in FA6 free-solid.
 * A wrong class renders a blank square with no error — the same silent failure as a
 * bad data path. fa-crystal-ball and fa-orb are the obvious names for a currency icon
 * and neither is real, which is exactly why this check exists.
 *
 * Needs the FA metadata. Cached at tests/.cache/fa-free-solid.json; regenerate with:
 *   node tests/icons.test.mjs --refresh
 */
import fs from 'node:fs';
import path from 'node:path';

const cacheDir = new URL('./.cache/', import.meta.url);
const cacheFile = new URL('./.cache/fa-free-solid.json', import.meta.url);
const SOURCE = 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/metadata/icons.json';

let names = null;
if (!process.argv.includes('--refresh') && fs.existsSync(cacheFile)) {
  names = new Set(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
} else {
  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(String(res.status));
    const meta = await res.json();
    names = new Set(Object.keys(meta).filter(n => (meta[n].free || []).includes('solid')));
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify([...names].sort()));
    console.log(`(refreshed cache: ${names.size} free-solid icons)`);
  } catch (e) {
    console.log(`SKIP  could not reach Font Awesome metadata (${e.message}) and no cache present`);
    process.exit(0);
  }
}

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// The pickers in settings-app are where a made-up name is most tempting, but a template renders
// its own blank square just as silently, so both are read.
const src = read('scripts/apps/settings-app.js') + read('scripts/settings.js') + read('scripts/main.js')
  + fs.readdirSync(new URL('../templates', import.meta.url)).map(f => read(`templates/${f}`)).join("");
const used = [...new Set([...src.matchAll(/fa-solid fa-([a-z0-9-]+)/g)].map(m => m[1]))];
t('the module ships icon classes at all', used.length > 20);
const missing = used.filter(n => !names.has(n));
t(`all ${used.length} shipped icon classes exist in FA6 free-solid`
  + (missing.length ? ` — broken: ${missing.join(', ')}` : ''), missing.length === 0);
t('fa-crystal-ball is still not a real icon (guard against reintroducing it)', !names.has('crystal-ball'));

process.exit(bad);
