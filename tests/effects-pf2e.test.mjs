import { i18n, missed } from './i18n-stub.mjs';
globalThis.CONST = { ACTIVE_EFFECT_MODES:{CUSTOM:0,MULTIPLY:1,ADD:2,DOWNGRADE:3,UPGRADE:4,OVERRIDE:5} };
globalThis.game = { system: { id: "pf2e" }, i18n };
globalThis.CONFIG = {};
const E = await import(new URL('../scripts/effects.js', import.meta.url));
let bad=0; const t=(n,c)=>{if(!c)bad=1;console.log((c?'PASS ':'FAIL ')+n)};

// selectors verified against pf2e-8.3.0 source
const VALID = new Set(["attack","damage","melee-damage","ranged-damage","ac","saving-throw",
  "fortitude","reflex","will","perception","skill-check","spell-attack","spell-dc","class-dc","all-speeds",
  // hp: extractModifiers(synthetics, ["hp"]) in actor/character/document.ts
  // initiative: domains: ["initiative"] in actor/initiative.ts
  // land-speed / fly-speed: speeds filter on ["all-speeds", `${type}-speed`] in actor/creature/document.ts
  "hp","initiative","land-speed","fly-speed",
  // spell-damage: SpellPF2e#getDamageContext builds domains from damageKinds as
  // [kind, `spell-${kind}`, `${id}-${kind}`, ...], so "spell-damage" is present for every spell
  // whether it is an attack or a save. That is why pf2e needs no roll hook for this and dnd5e does.
  "spell-damage",
  "acrobatics","arcana","athletics","crafting","deception","diplomacy","intimidation","medicine",
  "nature","occultism","performance","religion","society","stealth","survival","thievery"]);
const all = E.getPresetGroups().flatMap(g=>g.presets);
t('pf2e catalogue is populated', all.length > 25);
// Resistance and its relatives are rule elements in their own right and carry no selector at all,
// so they are held to a different contract — a ruleKey — rather than skipped quietly.
// A sense is the same kind of exception: Sense's `selector` is a sense type, not a check domain,
// so holding it to the domain list would reject the very thing it is supposed to say.
// Rune presets are field writes compiled by buildRuneWrites, not rule elements — no selector.
const selectorPresets = all.filter(p => p.id !== "custom" && !p.iwr && !p.sense && !p.rune);
const unknown = selectorPresets.flatMap(p=>p.selectors).filter(sel=>!VALID.has(sel));
t('every selector exists in pf2e 8.3.0'+(unknown.length?` (unknown: ${unknown.join(", ")})`:''), unknown.length===0);
t('every non-IWR preset actually has a selector',
  selectorPresets.every(p => Array.isArray(p.selectors) && p.selectors.length > 0));
const iwrPresets = all.filter(p => p.iwr);
t('the IWR presets name a real rule element',
  iwrPresets.length === 4 && iwrPresets.every(p => ["Resistance","Weakness","Immunity"].includes(p.ruleKey)));
t('no IWR preset also claims a selector', iwrPresets.every(p => !p.selectors));

/* --- senses: the Sense rule element, not a modifier ---
   selector is a member of SENSE_TYPES; the four in SENSES_WITH_UNLIMITED_RANGE take no range,
   and the element resolves it to Infinity. src/module/actor/creature/values.ts at pf2e-8.3.0. */
const SENSE_TYPES = new Set(["bloodsense","darkvision","echolocation","electromagnetic-sense",
  "greater-darkvision","infrared-vision","lifesense","low-light-vision","magicsense","motion-sense",
  "scent","see-invisibility","spiritsense","thoughtsense","tremorsense","truesight","wavesense"]);
const UNLIMITED = new Set(["darkvision","greater-darkvision","low-light-vision","see-invisibility"]);
const sensePresets = all.filter(p => p.sense);
t('the catalogue offers senses at all', sensePresets.length >= 8);
t('every sense is a real SENSE_TYPE', sensePresets.every(p => SENSE_TYPES.has(p.sense)));
t('exactly the unlimited-range senses ask for no range',
  sensePresets.every(p => !!p.toggle === UNLIMITED.has(p.sense)));
t('no sense claims a bonus type or selector',
  sensePresets.every(p => !p.selectors && !p.bonusType));
