/**
 * Effect authoring: turn plain-language choices into an ActiveEffect payload,
 * so a GM never has to know a UUID or a system data path.
 *
 * An upgrade carries one of three payload modes:
 *   "none"  — cosmetic only
 *   "link"  — effectUuid points at an existing ActiveEffect or Item (drag & drop in the editor)
 *   "build" — effectBuild.rows are preset bonuses assembled here into ActiveEffect changes
 */
import { MODULE_ID } from "./settings.js";
import { t, localizeFields } from "./i18n.js";

export const EFFECT_MODE = {
  NONE: "none",
  LINK: "link",
  BUILD: "build"
};

const MODES = CONST.ACTIVE_EFFECT_MODES;

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Rows whose value is one of two fixed answers rather than an amount.
 *
 * `value` is what reaches the payload, and the two systems disagree about what that is: dnd5e
 * counts +1 and -1 into an AdvantageModeField, PF2e names which of two rolls to keep. The stored
 * row keeps the symbolic id, so a catalogue stays readable and neither number leaks into world data.
 */
const ADVANTAGE_CHOICES = [{ id: "advantage", value: 1 }, { id: "disadvantage", value: -1 }];
const FORTUNE_CHOICES = [{ id: "fortune", value: "higher" }, { id: "misfortune", value: "lower" }];

/**
 * dnd5e's own special traits, from CONFIG.DND5E.characterFlags (release-5.3.3).
 *
 * These are the boolean ones: the flag exists or it does not, so the row has no amount and the
 * preset is the whole statement. OVERRIDE rather than ADD because the flag is genuinely absent
 * until something sets it, and Foundry's ADD on an undefined boolean is not a defined operation.
 */
const DND5E_TRAIT_FLAGS = [
  "diamondSoul", "elvenAccuracy", "enhancedDualWielding", "halflingLucky", "halflingNimbleness",
  "initiativeAlert", "jackOfAllTrades", "observantFeat", "powerfulBuild", "reliableTalent",
  "remarkableAthlete", "tavernBrawlerFeat", "toolExpertise"
];

/**
 * Preset bonuses, grouped for the editor's dropdown.
 * Paths verified against the dnd5e 5.3.3 actor data models (release-5.3.3).
 *
 * Each preset writes `value` into one or more system paths. `keys` (plural) exists because
 * some player-facing concepts — "all weapon damage" — are several data paths in dnd5e.
 *
 * `type` matters more than it looks. Almost every dnd5e bonus target is a FormulaField, i.e. a
 * *string*, and Foundry's ADD mode on a string concatenates rather than adds. Two upgrades each
 * granting "1d8[cold]" would produce "1d8[cold]1d6[fire]" — not a formula. So formula values are
 * normalised to carry an explicit sign ("+1d8[cold]"), which makes concatenation compose correctly:
 * "" + "+2" + "+3" evaluates as 5. Only genuinely numeric fields use type "number".
 */
