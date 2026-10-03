/**
 * Carrying a world across the v0.22.0 rename from `upgrades` to `upgrade-board`.
 *
 * This exists because the failure mode is somebody's campaign. Foundry files world data under the
 * module id, so the rename hides the catalogue, the balances and the history all at once, and the
 * only thing standing between a GM and an empty board is migrate.js. None of it can be tried out
 * in Foundry without renaming a live world first, so it is checked here instead.
 *
 * The assertion that matters most is the first one: a world setting added later and not added to
 * CARRIED would be dropped on migration, silently, in a way nothing else would ever report.
 */
import fs from 'node:fs';
import { i18n } from './i18n-stub.mjs';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/* ---------- a settings store that behaves like Foundry's ---------- */
function makeSettings() {
  const registered = new Map();
  const stored = new Map();
  return {
    registered, stored,
    register(ns, key, cfg) { registered.set(`${ns}.${key}`, cfg); },
    get(ns, key) {
      const id = `${ns}.${key}`;
      if (!registered.has(id)) throw new Error(`not registered: ${id}`);
      return stored.has(id) ? stored.get(id) : registered.get(id).default;
    },
    async set(ns, key, value) {
      const id = `${ns}.${key}`;
      if (!registered.has(id)) throw new Error(`not registered: ${id}`);
      stored.set(id, value);
      return value;
    }
  };
}

globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.CONFIG = {};
globalThis.game = { system: { id: 'dnd5e' }, i18n, user: { isGM: true }, settings: makeSettings() };

const { MODULE_ID, LEGACY_MODULE_ID, SETTINGS } =
  await import(new URL('../scripts/settings.js', import.meta.url));
const { registerLegacySettings, migrateFromLegacy, MIGRATED } =
  await import(new URL('../scripts/migrate.js', import.meta.url));

t('the module id actually changed', MODULE_ID === 'upgrade-board' && LEGACY_MODULE_ID === 'upgrades');

/* ---------- 1. nothing the old module stored may be left behind ---------- */
const settingsSrc = read('scripts/settings.js');
const migrateSrc = read('scripts/migrate.js');

// Every S.register(MODULE_ID, SETTINGS.X, { ... scope: "world" ... }) in settings.js.
const worldKeys = [...settingsSrc.matchAll(/S\.register\(MODULE_ID,\s*SETTINGS\.(\w+),\s*\{([\s\S]*?)\}\);/g)]
  .filter(m => /scope:\s*"world"/.test(m[2]))
  .map(m => m[1]);