const dark = E.buildRules([{ preset: "sense.darkvision", value: "" }]);
t('an unlimited sense builds without a value', dark.length === 1 && dark[0].key === "Sense");
t('an unlimited sense names the sense as its selector', dark[0].selector === "darkvision");
t('an unlimited sense sends no range', !("range" in dark[0]));
const tremor = E.buildRules([{ preset: "sense.tremorsense", value: "30" }]);
t('a ranged sense carries a numeric range', tremor[0].range === 30);
t('a ranged sense carries its acuity', tremor[0].acuity === "imprecise");
t('acuity is omitted where the rule element mandates it',
  !("acuity" in E.buildRules([{ preset: "sense.truesight", value: "60" }])[0]));
t('a ranged sense with a non-number is skipped',
  E.buildRules([{ preset: "sense.tremorsense", value: "lots" }]).length === 0);

/* --- fortune and misfortune: RollTwice, keeping the higher or lower roll --- */
const fortune = E.buildRules([{ preset: "roll.save", value: "fortune" }]);
t('fortune is a RollTwice rule', fortune[0].key === "RollTwice");
t('fortune keeps the higher roll', fortune[0].keep === "higher");
t('fortune targets the saving-throw domain',
  JSON.stringify(fortune[0].selector) === '["saving-throw"]');
t('misfortune keeps the lower roll',
  E.buildRules([{ preset: "roll.save", value: "misfortune" }])[0].keep === "lower");
t('a roll row never carries a bonus type', !("type" in fortune[0]));
t('advantage is not a word pf2e accepts here',
  E.buildRules([{ preset: "roll.save", value: "advantage" }]).length === 0);

/* --- condition immunity is Immunity pointed at a different vocabulary --- */
const condImm = E.buildRules([{ preset: "condition.immunity", value: "frightened" }]);
t('condition immunity is an Immunity rule', condImm[0].key === "Immunity");
t('condition immunity types are an array', JSON.stringify(condImm[0].type) === '["frightened"]');
t('condition immunity carries no amount', !("value" in condImm[0]));
t('builder is supported on pf2e', E.systemSupportsBuilder());

// the lighthouse: +1 circumstance to hit
const hit = E.buildRules([{preset:"attack", value:"1", bonusType:"circumstance"}], {label:"Lighthouse"});
t('flat bonus is a FlatModifier', hit[0].key === "FlatModifier");
t('flat bonus targets the attack selector', JSON.stringify(hit[0].selector) === '["attack"]');
t('flat bonus is numeric, not a string', hit[0].value === 1);
t('bonus type is carried through', hit[0].type === "circumstance");
t('rule is labelled with the upgrade name', hit[0].label === "Lighthouse");

// dice must not be a FlatModifier
const dice = E.buildRules([{preset:"damage", value:"1d6", damageType:"fire"}]);
t('dice become a DamageDice rule', dice[0].key === "DamageDice");
t('dice number parsed', dice[0].diceNumber === 1);
t('die size parsed', dice[0].dieSize === "d6");
t('damage type carried', dice[0].damageType === "fire");
t('DamageDice carries no numeric value field', dice[0].value === undefined);
t('bare "d8" means one die', E.parseDice("d8").diceNumber === 1);
t('"2d10" parses', E.parseDice("2d10").dieSize === "d10" && E.parseDice("2d10").diceNumber === 2);
t('a flat number is not dice', E.parseDice("2") === null);

// flat damage stays a FlatModifier but keeps its type
const flatDmg = E.buildRules([{preset:"damage", value:"2", damageType:"cold", bonusType:"item"}]);
t('flat damage is a FlatModifier', flatDmg[0].key === "FlatModifier" && flatDmg[0].value === 2);
t('flat damage keeps its damage type', flatDmg[0].damageType === "cold");

// hygiene
t('blank rows skipped', E.buildRules([{preset:"attack", value:" "}]).length === 0);
t('non-numeric junk is skipped', E.buildRules([{preset:"attack", value:"banana"}]).length === 0);
t('custom selectors split on comma', JSON.stringify(
   E.buildRules([{preset:"custom", key:"attack, damage", value:"1"}])[0].selector) === '["attack","damage"]');
t('custom with no selector is skipped', E.buildRules([{preset:"custom", key:"", value:"1"}]).length === 0);
t('default bonus type is circumstance', E.buildRules([{preset:"ac", value:"1"}])[0].type === "circumstance");

// description names the type, since the type decides stacking
t('describes a flat bonus with its type',
  E.describeRows([{preset:"attack", value:"1", bonusType:"item"}])[0] === "Attack rolls +1 item");
t('describes dice without a bonus type',
  E.describeRows([{preset:"damage", value:"1d6", damageType:"fire"}])[0] === "Damage +1d6 fire");

