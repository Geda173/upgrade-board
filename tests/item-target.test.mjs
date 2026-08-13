/**
 * Upgrades that target an item.
 *
 * Everything here fails silently in Foundry, which is why it is exercised on fake documents that
 * behave like real ones. Four invariants:
 *
 *  - An effect granted to an item carries `transfer: true`, or it sits on the sword doing
 *    nothing — the flag is what carries it to the wielder, and what makes a stashed item grant
 *    nothing.
 *  - The dnd5e wrapper feat is never used on an item: it exists to keep a character sheet tidy.
 *  - A PF2e grant is rules *merged* into the item, each stamped with the module id, because a
 *    merged rule is not a document and the stamp is the only thing refund can find it by.
 *  - Only an item carried by an actor is a target. A sidebar item affects nobody.
 */
import { i18n } from './i18n-stub.mjs';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- a small Foundry ---------- */
class Actor {}
const warnings = [];
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.CONFIG = {};
globalThis.Actor = Actor;
globalThis.ui = { notifications: { warn: m => warnings.push(m), error: m => warnings.push(m), info: () => {} } };
globalThis.foundry = {
  utils: {
    deepClone: o => structuredClone(o),
    getProperty: (o, p) => p.split('.').reduce((v, k) => (v ?? {})[k], o),
    setProperty: (o, p, v) => {
      const parts = p.split('.');
      let cur = o;
      for (const k of parts.slice(0, -1)) cur = (cur[k] ??= {});
      cur[parts.at(-1)] = v;
    }
  }
};

const uuids = new Map();
globalThis.fromUuidSync = uuid => uuids.get(uuid) ?? null;
globalThis.fromUuid = async uuid => uuids.get(uuid) ?? null;

// Documents get a getFlag that behaves like Foundry's: fine for the active package, throwing
// for anything else — the realism that caught the v0.24.1 bug.
let docId = 0;
const enliven = (d, documentName) => ({
  ...d, id: `d${docId++}`, documentName, uuid: `Fake.${documentName}.${docId}`,
  getFlag(scope, key) {
    if (scope !== 'upgrade-board') throw new Error(`Flag scope "${scope}" is not valid or not currently active`);
    return this.flags?.[scope]?.[key];
  }
});

const makeActor = name => Object.assign(new Actor(), {
  name, uuid: `Fake.Actor.${docId++}`, items: [], effects: [],
  async createEmbeddedDocuments(type, docs) {
    this[type === 'Item' ? 'items' : 'effects'].push(...docs.map(d => {
      const doc = enliven(d, type);
      // Effects embedded in a created item become documents of their own, as in Foundry.
      if (Array.isArray(doc.effects)) doc.effects = doc.effects.map(e => enliven(e, 'ActiveEffect'));
      return doc;
    }));
  },
  async deleteEmbeddedDocuments(type, ids) {
    const list = type === 'Item' ? 'items' : 'effects';
    this[list] = this[list].filter(d => !ids.includes(d.id));
  }
});

// PF2e's data prep rebuilds an item's rules through the rule-element schema, which keeps only
// declared fields — the module's per-rule stamp survives in _source but NEVER appears in
// prepared data. The fakes mirror that split, because reading the prepared array is exactly
// the live-only bug the first PF2e pass found (refund stripped nothing): prepared === source
// in a naive fake, and the suite swore the broken code was fine.
const RULE_FIELDS = new Set(['key', 'selector', 'label', 'type', 'value', 'slug', 'priority',
  'ignored', 'predicate', 'requiresEquipped', 'requiresInvestment', 'diceNumber', 'dieSize',
  'damageType', 'keep', 'acuity', 'range']);
const prepared = system => {
  const sys = foundry.utils.deepClone(system);
  if (Array.isArray(sys.rules)) {
    sys.rules = sys.rules.map(rule =>
      Object.fromEntries(Object.entries(rule).filter(([k]) => RULE_FIELDS.has(k))));
  }
  return sys;
};

const makeItem = (name, parent, rules = null, { type = 'weapon', system = null } = {}) => {
  const src = { system: system ?? (rules ? { rules } : {}), flags: {} };
  const item = enliven({
    name, parent, type, effects: [],
    system: prepared(src.system),
    flags: src.flags,
    async createEmbeddedDocuments(_type, docs) {
      this.effects.push(...docs.map(d => enliven(d, 'ActiveEffect')));
    },
    async deleteEmbeddedDocuments(_type, ids) { this.effects = this.effects.filter(d => !ids.includes(d.id)); },
    // Foundry's Item#update takes flattened key paths and writes SOURCE data; the prepared
    // view is then rebuilt, stripping undeclared rule keys the way PF2e does.
    async update(data) {
      for (const [key, value] of Object.entries(data)) foundry.utils.setProperty(src, key, value);
      this.system = prepared(src.system);
      this.flags = src.flags;
    },
    toObject() { return foundry.utils.deepClone(src); }
  }, 'Item');
  parent?.items?.push(item);
  return item;
};

