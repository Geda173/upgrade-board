/**
 * The one place this module reaches into a roll.
 *
 * Everything else here writes data the system already understands and then gets out of the way.
 * This does not, and the reason is a hole in dnd5e rather than a preference: there is no actor
 * field anywhere in the system that adds damage to a spell resolved by a saving throw.
 *
 * `system.bonuses.{msak,rsak}.damage` is looked up as `system.bonuses.${actionType}.damage` when
 * an activity builds its first damage part, and `getActionType()` only answers `msak`/`rsak` for
 * an Attack activity. A Save activity answers `save`, and `system.bonuses.save.damage` is not in
 * the schema — `bonuses` carries mwak, rwak, msak, rsak, abilities and spell.dc, and nothing more.
 * So a Fireball or a Chain Lightning can never see one of those bonuses, and no amount of writing
 * cleverer data can change that. Verified against release-5.3.3.
 *
 * dnd5e's own answer is an Enchantment writing `system.damageBonus` onto one spell item at a
 * time, which is per spell and has to be reapplied to everything the character ever learns. For
 * an upgrade that says "your spells burn colder", that is the wrong shape.
 *
 * So: a preset writes a formula to `flags.<module>.spellDamage`, and this appends it to the first
 * damage part of any spell the actor rolls. `dnd5e.preRollDamage` is a documented extension point
 * (`basic-roll.mjs` fires `dnd5e.preRoll${hookName}` and its V2 twin for every roll), and the
 * append is deliberately the same move the system makes for its own bonuses in
 * `base-activity.mjs#_processDamagePart` — same array, same signed-formula shape, so the inline
 * `[cold]` flavour is typed by exactly the code that already types weapon bonuses.
 *
 * PF2e needs none of this. `spell-damage` is a real domain there, so its preset is an ordinary
 * DamageDice rule element and the system applies it.
 */
import { MODULE_ID } from "../settings.js";

/** Where the preset writes the accumulated formula. */
export const SPELL_DAMAGE_FLAG = "spellDamage";

/**
 * The formula an actor has bought, or null.
 * Read off `flags` directly rather than through `getFlag`, which throws for a scope that is not
 * an active package — the same trap that once stopped migrated worlds buying anything at all.
 */
export function spellDamageBonus(actor) {
  const raw = actor?.flags?.[MODULE_ID]?.[SPELL_DAMAGE_FLAG];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && !/^\+?0+$/.test(trimmed) ? trimmed : null;
}

/**
 * Append the bought formula to a pending damage roll, if the roll is a spell's.
 * Exported separately from the hook so it can be exercised without a Foundry.
 * @returns {boolean} whether anything was added, which is what the tests assert on.
 */
export function applySpellDamageBonus(config) {
  const activity = config?.subject;
  // Only spells, and only ever the actor's own roll.
  if (activity?.item?.type !== "spell") return false;

  const bonus = spellDamageBonus(activity.actor);
  if (!bonus) return false;

  // Part zero is where dnd5e puts its own damage bonuses, so a spell that already rolls
  // 10d8 lightning ends up rolling "10d8 + +1d6[cold]" exactly as a weapon would.
  const first = config.rolls?.[0];
  if (!first) return false;
  if (first[`${MODULE_ID}-applied`]) return false;

  first.parts = [...(first.parts ?? []), bonus];
  first[`${MODULE_ID}-applied`] = true;
  return true;
}

/** Wire it up. A no-op on any system but dnd5e. */
export function registerDamageHooks() {
  if (game.system?.id !== "dnd5e") return;
  Hooks.on("dnd5e.preRollDamageV2", applySpellDamageBonus);
}