const RAW_DND5E = [
  { group: "AttackDamage", id: "weapon.attack", placeholder: "+1",
    keys: ["system.bonuses.mwak.attack", "system.bonuses.rwak.attack"] },
  { group: "AttackDamage", id: "weapon.damage", damage: true, placeholder: "+1d8",
    keys: ["system.bonuses.mwak.damage", "system.bonuses.rwak.damage"] },
  { group: "AttackDamage", id: "melee.attack", placeholder: "+1",
    keys: ["system.bonuses.mwak.attack"] },
  { group: "AttackDamage", id: "melee.damage", damage: true, placeholder: "+1d8",
    keys: ["system.bonuses.mwak.damage"] },
  { group: "AttackDamage", id: "ranged.attack", placeholder: "+1",
    keys: ["system.bonuses.rwak.attack"] },
  { group: "AttackDamage", id: "ranged.damage", damage: true, placeholder: "+1d6",
    keys: ["system.bonuses.rwak.damage"] },

  // dnd5e has no `bonuses.spell.attack`; spell attacks are the melee/ranged spell-attack pair.
  { group: "Spellcasting", id: "spell.attack", placeholder: "+2",
    keys: ["system.bonuses.msak.attack", "system.bonuses.rsak.attack"] },
  { group: "Spellcasting", id: "spell.dc", placeholder: "+1",
    keys: ["system.bonuses.spell.dc"] },
  /**
   * Spell *attack* damage, and the label says so on purpose.
   *
   * dnd5e looks this up as `system.bonuses.${actionType}.damage` when it builds the first damage
   * part (base-activity.mjs `_processDamagePart`), and `getActionType()` only returns msak/rsak
   * for an Attack activity — every other activity reports its own metadata type. A saving-throw
   * spell therefore asks for `system.bonuses.save.damage`, which is not in the schema at all
   * (creature.mjs `bonuses` has mwak/rwak/msak/rsak, abilities and spell.dc, and nothing else).
   * So there is no actor field anywhere in dnd5e 5.3.3 that adds damage to a Fireball or a Chain
   * Lightning, and no preset here can invent one. The label used to read "Spell damage", which
   * promised exactly that and then failed the way everything fails here: in silence.
   * The dnd5e-native answer is an Enchantment writing `system.damageBonus` onto the spell item,
   * which is a document the GM builds and grants through link mode, not a bonus row.
   */
  { group: "Spellcasting", id: "spell.damage", damage: true, placeholder: "+1d4",
    keys: ["system.bonuses.msak.damage", "system.bonuses.rsak.damage"] },

  // Every spell, including the ones resolved by a saving throw — which is to say the ones the
  // preset above cannot reach. There is no system field for it, so this writes to the module's
  // own flag and `systems/dnd5e-damage.js` appends it to the roll. Read the comment at the top
  // of that file before touching either half; they are one feature.
  { group: "Spellcasting", id: "spell.damage.all", damage: true, placeholder: "+1d6",
    moduleFlag: true, keys: [`flags.${MODULE_ID}.spellDamage`] },

  // Concentration is a real statistic in dnd5e 5.3, not a house rule: `limit` is how many spells
  // may be concentrated on at once (NumberField, initial 1, so ADD 1 buys the second) and
  // `bonuses.save` is an ordinary FormulaField. Verified against
  // module/data/actor/templates/attributes.mjs at release-5.3.3. PF2e has no equivalent concept.
  { group: "Spellcasting", id: "concentration.limit", placeholder: "1", type: "number",
    keys: ["system.attributes.concentration.limit"] },
  { group: "Spellcasting", id: "concentration.save", placeholder: "+2",
    keys: ["system.attributes.concentration.bonuses.save"] },

  { group: "Defence", id: "ac", placeholder: "+1",
    keys: ["system.attributes.ac.bonus"] },
  { group: "Defence", id: "hp.max", placeholder: "+10",
    keys: ["system.attributes.hp.bonuses.overall"] },
  /**
   * All saving throws, and it now means all of them.
   *
   * `system.bonuses.abilities.save` reaches the six ability saves, and concentration inherits it
   * for free (`prepareConcentration` builds its save from `ability.save.value`, which already
   * carries the global bonus). Death saves do not: `rollDeathSave` starts from an empty parts
   * array and adds only proficiency-from-Diamond-Soul and `attributes.death.bonuses.save`. Its
   * own doc comment claims "plus any global save bonuses", which is not what the code does.
   * So the death path is listed explicitly — a death save is a saving throw, and a preset called
   * "all saving throws" that quietly skipped the roll people care most about was the same broken
   * promise as "spell damage" that meant spell *attack* damage. Verified against release-5.3.3.
   */
  { group: "Defence", id: "save.all", placeholder: "+1",
    keys: ["system.bonuses.abilities.save", "system.attributes.death.bonuses.save"] },

  // dnd5e keeps these as *sets of damage types*, not numbers: `system.traits.dr` is a
  // DamageTraitField whose `value` is a SetField, so the change adds the type itself and there
  // is no amount to give. Verified against release-5.3.3 module/data/actor/templates/traits.mjs.
  { group: "Defence", id: "resistance", iwr: true,
    valueIsType: true, type: "set", keys: ["system.traits.dr.value"] },
  { group: "Defence", id: "immunity", iwr: true,
    valueIsType: true, type: "set", keys: ["system.traits.di.value"] },
  { group: "Defence", id: "vulnerability", iwr: true,
    valueIsType: true, type: "set", keys: ["system.traits.dv.value"] },

  // Per-ability saves. PF2e has had Fortitude/Reflex/Will separately since the builder shipped;
  // dnd5e could only ever say "all saves". Verified against actor/templates/common.mjs
  // (release-5.3.3): each ability carries bonuses.{check,save}, both FormulaFields — so they are
  // signed like every other formula target, not treated as numbers.
  ...ABILITIES.map(key => ({
    group: "Defence", id: `save.${key}`, placeholder: "+1",
    keys: [`system.abilities.${key}.bonuses.save`]
  })),

  // Condition immunity is the same shape as the damage traits above — a SetField that the change
  // adds a member to, with no amount — but it is stocked from CONFIG.DND5E.conditionTypes rather
  // than the damage list. Verified against traits.mjs (`ci: new SimpleTraitField`) at release-5.3.3.
  { group: "Defence", id: "condition.immunity", iwr: true, conditions: true,
    valueIsType: true, type: "set", keys: ["system.traits.ci.value"] },

  // hp.bonuses.level is per level and multiplied by it; hp.bonuses.overall is the flat one above.
  { group: "Defence", id: "hp.level", placeholder: "+1",
    keys: ["system.attributes.hp.bonuses.level"] },
  { group: "Defence", id: "death.save", placeholder: "+1",
    keys: ["system.attributes.death.bonuses.save"] },

  // Broader than it looks, and the label says so. dnd5e feeds `bonuses.abilities.check` into the
  // skill/tool roll *and* into initiative alongside their own bonuses, so this stacks with the two
  // presets below rather than being an alternative to them. Left as the system has it — that
  // summing is dnd5e's own design — but a GM picking from a dropdown had no way to know.
  { group: "Checks", id: "check.all", placeholder: "+1",
    keys: ["system.bonuses.abilities.check"] },
  { group: "Checks", id: "skill.all", placeholder: "+1",
    keys: ["system.bonuses.abilities.skill"] },
  { group: "Checks", id: "init", placeholder: "+2",
    keys: ["system.attributes.init.bonus"] },

  // Ability scores are real NumberFields, so these add arithmetically.
  { group: "AbilityScores", id: "ability.str", placeholder: "2", type: "number",
    keys: ["system.abilities.str.value"] },
  { group: "AbilityScores", id: "ability.dex", placeholder: "2", type: "number",
    keys: ["system.abilities.dex.value"] },
  { group: "AbilityScores", id: "ability.con", placeholder: "2", type: "number",
    keys: ["system.abilities.con.value"] },
  { group: "AbilityScores", id: "ability.int", placeholder: "2", type: "number",
    keys: ["system.abilities.int.value"] },
  { group: "AbilityScores", id: "ability.wis", placeholder: "2", type: "number",
    keys: ["system.abilities.wis.value"] },
  { group: "AbilityScores", id: "ability.cha", placeholder: "2", type: "number",
    keys: ["system.abilities.cha.value"] },

  // The individual skills, to match what PF2e has always offered. Keys are the system's own
  // three-letter ids from CONFIG.DND5E.skills; the bonus path is skills.<key>.bonuses.check,
  // a FormulaField, verified against actor/templates/creature.mjs at release-5.3.3.
  ...["acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv",
      "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"]
    .map(key => ({
      group: "Skills", id: `skill.${key}`, placeholder: "+2",
      keys: [`system.skills.${key}.bonuses.check`]
    })),

  /**
   * Advantage, as data.
   *
   * Every dnd5e RollConfigField carries an AdvantageModeField at `<statistic>.roll.mode`, whose
   * ADD handler counts sources of advantage (+1) and disadvantage (-1) and then resolves them by
   * the game's own rule — any number of each cancels to a straight roll. So this is genuinely a
   * grant of advantage and not a +5 pretending to be one. Verified against
   * module/data/fields/advantage-mode-field.mjs and its consumers in documents/actor/actor.mjs
   * (release-5.3.3). There is deliberately no attack-roll entry: dnd5e stores no roll mode for
   * attacks, so offering one would write a path that silently does nothing.
   */
  { group: "Rolls", id: "adv.check", choices: ADVANTAGE_CHOICES, type: "number",
    keys: ABILITIES.map(a => `system.abilities.${a}.check.roll.mode`) },
  { group: "Rolls", id: "adv.save", choices: ADVANTAGE_CHOICES, type: "number",
    keys: ABILITIES.map(a => `system.abilities.${a}.save.roll.mode`) },
  { group: "Rolls", id: "adv.init", choices: ADVANTAGE_CHOICES, type: "number",
    keys: ["system.attributes.init.roll.mode"] },
  { group: "Rolls", id: "adv.concentration", choices: ADVANTAGE_CHOICES, type: "number",
    keys: ["system.attributes.concentration.roll.mode"] },
  { group: "Rolls", id: "adv.death", choices: ADVANTAGE_CHOICES, type: "number",
    keys: ["system.attributes.death.roll.mode"] },

  { group: "Movement", id: "speed.walk", placeholder: "+10",
    keys: ["system.attributes.movement.walk"] },
  // Also a FormulaField — on a creature with no fly speed, "+30" simply yields 30.
  { group: "Movement", id: "speed.fly", placeholder: "+30",
    keys: ["system.attributes.movement.fly"] },

  // Moved under `ranges` in dnd5e 5.3; the old senses.darkvision is a deprecated getter. The
  // four keys are SensesField's own defaults, and the field is a MappingField with
  // `initialKeysOnly`, so nothing outside that set would be accepted.
  ...["darkvision", "blindsight", "tremorsense", "truesight"].map(key => ({
    group: "Senses", id: key, placeholder: "60", type: "number", mode: MODES.UPGRADE,
    keys: [`system.attributes.senses.ranges.${key}`]
  })),

  /**
   * The system's own special traits. These are the switches dnd5e reads out of `flags.dnd5e`
   * for rules that are not a number anywhere — Reliable Talent, Halfling Luck, crit on a 19.
   * Ids come from CONFIG.DND5E.characterFlags at release-5.3.3.
   */
  ...DND5E_TRAIT_FLAGS.map(id => ({
    group: "SpecialTraits", id: `flag.${id}`, toggle: true, type: "number",
    mode: MODES.OVERRIDE, keys: [`flags.dnd5e.${id}`]
  })),
  // The three numeric ones. Both crit thresholds read `?? Infinity` when the flag is absent
  // (weapon.mjs:279, spell.mjs:242), so there is no existing number for DOWNGRADE to take the
  // minimum against — OVERRIDE is the only mode that behaves on an unset flag.
  { group: "SpecialTraits", id: "flag.weaponCriticalThreshold", placeholder: "19",
    type: "number", mode: MODES.OVERRIDE, keys: ["flags.dnd5e.weaponCriticalThreshold"] },
  { group: "SpecialTraits", id: "flag.spellCriticalThreshold", placeholder: "19",
    type: "number", mode: MODES.OVERRIDE, keys: ["flags.dnd5e.spellCriticalThreshold"] },
  { group: "SpecialTraits", id: "flag.meleeCriticalDamageDice", placeholder: "1",
    type: "number", keys: ["flags.dnd5e.meleeCriticalDamageDice"] },

  { group: "Advanced", id: "custom", placeholder: "+1", custom: true, keys: [] }
];