globalThis.game = {
  system: { id: 'dnd5e' }, i18n, actors: [], items: [],
  settings: { get: () => '' }, user: { isGM: true }
};

const { TARGET } = await import(new URL('../scripts/catalog.js', import.meta.url));
const { MODULE_ID } = await import(new URL('../scripts/settings.js', import.meta.url));
const adapter = await import(new URL('../scripts/systems/adapter.js', import.meta.url));

/* ---------- target resolution ---------- */
const galadon = makeActor('Galadon Stormwhisper');
const sword = makeItem('Voidsteel Blade', galadon);
uuids.set('Actor.g.Item.sword', sword);
game.actors = [galadon];

const swordUpgrade = {
  id: 'keen-edge', name: 'Keen Edge', target: TARGET.ITEM, targetItemUuid: 'Actor.g.Item.sword',
  effectMode: 'link', effectUuid: 'fx.keen', repeatable: false, purchases: []
};

t('an item target resolves to the item itself',
  adapter.getTargetDocuments(swordUpgrade)[0] === sword);
t('a missing item resolves to nothing',
  adapter.getTargetDocuments({ ...swordUpgrade, targetItemUuid: 'Actor.g.Item.gone' }).length === 0);

const loose = makeItem('Museum Piece', null);
uuids.set('Item.loose', loose);
t('a sidebar item nobody carries is not a target',
  adapter.getTargetDocuments({ ...swordUpgrade, targetItemUuid: 'Item.loose' }).length === 0);

t('the target is described as the item and its carrier',
  adapter.describeTarget(swordUpgrade) === 'Voidsteel Blade (carried by Galadon Stormwhisper)');

/* ---------- dnd5e: an effect lands on the item, transferring, unwrapped ---------- */
uuids.set('fx.keen', {
  documentName: 'ActiveEffect', name: 'Keen Edge',
  toObject: () => ({ _id: 'x', name: 'Keen Edge', changes: [{ key: 'system.bonuses.mwak.attack', mode: 2, value: '+1' }], transfer: false })
});

let applied = await adapter.applyUpgradeEffect(swordUpgrade, { purchaseId: 'p1' });
t('the grant lands on the item, not the actor',
  sword.effects.length === 1 && galadon.effects.length === 0);
t('no wrapper feat is created around it',
  galadon.items.length === 1 /* just the sword itself */);
t('the effect transfers to whoever carries the item',
  sword.effects[0]?.transfer === true);
t('the grant is flagged with the upgrade id',
  sword.effects[0]?.flags?.[MODULE_ID]?.upgradeId === 'keen-edge');
t('the application is reported against the item',
  applied.count === 1 && applied.names[0] === 'Voidsteel Blade');

applied = await adapter.applyUpgradeEffect(swordUpgrade, { purchaseId: 'p2' });
t('a second purchase of a non-repeatable upgrade does not double the grant',
  applied.count === 0 && sword.effects.length === 1);

/* ---------- the same payload on an actor still gets the wrapper feat ---------- */
const anders = makeActor('Ander Raventail');
game.actors.push(anders);
game.actors.get = id => (id === 'ander' ? anders : null);
await adapter.applyUpgradeEffect(
  { ...swordUpgrade, id: 'keen-mind', target: TARGET.ACTOR, targetActorId: 'ander', showInEffectsBar: false },
  {});
t('the actor path still wraps the effect in a quiet feat',
  anders.items.length === 1 && anders.items[0].type === 'feat' && anders.items[0].effects?.[0]?.transfer === true);

/* ---------- a linked document an item cannot carry is refused, said out loud ---------- */
uuids.set('fx.feature', {
  documentName: 'Item', name: 'Some Feature',
  toObject: () => ({ _id: 'y', name: 'Some Feature', type: 'feat', system: { description: { value: '' } } })
});
warnings.length = 0;
applied = await adapter.applyUpgradeEffect({ ...swordUpgrade, id: 'other', effectUuid: 'fx.feature' }, {});
t('a linked feature cannot land on an item and the GM is told',
  applied.count === 0 && warnings.some(w => w.includes('cannot carry')));