/* ---------- resistance, weakness, immunity ----------
   These are rule elements in their own right, not modifiers. Verified against
   src/module/rules/rule-element/iwr/{resistance,immunity}.ts and the RuleElements registry in
   src/module/rules/index.ts at pf2e-8.3.0: `type` is an array even for one entry, Resistance and
   Weakness carry a numeric `value`, and Immunity declares `readonly value = null`. */
const resist = E.buildRules([{ preset: "resistance", value: "5", damageType: "fire" }]);
t('resistance is its own rule element, not a FlatModifier', resist[0].key === "Resistance");
t('resistance type is an array even for one type', Array.isArray(resist[0].type));
t('resistance names the type', resist[0].type[0] === "fire");
t('resistance value is numeric', resist[0].value === 5);
t('resistance carries no selector', resist[0].selector === undefined);
// A resistance has no stacking type; emitting one would be meaningless at best.
t('resistance carries no bonus type', resist[0].type[0] !== "circumstance" && resist[0].bonusType === undefined);

const weak = E.buildRules([{ preset: "weakness", value: "5", damageType: "cold" }]);
t('weakness uses the Weakness rule element', weak[0].key === "Weakness" && weak[0].value === 5);

const immune = E.buildRules([{ preset: "immunity", value: "poison" }]);
t('immunity uses the Immunity rule element', immune[0].key === "Immunity");
t('immunity takes the type as its whole payload', immune[0].type[0] === "poison");
t('immunity emits no value, because the rule element has none', !("value" in immune[0]));

t('a resistance with no type is skipped rather than written half-formed',
  E.buildRules([{ preset: "resistance", value: "5" }]).length === 0);
t('a resistance with no amount is skipped',
  E.buildRules([{ preset: "resistance", value: "", damageType: "fire" }]).length === 0);
t('a non-numeric resistance amount is skipped',
  E.buildRules([{ preset: "resistance", value: "1d6", damageType: "fire" }]).length === 0);

// the type list must be real: checked against resistanceTypes in src/scripts/config/iwr.ts
const PF2E_RESIST = new Set(["acid","air","alchemical","all-damage","area-damage","axes","bleed",
  "bludgeoning","cold","critical-hits","custom","damage-from-spells","earth","electricity","energy",
  "fire","force","ghost-touch","light","magical","mental","metal","mythic","non-magical","nonlethal",
  "nonlethal-attacks","persistent-damage","physical","piercing","plant","poison","precision",
  "protean-anatomy","radiation","salt","salt-water","slashing","sonic","spells","spirit","time",
  "unarmed-attacks","vitality","void","vorpal","vorpal-adamantine","water","weapons",
  "weapons-shedding-bright-light","wood"]);
const offered = E.getResistanceTypes().map(x => x.id);
const bogus = offered.filter(id => !PF2E_RESIST.has(id));
t('every offered resistance type exists in pf2e 8.3.0'
  + (bogus.length ? ` (unknown: ${bogus.join(", ")})` : ''), bogus.length === 0);
t('the fallback list is not empty', offered.length > 20);
// The PF2e config is shared with every other module too, so the same guard applies there.
globalThis.CONFIG = { PF2E: { resistanceTypes: {
  fire: 'Fire', physical: 'Physical', none: 'No Type', 'midi-none': 'No Damage'
} } };
const live = E.getResistanceTypes().map(x => x.id);
t('null-type sentinels are dropped from the PF2e list too',
  !live.includes('none') && !live.includes('midi-none'));
t('and the real ones survive', live.includes('fire') && live.includes('physical'));
globalThis.CONFIG = {};
t('resistance types are not merely the damage types — physical is offered', offered.includes("physical"));

t('describes a resistance as a statement, not a bonus',
  E.describeRows([{ preset: "resistance", value: "5", damageType: "fire" }])[0] === "Resistance 5 to fire");
t('describes an immunity without an amount',
  E.describeRows([{ preset: "immunity", value: "poison" }])[0] === "Immunity to poison");

// dnd5e must be untouched by all of this
globalThis.game.system.id = "dnd5e";
t('dnd5e still builds ActiveEffect changes',
  E.buildChanges([{preset:"ac", value:"1"}])[0].key === "system.attributes.ac.bonus");