/**
 * PF2e presets. Verified against pf2e-8.3.0.
 *
 * The two catalogues are peers and are kept at parity; what follows is a note on how PF2e differs,
 * not on which system matters more. Bonuses here are structured rule elements rather than formula
 * strings appended to a field, so the whole concatenation problem above simply does not exist.
 * Targets are semantic selectors ("attack", "ac", "fortitude") taken from
 * getStrikeAttackDomains/getAttackDamageDomains and the statistic domains, not data paths that
 * can silently not exist. And PF2e enforces its own stacking rules — only the highest bonus of
 * each type counts — so a +1 item bonus from an upgrade correctly refuses to stack with a
 * magic weapon's, which dnd5e cannot express at all.
 */
const RAW_PF2E = [
  { group: "AttackDamage", id: "attack", selectors: ["attack"], placeholder: "1" },
  { group: "AttackDamage", id: "damage", selectors: ["damage"], damage: true, placeholder: "1d6" },
  { group: "AttackDamage", id: "melee.damage", selectors: ["melee-damage"], damage: true, placeholder: "1d6" },
  { group: "AttackDamage", id: "ranged.damage", selectors: ["ranged-damage"], damage: true, placeholder: "1d6" },

  { group: "Defence", id: "ac", selectors: ["ac"], placeholder: "1" },
  { group: "Defence", id: "save.all", selectors: ["saving-throw"], placeholder: "1" },
  { group: "Defence", id: "save.fortitude", selectors: ["fortitude"], placeholder: "1" },
  { group: "Defence", id: "save.reflex", selectors: ["reflex"], placeholder: "1" },
  { group: "Defence", id: "save.will", selectors: ["will"], placeholder: "1" },

  // Not modifiers at all: PF2e expresses these as their own rule elements, whose `type` is an
  // *array* of resistance types even when it names one. Resistance and Weakness carry an amount;
  // Immunity declares `readonly value = null` and takes none, so its row asks only for the type.
  // Verified against src/module/rules/rule-element/iwr/{resistance,immunity}.ts and the
  // RuleElements registry in src/module/rules/index.ts at pf2e-8.3.0.
  { group: "Defence", id: "resistance", iwr: true,
    ruleKey: "Resistance", placeholder: "5" },
  { group: "Defence", id: "weakness", iwr: true,
    ruleKey: "Weakness", placeholder: "5" },
  { group: "Defence", id: "immunity", iwr: true,
    valueIsType: true, ruleKey: "Immunity" },
  // Immunity's dictionary covers conditions as well as damage, so condition immunity is the same
  // rule element pointed at a different list. dnd5e keeps the two in separate trait sets.
  { group: "Defence", id: "condition.immunity", iwr: true, conditions: true,
    valueIsType: true, ruleKey: "Immunity" },

  { group: "Checks", id: "perception", selectors: ["perception"], placeholder: "1" },
  { group: "Checks", id: "skill.all", selectors: ["skill-check"], placeholder: "1" },
  ...["acrobatics","arcana","athletics","crafting","deception","diplomacy","intimidation","medicine",
      "nature","occultism","performance","religion","society","stealth","survival","thievery"]
    .map(slug => ({
      group: "Skills", id: `skill.${slug}`, selectors: [slug], placeholder: "1"
    })),

  { group: "Spellcasting", id: "spell.attack", selectors: ["spell-attack"], placeholder: "1" },
  { group: "Spellcasting", id: "spell.dc", selectors: ["spell-dc"], placeholder: "1" },
  // PF2e needs no help here: a spell's damage domains include `damage` and `spell-damage`
  // whether it is an attack or a save, so this is an ordinary DamageDice rule element. The
  // dnd5e side of the same concept has to be granted through a roll hook, because that system
  // has no equivalent field. Verified against SpellPF2e#getDamageContext at pf2e-8.3.0.
  { group: "Spellcasting", id: "spell.damage.all", selectors: ["spell-damage"],
    damage: true, placeholder: "1d6" },
  { group: "Spellcasting", id: "class.dc", selectors: ["class-dc"], placeholder: "1" },

  // Max HP is a real modifier domain here, extracted in the *character* document rather than the
  // creature one — extractModifiers(synthetics, ["hp"]) — which is why it is easy to conclude it
  // does not exist. Initiative and the per-type speeds are ordinary statistic domains.
  { group: "Defence", id: "hp.max", selectors: ["hp"], placeholder: "10" },
  { group: "Checks", id: "init", selectors: ["initiative"], placeholder: "2" },

  /**
   * PF2e has no advantage; it has fortune and misfortune, and the RollTwice rule element is how
   * they are granted — `keep: "higher"` is a fortune effect, `"lower"` a misfortune one. Verified
   * against src/module/rules/rule-element/roll-twice.ts at pf2e-8.3.0. The selectors are ordinary
   * check domains, which is why attack rolls can be offered here and cannot on the dnd5e side.
   */
  { group: "Rolls", id: "roll.attack", rollTwice: true, selectors: ["attack"], choices: FORTUNE_CHOICES },
  { group: "Rolls", id: "roll.save", rollTwice: true, selectors: ["saving-throw"], choices: FORTUNE_CHOICES },
  { group: "Rolls", id: "roll.skill", rollTwice: true, selectors: ["skill-check"], choices: FORTUNE_CHOICES },
  { group: "Rolls", id: "roll.perception", rollTwice: true, selectors: ["perception"], choices: FORTUNE_CHOICES },
  { group: "Rolls", id: "roll.init", rollTwice: true, selectors: ["initiative"], choices: FORTUNE_CHOICES },

  { group: "Movement", id: "speed", selectors: ["all-speeds"], placeholder: "5" },
  // Speeds are filtered on ["all-speeds", `${type}-speed`], so a per-type selector is the type's
  // own name with -speed appended.
  { group: "Movement", id: "speed.walk", selectors: ["land-speed"], placeholder: "5" },
  { group: "Movement", id: "speed.fly", selectors: ["fly-speed"], placeholder: "5" },

  /**
   * Senses, the one thing dnd5e had and PF2e did not.
   *
   * A sense is not a modifier: it is the Sense rule element, whose `selector` is a member of
   * SENSE_TYPES and which carries an acuity and a range instead of a value and a bonus type.
   * The four in SENSES_WITH_UNLIMITED_RANGE take no range at all — the element resolves it to
   * Infinity — so those rows ask for nothing and the preset is the whole statement. Acuity is
   * omitted where SENSES_WITH_MANDATORY_ACUITIES already fixes it, since the rule element
   * overrides anything given there anyway. Verified against sense.ts and
   * src/module/actor/creature/values.ts at pf2e-8.3.0.
   */
  ...["darkvision", "greater-darkvision", "low-light-vision", "see-invisibility"].map(sense => ({
    group: "Senses", id: `sense.${sense}`, sense, toggle: true
  })),
  { group: "Senses", id: "sense.truesight", sense: "truesight", placeholder: "60" },
  { group: "Senses", id: "sense.echolocation", sense: "echolocation", placeholder: "40" },
  { group: "Senses", id: "sense.tremorsense", sense: "tremorsense", acuity: "imprecise", placeholder: "30" },
  { group: "Senses", id: "sense.scent", sense: "scent", acuity: "imprecise", placeholder: "30" },
  { group: "Senses", id: "sense.lifesense", sense: "lifesense", acuity: "imprecise", placeholder: "30" },

  { group: "Advanced", id: "custom", placeholder: "1", custom: true, selectors: [] }
];

