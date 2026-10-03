/**
 * Socket layer (native game.socket — no external dependency).
 * All world mutations run on the active GM's client; players only send requests.
 */
import { MODULE_ID } from "./settings.js";
import { t } from "./i18n.js";

const CHANNEL = `module.${MODULE_ID}`;

export function initSockets() {
  game.socket.on(CHANNEL, async (msg) => {
    switch (msg?.type) {
      case "requestPurchase": {
        // Only one GM client should handle the request. Imported here rather than at the top
        // because purchase.js emits through this module — a static pair would be a cycle.
        if (!isActiveGM()) break;
        // A GM buys on their own client and never sends this. One arriving in a GM's name was
        // composed by hand to skip approval, so it is dropped. Foundry gives module sockets no
        // sender id, so a player's own id cannot be checked the same way — that is the limit.
        if (game.users.get(msg.userId)?.isGM) break;
        const { handlePurchaseRequest } = await import("./purchase.js");
        await handlePurchaseRequest(msg);
        break;
      }
      case "deposit":
        if (isActiveGM()) {
          const { depositFrom } = await import("./currency.js");
          // Only from an actor the requesting user owns. The id is the client's word, as above,
          // but this stops a player handing in a chest they can see and have not looted.
          // A GM owns every actor, so a request in a GM's name would pass for any chest in the
          // world. A GM hands in on their own client and never sends this; drop it, as above.
          const actor = game.actors.get(msg.actorId);
          const user = game.users.get(msg.userId);
          if (!actor || !user || user.isGM || !actor.testUserPermission(user, "OWNER")) break;
          const amount = await depositFrom(actor);
          emit({ type: "notify", userId: msg.userId,
                 message: amount ? t("UPGRADES.Notify.HandedIn", { amount }) : t("UPGRADES.Notify.NothingToHandIn") });
          refreshOpenApps();
          emit({ type: "refresh" });
        }
        break;
      case "openShop":
        if (!game.user.isGM) openShopForClient();
        break;
      case "refresh":
        refreshOpenApps();
        break;
      case "notify":
        if (msg.userId === game.user.id) ui.notifications.info(msg.message);
        break;
    }
  });
}

export function emit(msg) {
  game.socket.emit(CHANNEL, msg);
}

/** True if this client is the active GM with the lowest user id (dedupe when several GMs are logged in). */
export function isActiveGM() {
  if (!game.user.isGM) return false;
  // Plain code-point order, not localeCompare: every GM client must sort the same way, and
  // locale-aware collation is exactly the thing that can differ between them.
  const activeGMs = game.users.filter(u => u.isGM && u.active)
    .sort((a, b) => (a.id > b.id) - (a.id < b.id));
  return activeGMs[0]?.id === game.user.id;
}

export function anyGMOnline() {
  return game.users.some(u => u.isGM && u.active);
}

async function openShopForClient() {
  const { ShopApp } = await import("./apps/shop-app.js");
  ShopApp.show();
}

export async function refreshOpenApps() {
  const { ShopApp } = await import("./apps/shop-app.js");
  const { EditorApp } = await import("./apps/editor-app.js");
  ShopApp.instance?.render();
  EditorApp.instance?.render();
  // The scene-control button's label, icon and very existence come from settings too.
  ui.controls?.render();
}
