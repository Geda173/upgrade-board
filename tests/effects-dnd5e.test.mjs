import { i18n, missed } from './i18n-stub.mjs';
globalThis.CONST = { ACTIVE_EFFECT_MODES:{CUSTOM:0,MULTIPLY:1,ADD:2,DOWNGRADE:3,UPGRADE:4,OVERRIDE:5} };
globalThis.game = { system: { id: "dnd5e" }, i18n };
const { buildChanges, describeBuild, describeRows, getPreset, getPresetGroups, signFormula } =
  await import(new URL('../scripts/effects.js', import.meta.url));

let bad = 0;
const t = (n,c) => { if(!c) bad = 1; console.log((c?'PASS ':'FAIL ')+n); };

/* --- the two user-facing examples --- */
const cold = buildChanges([{ preset:"weapon.damage", value:"1d8[cold]" }]);
t('weapon damage fans out to melee + ranged', cold.length === 2);
t('weapon damage writes mwak path', cold.some(c => c.key === 'system.bonuses.mwak.damage'));
t('weapon damage writes rwak path', cold.some(c => c.key === 'system.bonuses.rwak.damage'));
t('weapon damage uses ADD mode', cold.every(c => c.mode === 2));
const spell = buildChanges([{ preset:"spell.attack", value:"+2" }]);
t('spell attack hits msak + rsak only', spell.length === 2);
t('spell attack does NOT write the nonexistent bonuses.spell.attack',
  !spell.some(c => c.key === 'system.bonuses.spell.attack'));

/* --- the damage-type list is read from a config other modules write into ---
   Observed in a real world running Midi-QOL: 16 entries where dnd5e 5.3.3 ships 13. Two are
   markers for the *absence* of a type and read as nonsense in a list of things to resist; the
   third is a genuine extra type and must survive. */
globalThis.CONFIG = { DND5E: { damageTypes: {
  acid: { label: 'Acid' }, fire: { label: 'Fire' }, cold: { label: 'Cold' },
  'midi-none': { label: 'No Damage' },   // Midi-QOL
  none: { label: 'No Type' },            // Midi-QOL
  vitality: { label: 'Vitality' }        // a third-party type that is real
} } };
const { getDamageTypes } = await import(new URL('../scripts/effects.js', import.meta.url));
const typeIds = getDamageTypes().map(t => t.id);
t('the "no damage" sentinel is dropped', !typeIds.includes('midi-none'));
t('the "no type" sentinel is dropped', !typeIds.includes('none'));
t('a real third-party damage type survives', typeIds.includes('vitality'));
t('the system\'s own types survive', ['acid','fire','cold'].every(id => typeIds.includes(id)));
t('the list is sorted by label', getDamageTypes().map(t => t.label).join() === 'Acid,Cold,Fire,Vitality');

/* --- resistance, immunity, vulnerability ---
   `system.traits.dr` is a DamageTraitField whose `value` is a SetField of damage types
   (release-5.3.3 module/data/actor/templates/traits.mjs), so the change adds the *type* and
   there is no amount. Signing it would put "+fire" into the set. */
const res = buildChanges([{ preset: "resistance", value: "fire" }]);
t('resistance writes the trait set path', res[0].key === 'system.traits.dr.value');
t('resistance adds to the set', res[0].mode === 2);
t('resistance value is the bare damage type', res[0].value === 'fire');
t('resistance value is NOT signed like a formula', res[0].value !== '+fire');
t('immunity writes the di path',
  buildChanges([{ preset: "immunity", value: "poison" }])[0].key === 'system.traits.di.value');
t('vulnerability writes the dv path',
  buildChanges([{ preset: "vulnerability", value: "cold" }])[0].key === 'system.traits.dv.value');
t('a resistance with no type chosen is skipped',
  buildChanges([{ preset: "resistance", value: "" }]).length === 0);
t('describes a resistance as a statement, not a bonus',
  describeBuild([{ preset: "resistance", value: "fire" }]) === 'resistance to fire');

