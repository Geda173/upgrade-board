import fs from 'node:fs';
const data = fs.readFileSync(new URL('../scripts/settings.js', import.meta.url), 'utf8');
const app  = fs.readFileSync(new URL('../scripts/apps/settings-app.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../scripts/main.js', import.meta.url), 'utf8');

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

// Brace-match each register() call rather than regex — single-line registers made a lazy
// regex swallow the blocks that followed, which silently skipped a setting from the audit.
function registrations(src) {
  const out = [];
  const re = /S\.register\(MODULE_ID, SETTINGS\.(\w+),\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1, depth = 0;
    do {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    } while (depth > 0 && i < src.length);
    out.push({ key: m[1], body: src.slice(m.index, i) });
  }
  return out;
}

const regs = registrations(data);
// hidden data stores, not user-facing settings
const STORES = ['UPGRADES', 'CATEGORIES', 'BALANCE', 'BALANCES', 'CURRENCIES', 'HISTORY'];
t('every SETTINGS key is registered exactly once',
  new Set(regs.map(r => r.key)).size === regs.length);
t('all 20 settings registered', regs.length === 20);

const userFacing = regs.filter(r => !STORES.includes(r.key));
t('14 user-facing settings', userFacing.length === 14);
t('none still appear in Foundry\'s own list',
  userFacing.every(r => /config:\s*false/.test(r.body)));
t('every user-facing setting is reachable in the setup window',
  userFacing.every(r => app.includes('SETTINGS.' + r.key)));
t('every user-facing setting is written back on save',
  userFacing.every(r => new RegExp('\\[SETTINGS\\.' + r.key + ',').test(app)));
t('display settings still live-refresh',
  userFacing.every(r => /onChange/.test(r.body)));
t('data stores stay hidden and have no onChange',
  regs.filter(r => STORES.includes(r.key)).every(r => /config:\s*false/.test(r.body) && !/onChange/.test(r.body)));

t('Foundry settings list offers a button into the setup window',
  /registerMenu\(MODULE_ID, "setup"/.test(main) && /type: SettingsApp/.test(main));
t('setup menu is GM-only', /restricted: true/.test(main));
t('setup window is exposed on the module API', /openSettings: \(\) => SettingsApp\.show\(\)/.test(main));

process.exit(bad);
