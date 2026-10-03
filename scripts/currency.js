/**
 * Physical currency: a real Item that can be dropped in a chest, looted, and handed in.
 *
 * The pool is still the source of truth for what can be spent. This layer only moves value
 * between an actor's inventory and that pool, so a GM can hide payment in the world rather
 * than typing a number into a console.
 *
 * Matching is by name rather than by a flag on the placed item, deliberately: a GM will drag
 * the item around by hand, copy it between actors, or hand out one they made earlier, and all
 * of those should still count.
 */
import { adjustBalance } from "./economy.js";
import { MODULE_ID, SETTINGS, getVocabulary } from "./settings.js";
import { t } from "./i18n.js";

/** The configured Item that represents one unit, or null when the feature is unused. */
export async function getCurrencyItem() {
  const uuid = game.settings.get(MODULE_ID, SETTINGS.CURRENCY_ITEM);
  if (!uuid) return null;
  return fromUuid(uuid).catch(() => null);
}

/** Is this owned item a unit of currency? */
export function isCurrencyItem(item, currencyName) {
  if (!item || !currencyName) return false;
  return item.name?.trim().toLowerCase() === currencyName.trim().toLowerCase();
}

/** Every currency stack an actor is carrying. */
export function currencyItemsOn(actor, currencyName) {
  return actor?.items?.filter(i => isCurrencyItem(i, currencyName)) ?? [];
}

/**
 * How many units one stack is worth. An item with no quantity field is one unit; a stack whose
 * quantity reads zero, negative or garbage is worth nothing, not one.
 */
export function unitsIn(item) {
  const qty = Number(item?.system?.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
}

/** How many units an actor holds, counting stack quantities. */
export function countCurrencyOn(actor, currencyName) {
  return currencyItemsOn(actor, currencyName).reduce((sum, i) => sum + unitsIn(i), 0);
}

/**
 * Put `amount` units into an actor's inventory. GM-side.
 * Used to seed a chest, an NPC, or a body before the party finds it.
 */
export async function placeCurrency(actor, amount) {
  const source = await getCurrencyItem();
  if (!source) {
    ui.notifications.warn(t("UPGRADES.Notify.NoCurrencyItem"));
    return 0;
  }
  if (!actor || amount <= 0) return 0;

  const data = source.toObject();
  delete data._id;
  // Quantity lives in the same place in both supported systems.
  foundry.utils.setProperty(data, "system.quantity", amount);
  await actor.createEmbeddedDocuments("Item", [data]);
  return amount;
}

/**
 * Hand in everything an actor is carrying: remove the items, credit the pool. GM-side.
 * Returns how many units moved.
 */
export async function depositFrom(actor) {
  const source = await getCurrencyItem();
  if (!source || !actor) return 0;

  const held = currencyItemsOn(actor, source.name);
  if (!held.length) return 0;

  const amount = countCurrencyOn(actor, source.name);
  if (!amount) return 0;
  await actor.deleteEmbeddedDocuments("Item", held.map(i => i.id));
  await adjustBalance(amount, t("UPGRADES.Ledger.HandedInBy", { actor: actor.name }));
  return amount;
}

/**
 * Credit a single stack the moment it lands on a party member, for GMs who would rather
 * looting be the whole interaction. Off by default: an item vanishing out of the inventory
 * you just put it in is startling if you did not ask for it.
 *
 * Party membership, not player ownership: a loot chest the players own so they can open it
 * must hold what the GM places in it until someone actually takes it out.
 */
export async function autoDepositOnPickup(item) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_DEPOSIT)) return;
  const actor = item?.parent;
  if (!(actor instanceof Actor)) return;
  // Imported on use: the adapter pulls in the effects layer, which this module has no other need for.
  const { getPartyActors } = await import("./systems/adapter.js");
  if (!getPartyActors().some(a => a.id === actor.id)) return;

  const source = await getCurrencyItem();
  if (!source || !isCurrencyItem(item, source.name)) return;

  const amount = unitsIn(item);
  if (!amount) return;
  await item.delete();
  await adjustBalance(amount, t("UPGRADES.Ledger.CollectedBy", { actor: actor.name }));

  const vocab = getVocabulary();
  ChatMessage.create({
    content: `<div class="upgrades-chat-card"><p>${t("UPGRADES.Chat.Collected", {
      who: `<strong>${foundry.utils.escapeHTML(actor.name)}</strong>`,
      amount: `<strong>${amount}</strong>`,
      currency: foundry.utils.escapeHTML(vocab.currencyName)
    })}</p></div>`
  });
}