/* ---------- the labels are the interface; jargon alone is not enough ---------- */
for (const b of E.PF2E_BONUS_TYPES) {
  t(`bonus type "${b.id}" explains itself`, typeof b.hint === 'string' && b.hint.length > 30);
  t(`bonus type "${b.id}" is labelled in plain language`, /—|\(/.test(b.label));
}
t('the two rarely-right types say so',
  E.PF2E_BONUS_TYPES.filter(b => /rarely/.test(b.label)).map(b => b.id).sort().join() === 'ability,proficiency');
t('untyped is offered as the just-make-it-work option',
  E.PF2E_BONUS_TYPES.find(b => b.id === 'untyped').label.includes('always stacks'));

/* ---------- every preset's wording actually resolves ----------
 * The labels are derived keys (`UPGRADES.Preset.Dnd5e.${id}`), so no static scan of the source
 * can confirm they exist — only walking the real catalogue can. A miss renders the raw key in
 * the editor's target picker, which is exactly the silent-ish failure this file exists to catch. */
for (const g of E.getPresetGroups()) {
  for (const p of g.presets) { void p.label; void p.group; void p.noun; void p.short; }
}
t(`every pf2e preset label and group resolves${missed.size ? ` — missing: ${[...missed].join(', ')}` : ''}`,
  missed.size === 0);

/* ---------- rune presets: field writes, not rule elements (pf2e-8.3.0) ----------
 * Source shape on a weapon is { potency: 0-4, striking: 0-4, property: [camelCase slugs] } —
 * the "greaterStriking" strings are valuation-table slugs, never stored — and writing the field
 * is sufficient: bonus, dice, level, price and name all derive at prep. These tests run after
 * the missed-key walk above because rune labels resolve through PF2e's own translation keys
 * (PF2E.WeaponPropertyRune.*), which are the system's to provide, not this module's. */
globalThis.game.system.id = 'pf2e';
const runeWarns = [];
globalThis.ui = { notifications: { warn: m => runeWarns.push(m) } };
const swordP = { type: 'weapon', name: 'Sword' };
const armorP = { type: 'armor', name: 'Breastplate' };
t('potency compiles to a field write',
  JSON.stringify(E.buildRuneWrites([{ preset: 'rune.potency', value: '1' }], swordP))
    === JSON.stringify([{ field: 'potency', value: 1 }]));
t('potency is legal on armor too',
  E.buildRuneWrites([{ preset: 'rune.potency', value: '2' }], armorP).length === 1);
t('striking is refused on armor, out loud', (() => {
  const before = runeWarns.length;
  return E.buildRuneWrites([{ preset: 'rune.striking', value: '1' }], armorP).length === 0
    && runeWarns.length === before + 1;
})());
t('resilient is refused on a weapon',
  E.buildRuneWrites([{ preset: 'rune.resilient', value: '1' }], swordP).length === 0);
t('a rune value outside 1-4 is skipped — nothing clamps a stored 7 at this tag',
  E.buildRuneWrites([{ preset: 'rune.potency', value: '7' }], swordP).length === 0
  && E.buildRuneWrites([{ preset: 'rune.striking', value: '0' }], swordP).length === 0);
t('a property rune carries its slug verbatim',
  JSON.stringify(E.buildRuneWrites([{ preset: 'rune.property', value: 'flaming' }], swordP))
    === JSON.stringify([{ field: 'property', slug: 'flaming' }]));
t('rune rows never leak into rule elements',
  E.buildRules([
    { preset: 'rune.potency', value: '1' }, { preset: 'rune.property', value: 'flaming' }
  ]).length === 0);

// Every slug the picker offers must exist in WEAPON_PROPERTY_RUNES at pf2e-8.3.0 — frozen here
// because a wrong slug is stored happily and then does nothing, ever. Each of these was checked
// against src/module/item/physical/runes.ts at that tag on 2026-08-13.
const WEAPON_PROPERTY_RUNES_8_3_0 = new Set([
  'corrosive', 'disrupting', 'flaming', 'frost', 'ghostTouch', 'grievous', 'holy', 'keen',
  'returning', 'serrating', 'shock', 'speed', 'thundering', 'unholy', 'wounding',
  'greaterCorrosive', 'greaterDisrupting', 'greaterFlaming', 'greaterFrost', 'greaterShock',
  'greaterThundering'
]);
const offeredRunes = E.getPropertyRunes();
t('every offered property rune slug exists at pf2e-8.3.0',
  offeredRunes.length > 0 && offeredRunes.every(r => WEAPON_PROPERTY_RUNES_8_3_0.has(r.id)));
t('rune slugs are stored camelCase, never kebab-case',
  offeredRunes.every(r => !r.id.includes('-')));

process.exit(bad);
