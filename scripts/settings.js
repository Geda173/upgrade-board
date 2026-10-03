/**
 * Configuration: the settings themselves, the vocabulary the players read, the theme, and the
 * merchant actor the board is reached through.
 *
 * Everything here answers "how is this world set up". Nothing here knows what an upgrade is.
 */

/**
 * Data layer: upgrade catalog, currency balance, purchase history.
 * Everything lives in world-scoped settings (GM-writable only).
 */
import { t, localizeFields } from "./i18n.js";

export const MODULE_ID = "upgrade-board";

/** What the module was called before v0.22.0. Only migrate.js has any business with it. */
export const LEGACY_MODULE_ID = "upgrades";

export const SETTINGS = {
  UPGRADES: "upgrades",
  CATEGORIES: "categories",
  BALANCE: "balance",
  BALANCES: "balances",
  CURRENCIES: "currencies",
  HISTORY: "history",
  REQUIRE_APPROVAL: "requireApproval",
  PLAYERS_CAN_OPEN: "playersCanOpen",
  PARTY_ACTOR: "partyActor",
  CURRENCY_ITEM: "currencyItem",
  AUTO_DEPOSIT: "autoDeposit",
  THEME: "theme",
  CURRENCY_NAME: "currencyName",
  CURRENCY_ICON: "currencyIcon",
  WINDOW_TITLE: "windowTitle",
  ACTION_VERB: "actionVerb",
  HOST_ACTOR: "hostActor",
  HOST_NAME: "hostName",
  HOST_IMG: "hostImg",
  GREETING: "greeting"
};

/**
 * Visual themes. Each id maps to a `.upg-theme-<id>` block in styles/shop.css that
 * redefines the palette custom properties — no structural CSS is theme-specific.
 */
const RAW_THEMES = [
  // Fantasy
  { id: "abyss", group: "Fantasy" },
  { id: "grove", group: "Fantasy" },
  { id: "ember", group: "Fantasy" },
  { id: "arcane", group: "Fantasy" },
  { id: "frost", group: "Fantasy" },
  { id: "ossuary", group: "Fantasy" },
  { id: "bloodmoon", group: "Fantasy" },
  { id: "goldenhall", group: "Fantasy" },
  { id: "mycelium", group: "Fantasy" },
  { id: "tempest", group: "Fantasy" },
  { id: "parchment", group: "Fantasy" },

  // Sci-fi
  { id: "holo", group: "SciFi" },
  { id: "neon", group: "SciFi" },
  { id: "starship", group: "SciFi" },
  { id: "rust", group: "SciFi" },
  { id: "phosphor", group: "SciFi" }
];

/** Names and one-line blurbs come from the translation on read; ids are the CSS contract. */
export const THEMES = localizeFields(RAW_THEMES, {
  group: x => `UPGRADES.ThemeGroup.${x.group}`,
  label: x => `UPGRADES.Theme.${x.id}`,
  blurb: x => `UPGRADES.Theme.${x.id}Blurb`
});

export function getTheme() {
  const id = game.settings.get(MODULE_ID, SETTINGS.THEME);
  return THEMES.some(t => t.id === id) ? id : "abyss";
}

/**
 * Re-render open windows so a settings change is visible immediately.
 * Attached to every setting that affects what is on screen — otherwise a GM renames the
 * currency, sees the old name still sitting there, and reasonably concludes it didn't work.
 */
async function refreshWindows() {
  // Imported dynamically on purpose: the socket layer reaches back into the windows, which read
  // settings. A static import here would close that loop at module-load time.
  const { emit, refreshOpenApps } = await import("./sockets.js");
  refreshOpenApps();
  emit({ type: "refresh" });   // players have the window open too
}