/** Systems we have no catalog for get the custom row only. */
const RAW_GENERIC = [
  { group: "Advanced", id: "custom", placeholder: "+1", custom: true, keys: [] }
];

/**
 * PF2e modifier types, from MODIFIER_TYPES in src/module/actor/modifiers.ts.
 * The type is what drives stacking, so it is a first-class choice rather than a hidden default.
 */
const RAW_BONUS_TYPES = [
  { id: "circumstance" },
  { id: "item" },
  { id: "status" },
  { id: "untyped" },
  // Flagged rather than detected from the wording: the legend used to filter on the
  // English "rarely", which any translation silently empties.
  { id: "proficiency", rare: true },
  { id: "ability", rare: true }
];

/**
 * The catalogues, with their wording resolved through `game.i18n` on read.
 *
 * A preset's label and its group heading are derived from its id, so adding one means adding a
 * key rather than touching this. IWR presets also carry a `noun` ("Resistance") — the player-
 * facing description used to produce it by stripping " to a damage type" off the end of the
 * label, which is English grammar hard-coded into the composition and the first thing that
 * breaks in German. `short` does the same job for the one preset whose label carries a
 * parenthetical that reads badly on a card.
 */
const presetFields = catalogue => ({
  group: p => `UPGRADES.PresetGroup.${p.group}`,
  label: p => `UPGRADES.Preset.${catalogue}.${p.id.replaceAll(".", "_")}`,
  // Choice rows need one too: "Advantage on saving throws" is a sentence, and building it out of
  // the picker's label would be composing English grammar out of a fragment again.
  noun: p => ((p.iwr || p.choices) ? `UPGRADES.PresetNoun.${p.id.replaceAll(".", "_")}` : null),
  // Anything that replaces a value rather than adding to it needs a short form too: the picker's
  // label carries a parenthetical telling the GM what to type, which reads badly on a card. A
  // toggle is exempt — it prints its own label and never has an amount appended.
  short: p => ((!p.toggle && (p.mode === MODES.UPGRADE || p.mode === MODES.OVERRIDE))
    ? `UPGRADES.PresetShort.${p.id.replaceAll(".", "_")}` : null)
});