/* --- verified against dnd5e 5.3.3 release source --- */
const SCHEMA_5_3_3 = new Set([
  'system.traits.dr.value','system.traits.di.value','system.traits.dv.value',
  'system.bonuses.mwak.attack','system.bonuses.mwak.damage',
  'system.bonuses.rwak.attack','system.bonuses.rwak.damage',
  'system.bonuses.msak.attack','system.bonuses.msak.damage',
  'system.bonuses.rsak.attack','system.bonuses.rsak.damage',
  'system.bonuses.spell.dc',
  'system.bonuses.abilities.check','system.bonuses.abilities.save','system.bonuses.abilities.skill',
  'system.attributes.ac.bonus','system.attributes.init.bonus',
  'system.attributes.hp.bonuses.overall',
  'system.attributes.movement.walk','system.attributes.movement.fly',
  'system.attributes.hp.bonuses.level',
  // SensesField's own defaults, and the field is a MappingField with initialKeysOnly, so this is
  // the complete set — shared/senses-field.mjs at release-5.3.3.
  ...['darkvision','blindsight','tremorsense','truesight']
    .map(s => `system.attributes.senses.ranges.${s}`),
  // Condition immunity — traits.mjs `ci: new SimpleTraitField`, a SetField like dr/di/dv.
  'system.traits.ci.value',
  // Concentration and death saves are RollConfigFields carrying their own bonus formula, plus a
  // concentration limit — actor/templates/attributes.mjs and actor/character.mjs.
  'system.attributes.concentration.limit','system.attributes.concentration.bonuses.save',
  'system.attributes.death.bonuses.save',
  // Advantage lives on an AdvantageModeField at `<statistic>.roll.mode`, present on every
  // RollConfigField — shared/roll-config-field.mjs, read back in documents/actor/actor.mjs.
  // dnd5e has no roll mode for attack rolls, which is why no attack entry appears here.
  'system.attributes.init.roll.mode','system.attributes.concentration.roll.mode',
  'system.attributes.death.roll.mode',
  ...['str','dex','con','int','wis','cha'].flatMap(a =>
    [`system.abilities.${a}.check.roll.mode`, `system.abilities.${a}.save.roll.mode`]),
  // The system's special traits, from CONFIG.DND5E.characterFlags.
  ...['diamondSoul','elvenAccuracy','enhancedDualWielding','halflingLucky','halflingNimbleness',
      'initiativeAlert','jackOfAllTrades','observantFeat','powerfulBuild','reliableTalent',
      'remarkableAthlete','tavernBrawlerFeat','toolExpertise','weaponCriticalThreshold',
      'spellCriticalThreshold','meleeCriticalDamageDice'].map(f => `flags.dnd5e.${f}`),
  // per-ability saves and per-skill checks, both FormulaFields — actor/templates/common.mjs and
  // actor/templates/creature.mjs at release-5.3.3; skill keys are CONFIG.DND5E.skills
  ...['str','dex','con','int','wis','cha'].map(a => `system.abilities.${a}.bonuses.save`),
  ...['acr','ani','arc','ath','dec','his','ins','itm','inv','med','nat','prc','prf','per','rel',
      'slt','ste','sur'].map(s => `system.skills.${s}.bonuses.check`),
  ...['str','dex','con','int','wis','cha'].map(a => `system.abilities.${a}.value`)
]);
const allKeys = getPresetGroups().flatMap(g => g.presets).flatMap(p => p.keys);
const unknown = [...new Set(allKeys)].filter(k => !SCHEMA_5_3_3.has(k));
t('every preset path exists in dnd5e 5.3.3' + (unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''),
  unknown.length === 0);
t('darkvision uses the 5.3 ranges path',
  getPreset('darkvision').keys[0] === 'system.attributes.senses.ranges.darkvision');

/* --- the stacking bug: formula fields concatenate --- */
t('signFormula adds a sign', signFormula('1d8[cold]') === '+1d8[cold]');
t('signFormula leaves a signed value alone', signFormula('+2') === '+2');
t('signFormula leaves a negative alone', signFormula('-1') === '-1');
t('formula values are signed', cold.every(c => c.value === '+1d8[cold]'));
t('AC value is signed', buildChanges([{preset:"ac",value:"1"}])[0].value === '+1');
t('walk speed is signed', buildChanges([{preset:"speed.walk",value:"10"}])[0].value === '+10');
t('hp max is signed', buildChanges([{preset:"hp.max",value:"10"}])[0].value === '+10');
// two upgrades on the same field must concatenate into a valid formula
const stacked = ['+' + '1d8[cold]', buildChanges([{preset:"weapon.damage",value:"1d6[fire]"}])[0].value];
t('stacked damage bonuses form a valid formula', ('' + stacked[0] + stacked[1]) === '+1d8[cold]+1d6[fire]');