export function registerSettings() {
  const S = game.settings;

  // Hidden data stores
  S.register(MODULE_ID, SETTINGS.UPGRADES, { scope: "world", config: false, type: Array, default: [] });
  S.register(MODULE_ID, SETTINGS.CATEGORIES, { scope: "world", config: false, type: Array, default: [] });
  S.register(MODULE_ID, SETTINGS.BALANCE, { scope: "world", config: false, type: Number, default: 0 });
  S.register(MODULE_ID, SETTINGS.BALANCES, { scope: "world", config: false, type: Object, default: {} });
  S.register(MODULE_ID, SETTINGS.CURRENCIES, { scope: "world", config: false, type: Array, default: [] });
  S.register(MODULE_ID, SETTINGS.HISTORY, { scope: "world", config: false, type: Array, default: [] });

  // Behaviour
  S.register(MODULE_ID, SETTINGS.REQUIRE_APPROVAL, {
    name: t("UPGRADES.Setting.RequireApproval"),
    hint: t("UPGRADES.SettingHint.RequireApproval"),
    scope: "world", config: false, type: Boolean, default: true,
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.PLAYERS_CAN_OPEN, {
    name: t("UPGRADES.Setting.PlayersCanOpen"),
    hint: t("UPGRADES.SettingHint.PlayersCanOpen"),
    scope: "world", config: false, type: Boolean, default: true,
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.PARTY_ACTOR, {
    name: t("UPGRADES.Setting.PartyActor"),
    hint: t("UPGRADES.SettingHint.PartyActor"),
    // No choices here: the dropdown lives in the setup window, which builds its own.
    scope: "world", config: false, type: String, default: "",
    onChange: () => refreshWindows()
  });

  S.register(MODULE_ID, SETTINGS.CURRENCY_ITEM, {
    name: t("UPGRADES.Setting.CurrencyItem"),
    hint: t("UPGRADES.SettingHint.CurrencyItem"),
    scope: "world", config: false, type: String, default: "",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.AUTO_DEPOSIT, {
    name: t("UPGRADES.Setting.AutoDeposit"),
    scope: "world", config: false, type: Boolean, default: false,
    onChange: () => refreshWindows()
  });

  // Presentation
  S.register(MODULE_ID, SETTINGS.THEME, {
    name: t("UPGRADES.Setting.Theme"),
    hint: t("UPGRADES.SettingHint.Theme"),
    scope: "world", config: false, type: String, default: "abyss",
    // Foundry's choices dropdown is flat, so the group rides along in the label.
    choices: Object.fromEntries(THEMES.map(t => [t.id, `${t.group} · ${t.label}: ${t.blurb}`])),
    onChange: () => refreshWindows()
  });

  // Vocabulary — everything the players read
  S.register(MODULE_ID, SETTINGS.WINDOW_TITLE, {
    name: t("UPGRADES.Setting.WindowTitle"),
    hint: t("UPGRADES.SettingHint.WindowTitle"),
    scope: "world", config: false, type: String, default: "Upgrades",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.CURRENCY_NAME, {
    name: t("UPGRADES.Setting.CurrencyName"),
    hint: t("UPGRADES.SettingHint.CurrencyName"),
    scope: "world", config: false, type: String, default: "Points",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.CURRENCY_ICON, {
    name: t("UPGRADES.Setting.CurrencyIcon"),
    hint: t("UPGRADES.SettingHint.CurrencyIcon"),
    scope: "world", config: false, type: String, default: "fa-solid fa-gem",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.ACTION_VERB, {
    name: t("UPGRADES.Setting.ActionVerb"),
    hint: t("UPGRADES.SettingHint.ActionVerb"),
    scope: "world", config: false, type: String, default: "Request",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.HOST_ACTOR, {
    name: t("UPGRADES.Setting.HostActor"),
    hint: t("UPGRADES.SettingHint.HostActor"),
    scope: "world", config: false, type: String, default: "",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.HOST_NAME, {
    name: t("UPGRADES.Setting.HostName"),
    hint: t("UPGRADES.SettingHint.HostName"),
    scope: "world", config: false, type: String, default: "",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.HOST_IMG, {
    name: t("UPGRADES.Setting.HostImg"),
    hint: t("UPGRADES.SettingHint.HostImg"),
    scope: "world", config: false, type: String, default: "", filePicker: "image",
    onChange: () => refreshWindows()
  });
  S.register(MODULE_ID, SETTINGS.GREETING, {
    name: t("UPGRADES.Setting.Greeting"),
    scope: "world", config: false, type: String,
    default: "Well met. Shall we see what can be made of this?",
    onChange: () => refreshWindows()
  });
}

/**
 * Warn the GM when the world has no Group actor to point the Party actor setting at.
 * The dropdown itself now lives in the setup window, which builds its own choices.
 */
export function warnIfNoPartyActor() {
  if (!game.user.isGM) return;
  const groups = game.actors.filter(a => a.type === "group" || a.type === "party").length;
  if (groups) return;
  console.warn(`${MODULE_ID} | No Group or Party actor found — party-wide upgrades will fall back `
    + `to every player-owned character. Create a Group actor and pick it in the setup window.`);
}

/* ---------- Currencies ---------- */

/** Everything the UI needs in order to call things by the GM's chosen names. */
/**
 * Icons are stored as either a Font Awesome class or a path to artwork, and every surface that
 * renders one has to tell them apart. Four copies of this had drifted: two accepted a bare
 * "pearl.png", two demanded a slash, so the same value rendered as an image in one window and as
 * a broken icon class in another.
 */
export function isImagePath(value) {
  const v = value ?? "";
  return /[/\\]/.test(v) || /\.(webp|png|jpe?g|gif|svg)$/i.test(v);
}

export function getVocabulary() {
  const icon = game.settings.get(MODULE_ID, SETTINGS.CURRENCY_ICON) ?? "";
  // A bound merchant actor supplies its own name and portrait, so the same thing is not
  // configured twice; either field still wins if the GM has filled it in.
  const hostActor = getHostActor();
  const hostImg = game.settings.get(MODULE_ID, SETTINGS.HOST_IMG) || hostActor?.img || "";
  return {
    windowTitle: game.settings.get(MODULE_ID, SETTINGS.WINDOW_TITLE) || t("UPGRADES.Default.WindowTitle"),
    currencyName: game.settings.get(MODULE_ID, SETTINGS.CURRENCY_NAME) || t("UPGRADES.Default.CurrencyName"),
    currencyIcon: icon,
    // Treat the icon as an image if it looks like a path; otherwise it's Font Awesome classes.
    currencyIconIsImg: isImagePath(icon),
    actionVerb: game.settings.get(MODULE_ID, SETTINGS.ACTION_VERB) || t("UPGRADES.Default.ActionVerb"),
    hostName: game.settings.get(MODULE_ID, SETTINGS.HOST_NAME) || hostActor?.name || t("UPGRADES.Default.HostName"),
    hostImg: hostImg,
    // The portrait may be artwork or a Font Awesome class; the template branches on this.
    hostIsImage: !!hostImg && isImagePath(hostImg),
    hostIconClass: (hostImg && !isImagePath(hostImg)) ? hostImg : (icon || "fa-solid fa-gem"),
    greeting: game.settings.get(MODULE_ID, SETTINGS.GREETING) || ""
  };
}

/* ---------- Upgrade catalog ---------- */

/** The actor standing in for the merchant, if one is bound. */
export function getHostActor() {
  const id = game.settings.get(MODULE_ID, SETTINGS.HOST_ACTOR);
  return id ? (game.actors?.get(id) ?? null) : null;
}

/**
 * Can the players actually interact with the merchant's token?
 *
 * Foundry only dispatches a double-click to a token the user is permitted to view, so a merchant
 * that players have no ownership of simply never responds to them — silently, and only for them.
 * LIMITED is the lowest level that lets the click through.
 */
export function merchantAccessLevel() {
  const actor = getHostActor();
  if (!actor) return null;
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const players = game.users.filter(u => !u.isGM);
  if (!players.length) return LEVELS.LIMITED;   // nothing to block
  return Math.min(...players.map(u => actor.testUserPermission(u, "LIMITED") ? LEVELS.LIMITED : LEVELS.NONE));
}

export function merchantNeedsAccess() {
  const actor = getHostActor();
  if (!actor) return false;
  return merchantAccessLevel() < CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
}

/** Give every player the minimum ownership that lets a token respond to them. */
export async function grantMerchantAccess() {
  const actor = getHostActor();
  if (!actor) return false;
  await actor.update({
    "ownership.default": Math.max(
      actor.ownership?.default ?? 0,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED
    )
  });
  return true;
}

/** Is this token the merchant? */
export function isHostToken(token) {
  const id = game.settings.get(MODULE_ID, SETTINGS.HOST_ACTOR);
  return !!id && token?.actor?.id === id;
}

/* ---------- Upgrade paths ---------- */
