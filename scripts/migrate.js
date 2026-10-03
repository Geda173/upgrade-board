/**
 * Carrying a world across the rename from `upgrades` to `upgrade-board` (v0.22.0).
 *
 * Foundry keys world settings by module id, so changing the id hides every one of them: the
 * catalogue, the balances, the currencies and the whole history are still in the world database,
 * just filed under a name nothing reads any more. A world that had a working board would open
 * completely empty. That is what this file is for.
 *
 * It reads the old namespace through `game.settings.register`, which takes the namespace as an
 * ordinary string and does not require the module to own it. Reaching into the raw setting
 * documents would be shorter, but Foundry's API documentation does not describe their shape, and
 * guessing at internals is not a thing to do with somebody's campaign.
 *
 * Nothing is deleted. The old values stay exactly where they are, so installing the old module
 * again puts the world back as it was.
 */
import { MODULE_ID, LEGACY_MODULE_ID, SETTINGS } from "./settings.js";

/** Written once the copy has run, so a GM who clears the board does not get it refilled. */
export const MIGRATED = "migratedFromUpgrades";

/** Every world-scope key the old module stored, with the type it stored it as. */
const CARRIED = [
  [SETTINGS.UPGRADES, Array, []],
  [SETTINGS.CATEGORIES, Array, []],
  [SETTINGS.BALANCE, Number, 0],
  [SETTINGS.BALANCES, Object, {}],
  [SETTINGS.CURRENCIES, Array, []],
  [SETTINGS.HISTORY, Array, []],
  [SETTINGS.REQUIRE_APPROVAL, Boolean, true],
  [SETTINGS.PLAYERS_CAN_OPEN, Boolean, true],
  [SETTINGS.PARTY_ACTOR, String, ""],
  [SETTINGS.CURRENCY_ITEM, String, ""],
  [SETTINGS.AUTO_DEPOSIT, Boolean, false],
  [SETTINGS.THEME, String, "abyss"],
  [SETTINGS.WINDOW_TITLE, String, ""],
  [SETTINGS.CURRENCY_NAME, String, ""],
  [SETTINGS.CURRENCY_ICON, String, ""],
  [SETTINGS.ACTION_VERB, String, ""],
  [SETTINGS.HOST_ACTOR, String, ""],
  [SETTINGS.HOST_NAME, String, ""],
  [SETTINGS.HOST_IMG, String, ""],
  [SETTINGS.GREETING, String, ""]
];

/**
 * Make the old namespace readable. Called from `init`, alongside our own registration.
 *
 * If the old module happens to still be installed and enabled it will register these same keys
 * itself; registering them twice is harmless, because both descriptions agree on type and scope.
 */
export function registerLegacySettings() {
  for (const [key, type, fallback] of CARRIED) {
    try {
      game.settings.register(LEGACY_MODULE_ID, key, {
        scope: "world", config: false, type, default: fallback
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read the old "${key}" setting`, err);
    }
  }
  game.settings.register(MODULE_ID, MIGRATED, {
    scope: "world", config: false, type: Boolean, default: false
  });
}

const read = (namespace, key, fallback) => {
  try { return game.settings.get(namespace, key); } catch { return fallback; }
};

const filled = value =>
  Array.isArray(value) ? value.length > 0
    : (value && typeof value === "object") ? Object.keys(value).length > 0
    : false;

/** Is there a board under the old name worth carrying over? */
function legacyHasContent() {
  return [SETTINGS.UPGRADES, SETTINGS.CATEGORIES, SETTINGS.CURRENCIES, SETTINGS.HISTORY]
    .some(key => filled(read(LEGACY_MODULE_ID, key, [])))
    || filled(read(LEGACY_MODULE_ID, SETTINGS.BALANCES, {}));
}

/** Has this world already been used under the new name? Then it is not ours to overwrite. */
function alreadyInUse() {
  return [SETTINGS.UPGRADES, SETTINGS.CATEGORIES, SETTINGS.CURRENCIES, SETTINGS.HISTORY]
    .some(key => filled(read(MODULE_ID, key, [])))
    || filled(read(MODULE_ID, SETTINGS.BALANCES, {}));
}

/**
 * Copy the old world's board onto the new id. GM-side, once.
 *
 * Returns what happened so the caller can tell the GM, since a migration that runs silently is
 * indistinguishable from one that did not run at all.
 */
export async function migrateFromLegacy() {
  if (!game.user.isGM) return { ran: false, reason: "not-gm" };
  if (game.settings.get(MODULE_ID, MIGRATED)) return { ran: false, reason: "done" };
  if (!legacyHasContent()) return { ran: false, reason: "nothing-to-carry" };
  if (alreadyInUse()) {
    console.warn(`${MODULE_ID} | An older "${LEGACY_MODULE_ID}" world was found, but this world `
      + `already has its own board. Nothing was copied; the old data is untouched.`);
    return { ran: false, reason: "occupied" };
  }

  let copied = 0;
  for (const [key, , fallback] of CARRIED) {
    const value = read(LEGACY_MODULE_ID, key, fallback);
    if (value === undefined) continue;
    try {
      await game.settings.set(MODULE_ID, key, value);
      copied++;
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to carry "${key}" across`, err);
    }
  }

  await game.settings.set(MODULE_ID, MIGRATED, true);
  const upgrades = read(MODULE_ID, SETTINGS.UPGRADES, []);
  return { ran: true, copied, upgrades: Array.isArray(upgrades) ? upgrades.length : 0 };
}