/* ---------- PF2e: rules merge into the item, stamped ---------- */
game.system.id = 'pf2e';
const seelah = makeActor('Test Character 1');
const gmRule = { key: 'FlatModifier', selector: 'ac', value: 1 };
const staff = makeItem('Worldbough Staff', seelah, [gmRule]);
uuids.set('Actor.s.Item.staff', staff);
game.actors = [galadon, anders, seelah];

uuids.set('fx.flame', {
  documentName: 'Item', name: 'Flame Rune',
  toObject: () => ({ _id: 'z', name: 'Flame Rune', type: 'effect', system: {
    rules: [{ key: 'DamageDice', selector: 'strike-damage', diceNumber: 1, dieSize: 'd6', damageType: 'fire' }]
  } })
});
const staffUpgrade = {
  id: 'flame-rune', name: 'Flame Rune', target: TARGET.ITEM, targetItemUuid: 'Actor.s.Item.staff',
  effectMode: 'link', effectUuid: 'fx.flame', repeatable: true, purchases: []
};

applied = await adapter.applyUpgradeEffect(staffUpgrade, { purchaseId: 'p1' });
t('the rules merge into the item alongside what the GM already wrote',
  applied.count === 1 && staff.system.rules.length === 2
  && JSON.stringify(staff.system.rules[0]) === JSON.stringify(gmRule));
t('each merged rule is stamped with the module id and purchase — in SOURCE, where it survives',
  staff.toObject().system.rules[1]?.[MODULE_ID]?.upgradeId === 'flame-rune'
  && staff.toObject().system.rules[1]?.[MODULE_ID]?.purchaseId === 'p1');
t('the stamp never appears in prepared data, which is why nothing may read it from there',
  staff.system.rules[1]?.[MODULE_ID] === undefined);
t('no document was created on the item for a merged grant', staff.effects.length === 0);

applied = await adapter.applyUpgradeEffect(staffUpgrade, { purchaseId: 'p2' });
t('a repeat purchase stacks a second copy of the rules',
  applied.count === 1 && staff.system.rules.length === 3);
applied = await adapter.applyUpgradeEffect(staffUpgrade, { purchaseId: 'p2' });
t('but the same purchase applied twice does not',
  applied.count === 0 && staff.system.rules.length === 3);

/* ---------- refund finds all of it and touches nothing else ---------- */
await adapter.removeUpgradeEffect('flame-rune', 'p2');
t('refunding one purchase strips that purchase’s rules only',
  staff.system.rules.length === 2
  && staff.toObject().system.rules[1]?.[MODULE_ID]?.purchaseId === 'p1');
await adapter.removeUpgradeEffect('flame-rune');
t('deleting the upgrade strips the rest and leaves the GM’s own rule',
  staff.system.rules.length === 1 && JSON.stringify(staff.system.rules[0]) === JSON.stringify(gmRule));

game.system.id = 'dnd5e';
let removed = await adapter.removeUpgradeEffect('keen-edge');
t('refund reaches an effect embedded on a carried item',
  removed.count === 1 && sword.effects.length === 0);

/* ---------- an upgraded item traded back to the sidebar is still cleaned ---------- */
const stray = makeItem('Pawned Blade', null);
stray.effects.push(enliven({ flags: { [MODULE_ID]: { upgradeId: 'keen-edge' } } }, 'ActiveEffect'));
game.items = [stray];
removed = await adapter.removeUpgradeEffect('keen-edge');
t('refund sweeps sidebar items too', removed.count === 1 && stray.effects.length === 0);

/* ---------- dnd5e item presets: the "+1 flaming sword" is an enchantment ----------
 * An ordinary transferring effect never reaches the item's own data — only an effect of
 * type "enchantment" with a non-self origin does (Item5e.allApplicableEffects at
 * release-5.3.3). So the item rows must arrive as their own effect: type enchantment,
 * origin the carrier, transfer false, and the wielder rows (if any) stay on the familiar
 * transferring effect beside it. */
const daeron = makeActor('Daeron the Vigilant');
const blade = makeItem('Cinder Blade', daeron);
uuids.set('Actor.d.Item.blade', blade);
game.actors = [galadon, anders, daeron, seelah];
game.items = [];

const plusOne = {
  id: 'plus-one', name: 'Plus One, Flaming', target: TARGET.ITEM,
  targetItemUuid: 'Actor.d.Item.blade', effectMode: 'build',
  effectBuild: { rows: [
    { preset: 'item.magic', value: '1' },
    { preset: 'item.damage', value: '1d6', damageType: 'fire' },
    { preset: 'ac', value: '1' }                       // a wielder row, mixed in on purpose
  ] },
  repeatable: false, purchases: []
};
applied = await adapter.applyUpgradeEffect(plusOne, { purchaseId: 'p10' });
const enchGrant = blade.effects.find(e => e.type === 'enchantment');
const wielderGrant = blade.effects.find(e => e.type !== 'enchantment');
t('the item rows land as an enchantment on the blade', applied.count === 1 && !!enchGrant);
t('its origin is the carrier, never the blade itself',
  enchGrant?.origin === daeron.uuid && enchGrant?.origin !== blade.uuid);