const PRESETS_DND5E = localizeFields(RAW_DND5E, presetFields("Dnd5e"));
const PRESETS_PF2E = localizeFields(RAW_PF2E, presetFields("Pf2e"));
const PRESETS_GENERIC = localizeFields(RAW_GENERIC, presetFields("Generic"));

/** The two answers a choice row can hold, wording resolved on read like everything else. */
const ROLL_CHOICES = localizeFields([...ADVANTAGE_CHOICES, ...FORTUNE_CHOICES],
  { label: c => `UPGRADES.RollChoice.${c.id}` });

/** The choices for one preset, or an empty list when the row asks for an amount instead. */
export function getRowChoices(preset) {
  if (!preset?.choices) return [];
  const ids = new Set(preset.choices.map(c => c.id));
  return ROLL_CHOICES.filter(c => ids.has(c.id));
}

/** What a choice id actually writes into the payload. */
function choiceValue(preset, id) {
  return preset?.choices?.find(c => c.id === id)?.value ?? null;
}

export const PF2E_BONUS_TYPES = localizeFields(RAW_BONUS_TYPES, {
  label: b => `UPGRADES.BonusType.${b.id}`,
  hint: b => `UPGRADES.BonusType.${b.id}Hint`
});

/** Dice sizes PF2e accepts for a DamageDice rule element. */
export const PF2E_DIE_SIZES = ["d4", "d6", "d8", "d10", "d12"];

export function isPf2e() {
  return game.system.id === "pf2e";
}

/** "1d6" -> {diceNumber:1, dieSize:"d6"}; a flat number returns null. */
export function parseDice(value) {
  const m = String(value ?? "").trim().match(/^\+?\s*(\d*)\s*d\s*(\d+)$/i);
  if (!m) return null;
  const diceNumber = m[1] === "" ? 1 : Number(m[1]);
  return { diceNumber, dieSize: `d${m[2]}` };
}

/**
 * Assemble rows into PF2e rule elements.
 *
 * Flat bonuses are FlatModifier; extra dice must be DamageDice instead — FlatModifier's value
 * is numeric, so "1d6" there would not do what a GM expects.
 */
