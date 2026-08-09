/**
 * Upgrades — entry point.
 */
import { MODULE_ID, LEGACY_MODULE_ID, SETTINGS, getVocabulary, isHostToken, registerSettings, warnIfNoPartyActor } from "./settings.js";
import { t } from "./i18n.js";
import { registerLegacySettings, migrateFromLegacy } from "./migrate.js";
import { initSockets } from "./sockets.js";
import { registerDamageHooks } from "./systems/dnd5e-damage.js";
import { ShopApp } from "./apps/shop-app.js";
import { EditorApp } from "./apps/editor-app.js";
import { SettingsApp } from "./apps/settings-app.js";

Hooks.once("init", () => {
  registerSettings();
  // Makes the pre-v0.22.0 namespace readable so a renamed world can be carried across.
  registerLegacySettings();

  // Every individual setting is config:false, so Foundry's list shows one button that opens
  // the setup window instead — where the choices have pickers and a live preview.
  //
  // Resolved here rather than handed to Foundry as keys: the API docs do not promise that
  // register/registerMenu localize these, and an unresolved key would show as
  // "UPGRADES.Menu.Name" in the module list. t() is safe either way — if Foundry does
  // localize them, it is being handed English, and localizing English is a no-op.
  game.settings.registerMenu(MODULE_ID, "setup", {
    name: t("UPGRADES.Menu.Name"),
    label: t("UPGRADES.Menu.Label"),
    hint: t("UPGRADES.Menu.Hint"),
    icon: "fa-solid fa-sliders",
    type: SettingsApp,
    restricted: true
  });
});

Hooks.once("ready", () => {
  initSockets();
  carryOldWorldAcross();
  warnIfNoPartyActor();
  // dnd5e only, and it says so itself: the one bonus the system has no field for.
  registerDamageHooks();

  // Public API: macros can call game.modules.get("upgrade-board").api.openShop()
  const mod = game.modules.get(MODULE_ID);
  mod.api = {
    openShop: () => ShopApp.show(),
    openEditor: () => EditorApp.show(),
    openSettings: () => SettingsApp.show()
  };

  // Only the active GM reacts, or several clients would credit the same pickup.
  Hooks.on("createItem", async item => {
    const { isActiveGM } = await import("./sockets.js");
    if (!isActiveGM()) return;
    const { autoDepositOnPickup } = await import("./currency.js");
    await autoDepositOnPickup(item);
  });

  bindMerchantToken();

  console.log(`${MODULE_ID} | Ready. Open via the token controls button or game.modules.get("${MODULE_ID}").api.openShop()`);
});

/**
 * A world set up before the module was renamed keeps its board.
 *
 * Told out loud rather than done quietly: the GM has just installed what looks like a different
 * module, and needs to know their catalogue came with it — and that the old one should now be
 * disabled, since two copies would both draw a scene-control button and both bind the merchant.
 */
async function carryOldWorldAcross() {
  const result = await migrateFromLegacy().catch(err => {
    console.error(`${MODULE_ID} | Could not carry the old world across`, err);
    return { ran: false };
  });
  if (!result?.ran) return;
  ui.notifications.info(game.i18n.format("UPGRADES.Notify.Migrated", { count: result.upgrades }), { permanent: true });
  console.log(`${MODULE_ID} | Carried ${result.copied} setting(s) over from "${LEGACY_MODULE_ID}".`);
}

/**
 * Double-clicking the merchant's token opens the window.
 *
 * Foundry has no hook for this, so the placeable's handler is wrapped. Everything that is not
 * the merchant falls straight through to the original, and the wrap is skipped entirely when no
 * merchant is bound — a token that is not the merchant must behave exactly as it always did.
 *
 * This deliberately ignores "players can open the window freely": binding a merchant and then
 * turning that setting off is how a GM makes the window reachable only by visiting them.
 */
function bindMerchantToken() {
  const TokenClass = foundry.canvas?.placeables?.Token ?? globalThis.Token;
  const proto = TokenClass?.prototype;
  if (!proto?._onClickLeft2 || proto._upgradesMerchantBound) return;

  const original = proto._onClickLeft2;
  proto._onClickLeft2 = function (event) {
    try {
      if (isHostToken(this)) {
        ShopApp.show();
        return;
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Merchant token check failed`, err);
    }
    return original.call(this, event);
  };
  proto._upgradesMerchantBound = true;
}

/**
 * Scene controls button (token controls group).
 * v13 uses record-shaped controls/tools; keep a defensive fallback for array shape.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const canOpen = game.user.isGM || game.settings.get(MODULE_ID, SETTINGS.PLAYERS_CAN_OPEN);
  if (!canOpen) return;

  const vocab = getVocabulary();
  const tool = {
    name: "upgrade-board",
    title: `Open ${vocab.windowTitle}`,
    // Reuse the currency icon when it's a Font Awesome class; an image path can't go here.
    icon: vocab.currencyIconIsImg ? "fa-solid fa-gem" : (vocab.currencyIcon || "fa-solid fa-gem"),
    button: true,
    // Stated rather than left to a default. A live v14.365 client showed this tool present in
    // `ui.controls.controls.tokens.tools` and still absent from the toolbar, and every other tool
    // sitting beside it — core's and other modules' alike — declares its own visibility.
    visible: true,
    // onChange only — supplying the old onClick alongside it makes v13+ log a deprecation warning.
    onChange: () => ShopApp.show()
  };

  const tokens = Array.isArray(controls)
    ? controls.find(c => c.name === "token" || c.name === "tokens")
    : (controls.tokens ?? controls.token);
  if (!tokens) return;

  if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
  else tokens.tools[tool.name] = { ...tool, order: Object.keys(tokens.tools).length };
});