t('an enchantment does not transfer — it is about the sword, not the wielder',
  enchGrant?.transfer === false && enchGrant?.disabled === false);
t('it writes the magical bonus as UPGRADE plus the mgc property',
  enchGrant?.changes.some(c => c.key === 'system.magicalBonus' && c.mode === 4 && c.value === '1')
  && enchGrant?.changes.some(c => c.key === 'system.properties' && c.value === 'mgc'));
t('the flame damage rides the enchantment unsigned',
  enchGrant?.changes.some(c => c.key === 'system.damageBonus' && c.value === '1d6[fire]'));
t('the wielder row stays on a separate transferring effect',
  wielderGrant?.transfer === true
  && wielderGrant?.changes.some(c => c.key === 'system.attributes.ac.bonus')
  && !wielderGrant?.changes.some(c => c.key === 'system.magicalBonus'));
t('both pieces are flagged for refund',
  blade.effects.every(e => e.flags?.[MODULE_ID]?.upgradeId === 'plus-one'));

removed = await adapter.removeUpgradeEffect('plus-one');
t('refund sweeps the enchantment and the wielder effect together',
  removed.count === 2 && blade.effects.length === 0);

/* ---------- PF2e rune presets: field writes with a recorded handle ---------- */
game.system.id = 'pf2e';
const runeSword = makeItem('Worldbough Blade', seelah, null,
  { type: 'weapon', system: { runes: { potency: 0, striking: 0, property: [] } } });
uuids.set('Actor.s.Item.runeSword', runeSword);

const runeUpgrade = {
  id: 'first-rune', name: 'First Rune', target: TARGET.ITEM,
  targetItemUuid: 'Actor.s.Item.runeSword', effectMode: 'build',
  effectBuild: { rows: [
    { preset: 'rune.potency', value: '1' },
    { preset: 'rune.striking', value: '1' },
    { preset: 'rune.property', value: 'flaming' }
  ] },
  repeatable: true, purchases: []
};
applied = await adapter.applyUpgradeEffect(runeUpgrade, { purchaseId: 'r1' });
t('the rune fields are written on the item',
  applied.count === 1 && runeSword.system.runes.potency === 1
  && runeSword.system.runes.striking === 1
  && JSON.stringify(runeSword.system.runes.property) === JSON.stringify(['flaming']));
t('no document is created for a rune grant', runeSword.effects.length === 0);
t('each write is recorded under the module flag, with its purchase',
  runeSword.flags[MODULE_ID]?.runeGrants?.length === 3
  && runeSword.flags[MODULE_ID].runeGrants.every(g => g.upgradeId === 'first-rune' && g.purchaseId === 'r1'));

warnings.length = 0;
applied = await adapter.applyUpgradeEffect(runeUpgrade, { purchaseId: 'r2' });
t('a repeat purchase that cannot raise anything grants nothing and says why',
  applied.count === 0 && runeSword.system.runes.potency === 1
  && runeSword.flags[MODULE_ID].runeGrants.length === 3 && warnings.length >= 3);

const betterRune = { ...runeUpgrade, id: 'better-rune',
  effectBuild: { rows: [{ preset: 'rune.potency', value: '2' }] }, purchases: [] };
await adapter.applyUpgradeEffect(betterRune, { purchaseId: 'r3' });
t('a stronger potency raises the field and records where it came from',
  runeSword.system.runes.potency === 2
  && runeSword.flags[MODULE_ID].runeGrants.find(g => g.upgradeId === 'better-rune')?.from === 1);

removed = await adapter.removeUpgradeEffect('better-rune');
t('refunding the stronger rune steps potency back down',
  removed.count === 1 && runeSword.system.runes.potency === 1);

warnings.length = 0;
await runeSword.update({ 'system.runes.striking': 3 });   // the GM improved it by hand since
removed = await adapter.removeUpgradeEffect('first-rune');
t('refund reverses what it wrote and leaves the hand-edited field alone, out loud',
  removed.count === 3 && runeSword.system.runes.potency === 0
  && runeSword.system.runes.striking === 3
  && runeSword.system.runes.property.length === 0
  && warnings.length === 1);
t('the records go with the refund',
  (runeSword.flags[MODULE_ID].runeGrants ?? []).length === 0);

process.exit(bad);
