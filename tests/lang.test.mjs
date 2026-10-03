/**
 * Translation files.
 *
 * The failure mode this guards is invisible to whoever ships it: a key missing from de.json
 * renders in Foundry as the literal string "UPGRADES.Shop.Locked", and only a German-speaking
 * GM ever finds out. A dropped {placeholder} is worse, because the sentence still reads fine and
 * simply loses the number or the name it was supposed to carry.
 *
 * English is the reference. Every other file must have exactly its keys, no more and no fewer.
 */
import fs from 'node:fs';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const langDir = new URL('../lang/', import.meta.url);
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json')).sort();
const load = f => JSON.parse(fs.readFileSync(new URL(f, langDir), 'utf8'));

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  typeof v === 'string' ? [[`${prefix}${k}`, v]] : flatten(v, `${prefix}${k}.`));

t('en.json exists and is the reference', files.includes('en.json'));
const english = new Map(flatten(load('en.json')));
t('the reference has content', english.size > 100);

const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

for (const file of files) {
  if (file === 'en.json') continue;
  let parsed = null;
  try { parsed = load(file); } catch (err) { t(`${file}: is valid JSON — ${err.message}`, false); continue; }
  t(`${file}: is valid JSON`, true);

  const entries = new Map(flatten(parsed));
  const missing = [...english.keys()].filter(k => !entries.has(k));
  const extra = [...entries.keys()].filter(k => !english.has(k));

  t(`${file}: translates every key${missing.length ? ` — missing ${missing.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}` : ''}`,
    missing.length === 0);
  t(`${file}: has no keys English does not${extra.length ? ` — extra: ${extra.slice(0, 6).join(', ')}` : ''}`,
    extra.length === 0);

  // A translation may reorder {placeholders} but must not drop or invent one.
  const wrong = [...entries.entries()]
    .filter(([k, v]) => english.has(k) && placeholders(english.get(k)) !== placeholders(v))
    .map(([k]) => k);
  t(`${file}: keeps every {placeholder}${wrong.length ? ` — wrong in: ${wrong.slice(0, 6).join(', ')}` : ''}`,
    wrong.length === 0);

  // Markup is part of the string in a few hints; losing a tag breaks the layout silently.
  const tagsLost = [...entries.entries()]
    .filter(([k, v]) => english.has(k)
      && /<(code|strong|em)>/.test(english.get(k)) !== /<(code|strong|em)>/.test(v))
    .map(([k]) => k);
  t(`${file}: keeps inline markup${tagsLost.length ? ` — lost in: ${tagsLost.join(', ')}` : ''}`,
    tagsLost.length === 0);
}

/* ---------- the manifest and the folder must agree ---------- */
const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
const declared = (manifest.languages ?? []).map(l => l.path.replace(/^lang\//, ''));
const undeclared = files.filter(f => !declared.includes(f));
const phantom = declared.filter(f => !files.includes(f));

t(`every language file is declared in module.json${undeclared.length ? ` — not declared: ${undeclared.join(', ')}` : ''}`,
  undeclared.length === 0);
t(`every declared language file exists${phantom.length ? ` — missing: ${phantom.join(', ')}` : ''}`,
  phantom.length === 0);
t('each declared language has a lang code and a name',
  (manifest.languages ?? []).every(l => l.lang && l.name && l.path));

process.exit(bad);