/* --- numeric fields must NOT be signed --- */
t('ability score stays numeric', buildChanges([{preset:"ability.str",value:"2"}])[0].value === '2');
t('darkvision stays numeric', buildChanges([{preset:"darkvision",value:"60"}])[0].value === '60');
t('darkvision uses UPGRADE mode', buildChanges([{preset:"darkvision",value:"60"}])[0].mode === 4);

/* --- hygiene --- */
t('blank values are dropped',  buildChanges([{preset:"ac", value:"  "}]).length === 0);
t('unknown preset is dropped', buildChanges([{preset:"nope", value:"+1"}]).length === 0);
t('custom needs a key',        buildChanges([{preset:"custom", value:"+1", key:""}]).length === 0);
const custom = buildChanges([{preset:"custom", value:"1", key:"system.foo", mode:5}]);
t('custom honours key and mode', custom[0].key === 'system.foo' && custom[0].mode === 5);
t('custom value is left verbatim', custom[0].value === '1');
t('rows accumulate', buildChanges([{preset:"ac",value:"1"},{preset:"weapon.damage",value:"1d4[fire]"}]).length === 3);
t('describeBuild reads naturally',
  describeBuild([{preset:"weapon.damage", value:"1d8[cold]"}]) === '1d8[cold] all weapon damage');

/* --- parity with PF2e: the individual skills and saves --- */
t('every dnd5e skill has its own preset',
  ['acr','ani','arc','ath','dec','his','ins','itm','inv','med','nat','prc','prf','per','rel','slt','ste','sur']
    .every(s => getPreset(`skill.${s}`)));
t('a skill preset writes the check bonus, not the passive one',
  getPreset('skill.ste').keys[0] === 'system.skills.ste.bonuses.check');
t('every ability has its own save preset',
  ['str','dex','con','int','wis','cha'].every(a => getPreset(`save.${a}`)));
t('a save preset writes that ability\'s save bonus',
  getPreset('save.dex').keys[0] === 'system.abilities.dex.bonuses.save');
// Both are FormulaFields, so they concatenate unless signed — the same trap as weapon damage.
t('a skill bonus is signed', buildChanges([{preset:'skill.ste', value:'2'}])[0].value === '+2');
t('a save bonus is signed', buildChanges([{preset:'save.dex', value:'1'}])[0].value === '+1');
t('the blanket "all skills" preset still exists alongside them', !!getPreset('skill.all'));

/* ---------- advantage is counted, not added ----------
 * AdvantageModeField's ADD handler only recognises a delta of exactly +1 or -1; anything else it
 * returns unchanged, so a signed "+1" string or a bonus-sized number would be dropped in silence.
 * That, and the six-path fan-out, is the whole risk in these rows. */
const adv = buildChanges([{ preset: 'adv.save', value: 'advantage' }]);
t('advantage touches every ability save', adv.length === 6);
t('advantage writes the roll mode path', adv[0].key === 'system.abilities.str.save.roll.mode');
t('advantage is the number 1, not a formula', adv[0].value === 1);
t('advantage is NOT signed like a bonus', adv[0].value !== '+1');
t('advantage uses ADD, which is what counts the sources', adv[0].mode === 2);
t('disadvantage is -1',
  buildChanges([{ preset: 'adv.save', value: 'disadvantage' }])[0].value === -1);
t('concentration advantage is a single path',
  buildChanges([{ preset: 'adv.concentration', value: 'advantage' }]).length === 1);
t('a roll row with a nonsense answer is skipped',
  buildChanges([{ preset: 'adv.save', value: 'yes please' }]).length === 0);
t('a roll row with no answer is skipped',
  buildChanges([{ preset: 'adv.save', value: '' }]).length === 0);
t('describes advantage as a sentence, not a bonus',
  describeRows([{ preset: 'adv.save', value: 'advantage' }])[0] === 'Advantage on saving throws');

/* ---------- concentration ---------- */
const limit = buildChanges([{ preset: 'concentration.limit', value: '1' }]);
t('the concentration limit is a real number field', limit[0].value === '1');
t('the concentration limit is not signed', limit[0].value !== '+1');
t('the concentration save bonus is signed like every other formula',
  buildChanges([{ preset: 'concentration.save', value: '2' }])[0].value === '+2');