export function buildRules(rows = [], { label = "Upgrade" } = {}) {
  const rules = [];
  for (const row of rows) {
    const raw = String(row.value ?? "").trim();

    const preset = getPreset(row.preset);
    if (!preset) {
      console.warn(`${MODULE_ID} | Unknown effect preset "${row.preset}" — row skipped.`);
      continue;
    }
    // A sense with no range, like darkvision, is the whole statement on its own.
    if (!raw && !preset.toggle) continue;

    // Not a modifier either: a sense carries an acuity and a range where a bonus would carry a
    // value and a stacking type, so it never reaches the selector machinery below.
    if (preset.sense) {
      const range = preset.toggle ? null : Number(raw);
      if (range !== null && !Number.isFinite(range)) {
        console.warn(`${MODULE_ID} | Sense "${preset.sense}" needs a range in feet — row skipped.`);
        continue;
      }
      rules.push({
        key: "Sense", selector: preset.sense,
        ...(preset.acuity ? { acuity: preset.acuity } : {}),
        ...(range === null ? {} : { range })
      });
      continue;
    }

    // Fortune and misfortune are a rule element of their own — there is no modifier that makes
    // you roll twice — so this also bypasses the selector/bonus-type machinery.
    if (preset.rollTwice) {
      const keep = choiceValue(preset, raw);
      if (!keep) {
        console.warn(`${MODULE_ID} | "${raw}" is not a choice ${row.preset} offers — row skipped.`);
        continue;
      }
      rules.push({ key: "RollTwice", selector: preset.selectors, keep });
      continue;
    }

    // Resistance and Weakness are their own rule elements rather than modifiers: no selector, no
    // bonus type, and `type` is an array even when it names exactly one thing. Checked before the
    // selector guard below, which they would otherwise fall foul of by having none.
    if (preset.iwr) {
      // Immunity has no amount, so the row's one field holds the type itself.
      if (preset.valueIsType) {
        rules.push({ key: preset.ruleKey, type: [raw] });
        continue;
      }
      const kind = String(row.damageType ?? "").trim();
      const amount = Number(splitDamageValue(raw).amount.replace(/^\+/, ""));
      if (!kind || !Number.isFinite(amount)) {
        console.warn(`${MODULE_ID} | ${preset.ruleKey} row needs a type and a number — row skipped.`);
        continue;
      }
      rules.push({ key: preset.ruleKey, type: [kind], value: amount });
      continue;
    }

    const selectors = row.preset === "custom"
      ? String(row.key ?? "").trim().split(/[\s,]+/).filter(Boolean)
      : preset.selectors ?? [];
    if (!selectors.length) continue;

    const parsed = splitDamageValue(raw);
    const damageType = preset.damage ? (row.damageType || parsed.damageType || null) : null;
    const dice = preset.damage ? parseDice(parsed.amount) : null;

    if (dice) {
      rules.push({
        key: "DamageDice", selector: selectors, label,
        diceNumber: dice.diceNumber, dieSize: dice.dieSize,
        ...(damageType ? { damageType } : {})
      });
    } else {
      const value = Number(String(parsed.amount).replace(/^\+/, ""));
      if (!Number.isFinite(value)) {
        console.warn(`${MODULE_ID} | "${raw}" is not a number or dice expression — row skipped.`);
        continue;
      }
      rules.push({
        key: "FlatModifier", selector: selectors, label,
        type: row.bonusType || "circumstance", value,
        ...(damageType ? { damageType } : {})
      });
    }
  }
  return rules;
}

/**
 * dnd5e damage types, verified against CONFIG.DND5E.damageTypes in release-5.3.3.
 * Read from the live config when it exists so a system update can't leave this stale.
 */
export function getDamageTypes() {
  const live = CONFIG?.DND5E?.damageTypes;
  if (live && Object.keys(live).length) {
    return sortByLabel(dropNullTypes(Object.entries(live).map(([id, v]) => ({ id, label: v?.label ?? id }))));
  }
  return ["acid","bludgeoning","cold","fire","force","lightning","necrotic",
          "piercing","poison","psychic","radiant","slashing","thunder"]
    .map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
}

/**
 * Drop the "no type at all" sentinels other modules add to the system's damage-type config.
 *
 * Reading that config live is deliberate — a system update must not leave this list stale — but
 * it is shared, and modules write into it. Midi-QOL contributes `none` ("No Type") and
 * `midi-none` ("No Damage"), which are markers for the *absence* of a type and read as nonsense
 * in a list of things to resist.
 *
 * Deliberately narrow: match only ids that literally say "none", never a hardcoded roster of the
 * system's own types. A world that adds a real type — `vitality`, say — must keep it, because
 * resisting it is a perfectly sensible thing to want.
 */
function dropNullTypes(entries) {
  return entries.filter(e => e.id && !/^(none|.*-none)$/.test(e.id));
}