const carried = [...migrateSrc.matchAll(/\[SETTINGS\.(\w+),/g)].map(m => m[1]);
const dropped = worldKeys.filter(k => !carried.includes(k));

t(`every world setting is carried across${dropped.length ? ` — dropped: ${dropped.join(', ')}` : ''}`,
  worldKeys.length > 0 && dropped.length === 0);
t('the list is not padded with keys that are not settings',
  carried.every(k => Object.prototype.hasOwnProperty.call(SETTINGS, k)));

/* ---------- 2. behaviour ---------- */
const seedLegacy = () => {
  const s = globalThis.game.settings;
  s.stored.set(`${LEGACY_MODULE_ID}.${SETTINGS.UPGRADES}`, [{ id: 'a', name: 'Nightbloom' }, { id: 'b', name: 'Ashen Fern' }]);
  s.stored.set(`${LEGACY_MODULE_ID}.${SETTINGS.BALANCES}`, { sprigs: 7 });
  s.stored.set(`${LEGACY_MODULE_ID}.${SETTINGS.CURRENCIES}`, [{ id: 'sprigs', name: 'Sprigs' }]);
  s.stored.set(`${LEGACY_MODULE_ID}.${SETTINGS.HOST_NAME}`, "Elara's Respite");
  s.stored.set(`${LEGACY_MODULE_ID}.${SETTINGS.THEME}`, 'grove');
};

const registerNew = () => {
  const s = globalThis.game.settings;
  for (const key of Object.values(SETTINGS)) {
    s.register(MODULE_ID, key, { scope: 'world', config: false, default: undefined });
  }
};

const fresh = () => {
  globalThis.game.settings = makeSettings();
  registerNew();
  registerLegacySettings();
};

// a world that used the old module
fresh();
seedLegacy();
let result = await migrateFromLegacy();
t('a world with an old board is carried across', result.ran === true);
t('the catalogue arrives intact',
  game.settings.get(MODULE_ID, SETTINGS.UPGRADES)?.length === 2);
t('so do the balances', game.settings.get(MODULE_ID, SETTINGS.BALANCES)?.sprigs === 7);
t('and the vocabulary', game.settings.get(MODULE_ID, SETTINGS.HOST_NAME) === "Elara's Respite");
t('and the theme', game.settings.get(MODULE_ID, SETTINGS.THEME) === 'grove');
t('the count reported back is the number of upgrades', result.upgrades === 2);
t('nothing is deleted from the old namespace',
  game.settings.get(LEGACY_MODULE_ID, SETTINGS.UPGRADES)?.length === 2);

// running twice must not undo a GM's later edits
await game.settings.set(MODULE_ID, SETTINGS.UPGRADES, []);
result = await migrateFromLegacy();
t('it only ever runs once', result.ran === false && result.reason === 'done');
t('a board cleared after migrating stays cleared',
  game.settings.get(MODULE_ID, SETTINGS.UPGRADES).length === 0);
t('the done marker is recorded in the world', game.settings.get(MODULE_ID, MIGRATED) === true);

// a fresh install with nothing to carry
fresh();
result = await migrateFromLegacy();
t('a world with no old board is left alone', result.ran === false && result.reason === 'nothing-to-carry');
t('and is not marked as migrated, so a later import still works',
  game.settings.get(MODULE_ID, MIGRATED) === false);

// both namespaces populated: the live one wins, untouched
fresh();
seedLegacy();
await game.settings.set(MODULE_ID, SETTINGS.UPGRADES, [{ id: 'z', name: 'Already here' }]);
result = await migrateFromLegacy();
t('an in-use board is never overwritten', result.ran === false && result.reason === 'occupied');
t('the in-use catalogue survives',
  game.settings.get(MODULE_ID, SETTINGS.UPGRADES)[0].name === 'Already here');

// players must not write world data
fresh();
seedLegacy();
globalThis.game.user.isGM = false;
result = await migrateFromLegacy();
t('a player never triggers the copy', result.ran === false && result.reason === 'not-gm');
globalThis.game.user.isGM = true;

/* ---------- 3. grants made under the old id stay removable ----------
 *
 * This block used to assert that the source contained `getFlag(LEGACY_MODULE_ID, field)`, which
 * scanned for exactly the call that was broken and so froze the bug in place. `Document#getFlag`
 * validates its scope against the currently active packages and THROWS for anything else — and
 * after the rename, `upgrades` is by definition no longer active. Because the already-granted
 * check runs the predicate over every item the actor owns, it threw before a purchase could
 * apply anything: a migrated world could not buy at all. So this is exercised, not grepped. */
const adapterSrc = read('scripts/systems/adapter.js');
t('the legacy flag is not read through getFlag, which would throw on an inactive scope',
  !/getFlag\(LEGACY_MODULE_ID/.test(adapterSrc));
t('both the refund and the already-granted check go through the same predicate',
  (adapterSrc.match(/flagged\(doc, upgradeId, purchaseId\)/g) ?? []).length >= 2);

await (async () => {
  // A document that behaves the way Foundry's does: getFlag is fine for an active package and
  // raises for anything else. Nothing in the suite modelled that, which is why nothing caught it.
  const ACTIVE = 'upgrade-board';
  const doc = (id, flags) => ({
    id, flags,
    getFlag(scope, key) {
      if (scope !== ACTIVE) throw new Error(`Flag scope "${scope}" is not valid or not currently active`);
      return flags?.[scope]?.[key];
    }
  });

  const deleted = [];
  const actor = {
    name: 'Galadon Stormwhisper',
    items: [
      doc('plain', {}),                                   // an ordinary item, no flags at all
      doc('old', { upgrades: { upgradeId: 'rooted-mind' } }),      // granted before the rename
      doc('new', { 'upgrade-board': { upgradeId: 'rooted-mind' } }) // granted after it
    ],
    effects: [],
    async deleteEmbeddedDocuments(type, ids) { deleted.push(...ids); }
  };

  globalThis.game.actors = [actor];
  globalThis.foundry = { utils: { deepClone: o => structuredClone(o) } };
  const { removeUpgradeEffect } = await import('../scripts/systems/adapter.js');

  let threw = null;
  let result = null;
  try { result = await removeUpgradeEffect('rooted-mind'); }
  catch (err) { threw = err; }

  t(`inspecting an actor's items never throws on the retired scope${threw ? ` — ${threw.message}` : ''}`,
    threw === null);
  t('a grant made before the rename is still found', deleted.includes('old'));
  t('a grant made after the rename is still found', deleted.includes('new'));
  t('an unrelated item is left alone', !deleted.includes('plain'));
  t('both are reported as removed', result?.count === 2);
})();

/* ---------- 4. the rename reached everything that names the module ---------- */
t('the manifest declares the new id',
  JSON.parse(read('module.json')).id === 'upgrade-board');
t('the socket channel follows the id, so it cannot be forgotten',
  /const CHANNEL = `module\.\$\{MODULE_ID\}`/.test(read('scripts/sockets.js')));
t('no source file still hard-codes the old id outside the migration',
  ['scripts/main.js', 'scripts/purchase.js', 'scripts/catalog.js', 'scripts/economy.js']
    .every(f => !/["']upgrades["']/.test(read(f))));
t('the GM is told when their world is carried across',
  /UPGRADES\.Notify\.Migrated/.test(read('scripts/main.js'))
  && typeof JSON.parse(read('lang/en.json')).UPGRADES.Notify.Migrated === 'string');

process.exit(bad);
