/**
 * The spell-damage bonus, which is the only place this module reaches into a roll.
 *
 * It exists because dnd5e has no actor field that adds damage to a spell resolved by a saving
 * throw: `system.bonuses.${actionType}.damage` is only ever msak/rsak for an Attack activity, and
 * `system.bonuses.save.damage` is not in the schema. A GM bought "+1d6 cold to spell damage",
 * cast Chain Lightning, and watched nothing happen — twice, because the first fix only renamed
 * the label to admit the limit.
 *
 * Everything here is the module's own logic, so it can be exercised without a Foundry. What
 * cannot be checked here is that dnd5e still fires `dnd5e.preRollDamageV2` with `subject` and
 * `rolls` in this shape; that is pinned by the comment in dnd5e-damage.js citing basic-roll.mjs
 * and by the frozen schema in effects-dnd5e.
 */
import { i18n } from './i18n-stub.mjs';

globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.game = { system: { id: 'dnd5e' }, i18n };
globalThis.CONFIG = {};

const { applySpellDamageBonus, spellDamageBonus, SPELL_DAMAGE_FLAG } =
  await import(new URL('../scripts/systems/dnd5e-damage.js', import.meta.url));
const { buildChanges, buildRules, getPreset, getPresetGroups, describeRows } =
  await import(new URL('../scripts/effects.js', import.meta.url));

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const MODULE_ID = 'upgrade-board';

/* ---------- reading the flag ---------- */
const withFlag = value => ({ flags: { [MODULE_ID]: { [SPELL_DAMAGE_FLAG]: value } } });

t('an actor with no flags has no bonus', spellDamageBonus({}) === null);
t('a missing actor is not an error', spellDamageBonus(null) === null);
t('a bought bonus is read back', spellDamageBonus(withFlag('+1d6[cold]')) === '+1d6[cold]');
t('an empty formula is not a bonus', spellDamageBonus(withFlag('   ')) === null);
t('a zero formula is not a bonus', spellDamageBonus(withFlag('+0')) === null);
// The flag is read off `doc.flags` rather than through getFlag, which throws for a scope that is
// not an active package. Nothing here should ever call a method on the actor.
t('the actor is never asked for a method', spellDamageBonus({
  flags: { [MODULE_ID]: { [SPELL_DAMAGE_FLAG]: '+1d6[cold]' } },
  getFlag() { throw new Error('getFlag must not be called'); }
}) === '+1d6[cold]');

/* ---------- appending to a roll ---------- */
const roll = (itemType, flagValue, parts = ['10d8']) => ({
  subject: { item: { type: itemType }, actor: flagValue ? withFlag(flagValue) : {} },
  rolls: [{ parts: [...parts], options: { type: 'lightning' } }]
});

const spell = roll('spell', '+1d6[cold]');
t('a spell picks the bonus up', applySpellDamageBonus(spell) === true);
t('it lands on the first damage part, where dnd5e puts its own bonuses',
  JSON.stringify(spell.rolls[0].parts) === JSON.stringify(['10d8', '+1d6[cold]']));
t('the existing damage is left alone', spell.rolls[0].options.type === 'lightning');

// A save spell is the entire point — this is the case the system itself cannot reach.
const save = roll('spell', '+1d6[cold]', ['10d8']);
save.subject.item.type = 'spell';
t('a save spell is not treated differently from an attack spell',
  applySpellDamageBonus(save) === true && save.rolls[0].parts.length === 2);

t('a weapon is left alone', applySpellDamageBonus(roll('weapon', '+1d6[cold]')) === false);
t('a feat is left alone', applySpellDamageBonus(roll('feat', '+1d6[cold]')) === false);
t('a spell with no bonus bought is left alone', applySpellDamageBonus(roll('spell', null)) === false);
t('a roll with no parts is survivable', applySpellDamageBonus({
  subject: { item: { type: 'spell' }, actor: withFlag('+1d6[cold]') }, rolls: []
}) === false);
t('a malformed config is survivable', applySpellDamageBonus({}) === false);
t('an empty config is survivable', applySpellDamageBonus(undefined) === false);

// Both hook names fire for every roll, so the same config can arrive twice.
const twice = roll('spell', '+1d6[cold]');
applySpellDamageBonus(twice);
t('a second pass over the same roll adds nothing', applySpellDamageBonus(twice) === false);
t('and the formula is not doubled', twice.rolls[0].parts.length === 2);

/* ---------- the preset that feeds it ---------- */
const preset = getPreset('spell.damage.all');
t('the dnd5e preset exists', !!preset);
t('it is flagged as a module path, not a system one', preset.moduleFlag === true);
t('it writes the flag this file reads',
  JSON.stringify(preset.keys) === JSON.stringify([`flags.${MODULE_ID}.spellDamage`]));

const change = buildChanges([{ preset: 'spell.damage.all', value: '1d6', damageType: 'cold' }]);
t('the preset builds one change', change.length === 1);
t('the formula is signed, so two upgrades compose instead of concatenating',
  change[0].value === '+1d6[cold]');
t('it adds rather than overrides', change[0].mode === 2);
// Composition is the whole reason for the sign: "+1d6[cold]" then "+1d4[fire]" must read as a
// formula, not as the string "1d6[cold]1d4[fire]".
t('the composed pair is a formula the hook can hand to dnd5e',
  spellDamageBonus(withFlag('+1d6[cold]+1d4[fire]')) === '+1d6[cold]+1d4[fire]');
t('it describes itself as damage',
  describeRows([{ preset: 'spell.damage.all', value: '1d6', damageType: 'cold' }])[0].includes('cold'));

/* ---------- and its PF2e counterpart, which needs no hook ---------- */
globalThis.game.system.id = 'pf2e';
const pf = getPreset('spell.damage.all');
t('pf2e has the same concept', !!pf);
t('pf2e reaches it with a real selector instead of a flag',
  JSON.stringify(pf.selectors) === JSON.stringify(['spell-damage']) && !pf.moduleFlag);
const rule = buildRules([{ preset: 'spell.damage.all', value: '1d6', damageType: 'cold' }]);
t('pf2e builds a DamageDice rule element', rule[0].key === 'DamageDice');
t('pf2e targets the spell-damage domain',
  JSON.stringify(rule[0].selector) === JSON.stringify(['spell-damage']));
t('pf2e carries the damage type', rule[0].damageType === 'cold');
// Nothing on the pf2e side may depend on the hook, which is dnd5e-only by construction.
t('no pf2e preset writes a module flag',
  getPresetGroups().flatMap(g => g.presets).every(p => !p.moduleFlag));
globalThis.game.system.id = 'dnd5e';

/* ---------- the hook is actually registered ---------- */
const main = (await import('node:fs')).readFileSync(new URL('../scripts/main.js', import.meta.url), 'utf8');
t('main.js registers the hook', /registerDamageHooks\(\)/.test(main));
t('main.js imports it', /from "\.\/systems\/dnd5e-damage\.js"/.test(main));

process.exit(bad);
