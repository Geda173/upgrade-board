import { i18n } from './i18n-stub.mjs';
import fs from 'node:fs';
globalThis.CONST = { ACTIVE_EFFECT_MODES:{CUSTOM:0,MULTIPLY:1,ADD:2,DOWNGRADE:3,UPGRADE:4,OVERRIDE:5} };
globalThis.game = { system:{id:'dnd5e'}, i18n };
const { THEMES } = await import(new URL('../scripts/settings.js', import.meta.url));
const css = fs.readFileSync(new URL('../styles/shop.css', import.meta.url),'utf8');

let bad = 0;
const t = (n,c) => { if(!c) bad=1; console.log((c?'PASS ':'FAIL ')+n); };

// The base .upgrades block is the contract: every property it declares must be
// declared by every theme, or that theme silently inherits an off-palette default.
const base = css.match(/^\.upgrades \{([\s\S]*?)\n\}/m)[1];
const required = [...base.matchAll(/(--upg-[a-z-]+):/g)].map(m => m[1])
  .filter(v => v !== '--upg-font' && v !== '--upg-warn');   // intentionally shared

const cssThemes = [...css.matchAll(/\.upgrades\.upg-theme-([a-z]+) \{([\s\S]*?)\n\}/g)]
  .map(m => ({ id: m[1], vars: [...m[2].matchAll(/(--upg-[a-z-]+):/g)].map(x => x[1]) }));

t('registry has 16 themes', THEMES.length === 16);
t('every registry theme has a CSS block',
  THEMES.every(x => cssThemes.some(c => c.id === x.id)));
t('every CSS block is in the registry',
  cssThemes.every(c => THEMES.some(x => x.id === c.id)));
t('ids are unique', new Set(THEMES.map(x => x.id)).size === THEMES.length);
t('every theme has group/label/blurb',
  THEMES.every(x => x.group && x.label && x.blurb));
t('groups are Fantasy or Sci-fi',
  THEMES.every(x => ['Fantasy','Sci-fi'].includes(x.group)));

for (const c of cssThemes) {
  const missing = required.filter(v => !c.vars.includes(v));
  t(`${c.id}: declares all ${required.length} palette vars` + (missing.length ? ` (missing ${missing.join(', ')})` : ''),
    missing.length === 0);
}

// crude relative-luminance contrast check on the pairs that carry text
const lum = hex => {
  const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
    .map(v => v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return .2126*r + .7152*g + .0722*b;
};
const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+.05)/(y+.05); };
const varOf = (block, name) => (block.match(new RegExp(name+':\\s*(#[0-9a-f]{6})','i'))||[])[1];

for (const m of css.matchAll(/\.upgrades(?:\.upg-theme-([a-z]+))? \{([\s\S]*?)\n\}/g)) {
  const id = m[1] ?? 'abyss', block = m[2];
  const card = varOf(block,'--upg-bg-card'), ink = varOf(block,'--upg-ink'),
        head = varOf(block,'--upg-gold-bright'), dim = varOf(block,'--upg-ink-dim'),
        btnBg = varOf(block,'--upg-gold'), btnInk = varOf(block,'--upg-btn-ink');
  if (!card) continue;
  t(`${id}: body text on card >= 7:1`,  ratio(ink,card)  >= 7);
  t(`${id}: heading on card >= 4.5:1`,  ratio(head,card) >= 4.5);
  t(`${id}: dim text on card >= 4.5:1`, ratio(dim,card)  >= 4.5);
  // the button gradient runs --upg-gold-bright -> --upg-gold; clear both stops
  t(`${id}: button label on gradient top >= 4.5:1`,    ratio(btnInk,head)  >= 4.5);
  t(`${id}: button label on gradient bottom >= 4.5:1`, ratio(btnInk,btnBg) >= 4.5);
}
process.exit(bad);