/* ---------- special traits: a switch, not an amount ---------- */
const talent = buildChanges([{ preset: 'flag.reliableTalent', value: '' }]);
t('a toggle builds with no value typed', talent.length === 1);
t('a toggle writes the system flag', talent[0].key === 'flags.dnd5e.reliableTalent');
t('a toggle overrides rather than adds to an absent flag', talent[0].mode === 5);
t('a toggle is truthy', talent[0].value === 1);
t('a toggle describes as itself', describeRows([{ preset: 'flag.reliableTalent', value: '' }])[0]
  === 'Reliable Talent');
const crit = buildChanges([{ preset: 'flag.weaponCriticalThreshold', value: '19' }]);
t('a crit threshold overrides', crit[0].mode === 5);
t('a crit threshold is not signed', crit[0].value === '19');
// It replaces the number rather than adding to it, so a "+" would say the opposite of the rule.
t('a crit threshold reads as a threshold, not a bonus',
  describeRows([{ preset: 'flag.weaponCriticalThreshold', value: '19' }])[0]
    === 'Weapon critical hit on 19');

/* ---------- condition immunity is a trait set, like the damage ones ---------- */
const ci = buildChanges([{ preset: 'condition.immunity', value: 'frightened' }]);
t('condition immunity writes the ci path', ci[0].key === 'system.traits.ci.value');
t('condition immunity adds the bare condition', ci[0].value === 'frightened');
t('condition immunity is not signed', ci[0].value !== '+frightened');
t('condition immunity with nothing chosen is skipped',
  buildChanges([{ preset: 'condition.immunity', value: '' }]).length === 0);

/* ---------- what "spell damage" can and cannot reach ----------
 * dnd5e reads `system.bonuses.${actionType}.damage` when it builds the first damage part, and
 * only an Attack activity reports msak/rsak — a saving-throw spell asks for
 * `system.bonuses.save.damage`, which is not in the schema. So a Fireball or a Chain Lightning
 * never sees this bonus, no matter what is written here. The preset is named for the limit
 * rather than for the wish, because the failure is otherwise completely silent. */
t('spell damage reaches exactly the two spell-attack paths',
  JSON.stringify(getPreset('spell.damage').keys)
    === JSON.stringify(['system.bonuses.msak.damage', 'system.bonuses.rsak.damage']));
t('no preset claims a save-spell damage path, because dnd5e has none',
  !getPresetGroups().flatMap(g => g.presets).flatMap(p => p.keys)
    .some(k => /^system\.bonuses\.(save|spell)\.damage$/.test(k)));

const all = getPresetGroups().flatMap(g => g.presets);
t('catalog non-empty', all.length > 15);
t('all presets resolvable', all.every(p => getPreset(p.id)));
t('all non-custom presets have keys', all.filter(p => p.id !== 'custom').every(p => p.keys.length > 0));
// A row that asks for one of two answers must never also render a free-text amount, and every
// choice it offers has to compile — an unmatched id is dropped by buildChanges without an error.
for (const p of all.filter(p => p.choices)) {
  t(`${p.id}: every choice it offers compiles`,
    p.choices.every(c => buildChanges([{ preset: p.id, value: c.id }]).length === p.keys.length));
}

globalThis.game.system.id = 'pf2e';
t('pf2e now has its own catalogue', getPresetGroups().flatMap(g => g.presets).length > 25);
globalThis.game.system.id = 'wfrp4e';
t('an unsupported system gets only the custom row',
  getPresetGroups().flatMap(g => g.presets).length === 1);
/* ---------- every preset's wording actually resolves ----------
 * The labels are derived keys (`UPGRADES.Preset.Dnd5e.${id}`), so no static scan of the source
 * can confirm they exist — only walking the real catalogue can. A miss renders the raw key in
 * the editor's target picker, which is exactly the silent-ish failure this file exists to catch. */
for (const g of getPresetGroups()) {
  for (const p of g.presets) { void p.label; void p.group; void p.noun; void p.short; }
}
t(`every dnd5e preset label and group resolves${missed.size ? ` — missing: ${[...missed].join(', ')}` : ''}`,
  missed.size === 0);

process.exit(bad);