function sortByLabel(entries) {
  return [...entries].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/**
 * What a resistance, weakness, immunity or vulnerability can be *to*.
 *
 * Read from the live config first so a system update cannot leave this stale — PF2e's list is
 * long and includes things that are not damage types at all (physical, precision, all-damage,
 * every material). The frozen fallbacks are the common subset, each checked against
 * `resistanceTypes` in src/scripts/config/iwr.ts (pf2e-8.3.0) and CONFIG.DND5E.damageTypes
 * (release-5.3.3).
 */
export function getResistanceTypes() {
  if (isPf2e()) {
    const live = CONFIG?.PF2E?.resistanceTypes;
    if (live && Object.keys(live).length) {
      // Same passenger problem as the dnd5e list: the config is shared with every other module.
      return sortByLabel(dropNullTypes(Object.entries(live).map(([id, v]) => ({ id, label: labelOf(v, id) }))));
    }
    return ["acid","air","all-damage","bleed","bludgeoning","cold","earth","electricity","energy",
            "fire","force","light","magical","mental","metal","non-magical","physical","piercing",
            "plant","poison","precision","slashing","sonic","spirit","vitality","void","water","wood"]
      .map(id => ({ id, label: titleCase(id) }));
  }
  // dnd5e resists damage types and nothing else, so the damage list is the whole answer.
  return getDamageTypes();
}

/**
 * What a condition immunity can be *to*.
 *
 * Read live for the same reason the damage list is: a system update must not leave it stale, and
 * a world that adds a condition should be able to grant immunity to it. The frozen fallbacks are
 * checked against CONFIG.DND5E.conditionTypes (release-5.3.3) and CONFIG.PF2E.conditionTypes
 * (pf2e-8.3.0). dnd5e's config carries `pseudo` entries — bleeding, burning and friends are
 * status markers the system draws rather than conditions a creature can be immune to — so those
 * are dropped; PF2e has no such flag and needs no equivalent filter.
 */
export function getConditionTypes() {
  if (isPf2e()) {
    const live = CONFIG?.PF2E?.conditionTypes;
    if (live && Object.keys(live).length) {
      return sortByLabel(Object.entries(live).map(([id, v]) => ({ id, label: labelOf(v, id) })));
    }
    return ["blinded","clumsy","confused","controlled","dazzled","deafened","doomed","drained",
            "dying","encumbered","enfeebled","fascinated","fatigued","fleeing","frightened",
            "grabbed","immobilized","paralyzed","petrified","prone","quickened","restrained",
            "sickened","slowed","stunned","stupefied","unconscious","wounded"]
      .map(id => ({ id, label: titleCase(id) }));
  }
  const live = CONFIG?.DND5E?.conditionTypes;
  if (live && Object.keys(live).length) {
    return sortByLabel(Object.entries(live)
      .filter(([, v]) => !v?.pseudo)
      .map(([id, v]) => ({ id, label: v?.name ? t(v.name) : titleCase(id) })));
  }
  return ["blinded","charmed","deafened","exhaustion","frightened","grappled","incapacitated",
          "invisible","paralyzed","petrified","poisoned","prone","restrained","stunned","unconscious"]
    .map(id => ({ id, label: titleCase(id) }));
}

/** PF2e config values are localisation keys; dnd5e's are objects carrying a label. */
function labelOf(value, id) {
  if (typeof value === "string") return titleCase(id);
  return value?.label ?? titleCase(id);
}

function titleCase(id) {
  return String(id).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Split "1d8[cold]" into its amount and type; tolerates a plain "1d8". */
export function splitDamageValue(value) {
  const m = String(value ?? "").match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (m) return { amount: m[1].trim(), damageType: m[2].trim() };
  return { amount: String(value ?? "").trim(), damageType: "" };
}

export function getPresets() {
  if (game.system.id === "dnd5e") return PRESETS_DND5E;
  if (game.system.id === "pf2e") return PRESETS_PF2E;
  return PRESETS_GENERIC;
}

export function getPreset(id) {
  return getPresets().find(p => p.id === id) ?? null;
}

/** True when we ship a real preset catalogue for the current system. */
export function systemSupportsBuilder() {
  return game.system.id === "dnd5e" || game.system.id === "pf2e";
}

/** Presets shaped for a <select> with <optgroup>s. */
export function getPresetGroups() {
  const groups = [];
  for (const preset of getPresets()) {
    let group = groups.find(g => g.label === preset.group);
    if (!group) groups.push(group = { label: preset.group, presets: [] });
    group.presets.push(preset);
  }
  return groups;
}

/**
 * Give a formula value an explicit sign so that stacking composes.
 *
 * dnd5e bonus fields hold formula *strings*, and Foundry's ADD mode concatenates strings.
 * Unsigned values corrupt the formula the moment a second effect touches the same field:
 * "2" then "3" becomes "23". Signed, the same pair becomes "+2+3" — which evaluates to 5.
 */
export function signFormula(value) {
  const v = String(value).trim();
  if (!v || /^[+-]/.test(v)) return v;
  return `+${v}`;
}

/**
 * Assemble an upgrade's built rows into ActiveEffect `changes`.
 * Rows referencing an unknown preset are skipped rather than silently writing a bad path.
 */
export function buildChanges(rows = []) {
  const changes = [];
  for (const row of rows) {
    const raw = String(row.value ?? "").trim();

    if (row.preset === "custom") {
      if (!raw) continue;
      const key = String(row.key ?? "").trim();
      if (!key) continue;
      // Custom rows keep the GM's value verbatim — they chose the path and the mode themselves.
      changes.push({ key, mode: Number(row.mode ?? MODES.ADD), value: raw, priority: null });
      continue;
    }

    const preset = getPreset(row.preset);
    if (!preset) {
      console.warn(`${MODULE_ID} | Unknown effect preset "${row.preset}" — row skipped.`);
      continue;
    }
    // A toggle preset is the whole statement, so there is no amount and nothing to leave blank.
    if (!raw && !preset.toggle) continue;

    const mode = preset.mode ?? MODES.ADD;
    let value;
    if (preset.toggle) {
      value = 1;
    } else if (preset.choices) {
      // Advantage is counted, not added to: the field's ADD handler treats +1 and -1 as sources
      // and cancels them off against each other, which is the rule rather than arithmetic.
      value = choiceValue(preset, raw);
      if (value === null) {
        console.warn(`${MODULE_ID} | "${raw}" is not a choice ${row.preset} offers — row skipped.`);
        continue;
      }
    } else if (preset.valueIsType) {
      // `system.traits.dr.value` is a SetField, and ADD on a set adds the member. The value is
      // the damage type verbatim — signing it would write "+fire" into the set.
      value = raw;
    } else if (preset.damage) {
      // The amount and the type are edited separately; older rows kept "1d8[cold]" in one field.
      const parsed = splitDamageValue(raw);
      const type = (row.damageType ?? parsed.damageType ?? "").trim();
      value = signFormula(parsed.amount) + (type ? `[${type}]` : "");
    } else {
      // Only formula targets need signing; numeric fields add arithmetically already.
      value = (preset.type === "number" || mode !== MODES.ADD) ? raw : signFormula(raw);
    }
    for (const key of preset.keys) {
      changes.push({ key, mode, value, priority: null });
    }
  }
  return changes;
}

/**
 * Human-readable lines describing what a built payload actually does, for players.
 * Phrased as it reads on a card — "All weapon damage +1d4 cold" — rather than as data paths.
 */
export function describeRows(rows = []) {
  const out = [];
  for (const row of rows) {
    const raw = String(row.value ?? "").trim();

    if (row.preset === "custom") {
      if (!raw) continue;
      const key = String(row.key ?? "").trim();
      if (key) out.push(`${key} ${raw}`);
      continue;
    }

    const preset = getPreset(row.preset);
    if (!preset) continue;
    if (!raw && !preset.toggle) continue;

    // A toggle names itself. There is nothing to append and nothing to sign, so the label is the
    // whole line: "Reliable Talent", "Darkvision".
    if (preset.toggle) {
      out.push(preset.label);
      continue;
    }

    // "Advantage on saving throws" — assembled from a noun the preset carries rather than from
    // the picker's label, which is written to read in a dropdown and not mid-sentence.
    if (preset.choices) {
      const choice = getRowChoices(preset).find(c => c.id === raw);
      if (!choice) continue;
      out.push(t("UPGRADES.Describe.RollMode", { choice: choice.label, noun: preset.noun }));
      continue;
    }

    if (preset.sense) {
      out.push(t("UPGRADES.Describe.SenseRange", { label: preset.label, amount: raw }));
      continue;
    }

    // Resistance and its relatives read as a statement, not as a bonus to something. The noun is
    // its own key rather than the label with " to a damage type" chopped off the end, because
    // that chop is English grammar and there is no reason the German label ends the same way.
    if (preset.iwr) {
      const kind = preset.valueIsType ? raw : (row.damageType || "");
      out.push(preset.valueIsType
        ? t("UPGRADES.Describe.IwrPlain", { noun: preset.noun, type: kind })
        : t("UPGRADES.Describe.IwrAmount", { noun: preset.noun, amount: raw, type: kind }));
      continue;
    }

    // PF2e names the bonus type, because the type is what decides whether it stacks.
    if (isPf2e()) {
      const parsed = splitDamageValue(raw);
      const type = preset.damage ? (row.damageType || parsed.damageType || "") : "";
      const amount = /^[+-]/.test(parsed.amount) ? parsed.amount : `+${parsed.amount}`;
      const kind = parseDice(parsed.amount) ? "" : (row.bonusType || "circumstance");
      out.push(t(kind ? "UPGRADES.Describe.BonusPf2e" : "UPGRADES.Describe.BonusTyped",
        { label: preset.label, amount, type, kind }).replace(/\s{2,}/g, " ").trim());
      continue;
    }

    const parsed = splitDamageValue(raw);
    const amount = preset.damage ? parsed.amount : raw;
    const type = preset.damage ? (row.damageType ?? parsed.damageType ?? "").trim() : "";

    const rowMode = preset.mode ?? MODES.ADD;
    if (rowMode === MODES.UPGRADE) {
      // "Darkvision (raise to, in feet)" reads badly on a card, so these carry a short label.
      out.push(t("UPGRADES.Describe.RaisedTo", { label: preset.short ?? preset.label, amount }));
    } else if (rowMode === MODES.OVERRIDE) {
      // A threshold replaces the number rather than adding to it, so signing it would say the
      // opposite of what it does: "crit on a 19" is not "crit nineteen better than before".
      out.push(t("UPGRADES.Describe.SetTo", { label: preset.short ?? preset.label, amount }));
    } else {
      const signed = /^[+-]/.test(amount) ? amount : `+${amount}`;
      out.push(t("UPGRADES.Describe.BonusTyped", { label: preset.label, amount: signed, type })
        .replace(/\s{2,}/g, " ").trim());
    }
  }
  return out;
}

/**
 * What an upgrade will do, for the player-facing window.
 * Async because a linked payload has to be resolved to get its name.
 */
export async function describeUpgradeEffect(upgrade) {
  const mode = upgrade.effectMode ?? (upgrade.effectUuid ? EFFECT_MODE.LINK : EFFECT_MODE.NONE);
  if (mode === EFFECT_MODE.BUILD) return describeRows(upgrade.effectBuild?.rows ?? []);
  if (mode === EFFECT_MODE.LINK && upgrade.effectUuid) {
    const doc = await fromUuid(upgrade.effectUuid).catch(() => null);
    return doc ? [doc.name] : [];
  }
  return [];
}

/** One-line human summary of a built payload, for the GM console list. */
export function describeBuild(rows = []) {
  const parts = [];
  for (const row of rows) {
    const raw = String(row.value ?? "").trim();
    const preset = getPreset(row.preset);
    if (!raw && !preset?.toggle) continue;
    const label = row.preset === "custom" ? (row.key || "custom") : (preset?.label ?? row.preset);
    if (preset?.toggle) {
      parts.push(label);
      continue;
    }
    if (preset?.choices) {
      const choice = getRowChoices(preset).find(c => c.id === raw);
      if (!choice) continue;
      // Deliberately not lowercased the way the bonus summary below does it: German capitalises
      // its nouns, and this line is a whole sentence rather than a label being slotted into one.
      parts.push(t("UPGRADES.Describe.RollMode", { choice: choice.label, noun: preset.noun }));
      continue;
    }
    if (preset?.sense) {
      parts.push(t("UPGRADES.Describe.SenseRange", { label, amount: raw }));
      continue;
    }
    if (preset?.iwr) {
      const kind = preset.valueIsType ? raw : (row.damageType || "");
      const noun = String(preset.noun).toLowerCase();
      parts.push(preset.valueIsType
        ? t("UPGRADES.Describe.IwrPlain", { noun, type: kind })
        : t("UPGRADES.Describe.IwrAmount", { noun, amount: raw, type: kind }));
      continue;
    }
    const parsed = splitDamageValue(raw);
    const type = preset?.damage ? ((row.damageType ?? parsed.damageType ?? "").trim()) : "";
    parts.push(t("UPGRADES.Describe.Summary",
      { amount: `${parsed.amount || raw}${type ? `[${type}]` : ""}`, label: label.toLowerCase() }));
  }
  return parts.join(", ");
}
