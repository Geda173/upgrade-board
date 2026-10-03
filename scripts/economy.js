/**
 * The economy: what resources exist, what is in the pot, what things cost, and the ledger.
 *
 * Depends on the catalogue only to keep it honest — removing a resource has to strip it from the
 * upgrades priced in it. The catalogue does not depend on this, and must not start to.
 */
import { MODULE_ID, SETTINGS } from "./settings.js";
import { getUpgrades, setUpgrades } from "./catalog.js";
import { t } from "./i18n.js";

/**
 * The resources upgrades are bought with.
 *
 * A world that never defines any still gets one, synthesised from the single-currency settings,
 * so nothing needs configuring to keep working and the UI stays exactly as simple as before.
 */
export function getCurrencies() {
  const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.CURRENCIES)) ?? [];
  if (stored.length) {
    return stored
      .map(c => ({ item: "", sort: 0, ...c }))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }
  return [{
    id: DEFAULT_CURRENCY,
    name: game.settings.get(MODULE_ID, SETTINGS.CURRENCY_NAME) || "Points",
    icon: game.settings.get(MODULE_ID, SETTINGS.CURRENCY_ICON) || "fa-solid fa-gem",
    item: game.settings.get(MODULE_ID, SETTINGS.CURRENCY_ITEM) || "",
    sort: 0
  }];
}

export const DEFAULT_CURRENCY = "default";

/**
 * Strict on purpose: falling back to the first resource would make a cost naming a deleted one
 * display as — and appear to be payable in — a resource it was never priced in.
 */
export function getCurrency(id) {
  return getCurrencies().find(c => c.id === id) ?? null;
}

/** The resource used when nothing specifies one. */
export function primaryCurrency() {
  return getCurrencies()[0] ?? null;
}

/** True once the GM has gone beyond a single resource; the UI leans on this to stay quiet. */
export function hasMultipleCurrencies() {
  return getCurrencies().length > 1;
}

export async function setCurrencies(currencies) {
  return game.settings.set(MODULE_ID, SETTINGS.CURRENCIES, currencies);
}

export async function upsertCurrency(data) {
  // Writing the list for the first time must capture the synthesised one, or the existing
  // balance would be stranded against a currency that no longer appears.
  const currencies = getCurrencies();
  const idx = currencies.findIndex(c => c.id === data.id);
  if (idx >= 0) currencies[idx] = { ...currencies[idx], ...data };
  else currencies.push({
    id: data.id ?? foundry.utils.randomID(),
    name: t("UPGRADES.New.Resource"), icon: "fa-solid fa-circle", item: "", sort: currencies.length,
    ...data
  });
  return setCurrencies(currencies);
}

/** Removing a resource leaves any upgrade priced in it costing nothing in that resource. */
export async function deleteCurrency(id) {
  const remaining = getCurrencies().filter(c => c.id !== id);
  if (!remaining.length) return;                       // never leave a world with none
  // A bare legacy `cost` means "in the first resource", whichever that is. Pin it to the one it
  // means now, before the list changes, or deleting the first resource would silently re-price
  // every legacy upgrade in whatever resource moves up to take its place.
  const upgrades = getUpgrades();
  let touched = false;
  for (const u of upgrades) {
    if (!Array.isArray(u.costs)) { u.costs = getCosts(u); touched = true; }
  }
  await setCurrencies(remaining);
  // The discarded balance goes with it, or the setting accretes keys no currency can ever read.
  const balances = getBalances();
  if (id in balances) {
    delete balances[id];
    await game.settings.set(MODULE_ID, SETTINGS.BALANCES, balances);
  }
  for (const u of upgrades) {
    const kept = (u.costs ?? []).filter(c => c.currencyId !== id);
    if (kept.length !== (u.costs ?? []).length) { u.costs = kept; touched = true; }
  }
  if (touched) await setUpgrades(upgrades);
}

/* ---------- Vocabulary helpers ---------- */

/**
 * What an upgrade costs, as a list of {currencyId, amount}.
 * Upgrades priced before multiple resources existed carry a bare `cost` number.
 *
 * The bare number is read only when there is no `costs` list at all. An empty list is a price
 * the GM set — free — and falling back past it made a saved-as-free upgrade cost whatever the
 * creation default or its pre-multi-resource price had been, with the editor showing it again.
 */
export function getCosts(upgrade) {
  if (Array.isArray(upgrade?.costs)) return upgrade.costs.filter(c => c && c.amount > 0);
  const amount = Number(upgrade?.cost ?? 0);
  if (!amount) return [];
  return [{ currencyId: getCurrencies()[0]?.id ?? DEFAULT_CURRENCY, amount }];
}

/** Costs paired with their currency, ready to display. */
export function describeCosts(upgrade) {
  return getCosts(upgrade).map(c => ({ ...c, currency: getCurrency(c.currencyId) }))
    .filter(c => c.currency);
}

export function canAfford(upgrade) {
  const balances = getBalances();
  return getCosts(upgrade).every(c => (balances[c.currencyId] ?? 0) >= c.amount);
}

/**
 * Every balance, keyed by currency id.
 * Worlds from before multiple resources stored a single number; it becomes the first currency's.
 */
export function getBalances() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.BALANCES);
  const balances = (stored && typeof stored === "object") ? { ...stored } : {};
  if (!Object.keys(balances).length) {
    const legacy = game.settings.get(MODULE_ID, SETTINGS.BALANCE) ?? 0;
    balances[getCurrencies()[0]?.id ?? DEFAULT_CURRENCY] = legacy;
  }
  return balances;
}

export function getBalance(currencyId = null) {
  const id = currencyId ?? getCurrencies()[0]?.id ?? DEFAULT_CURRENCY;
  return getBalances()[id] ?? 0;
}

export async function adjustBalance(currencyId, delta, reason = "", { type = "adjust" } = {}) {
  // Called as adjustBalance(delta, reason) before multiple currencies existed.
  if (typeof currencyId === "number") {
    [currencyId, delta, reason] = [null, currencyId, delta ?? ""];
  }
  const id = currencyId ?? getCurrencies()[0]?.id ?? DEFAULT_CURRENCY;
  const balances = getBalances();
  const before = balances[id] ?? 0;
  const after = Math.max(0, before + delta);
  balances[id] = after;
  await game.settings.set(MODULE_ID, SETTINGS.BALANCES, balances);
  // `type` distinguishes a GM's manual adjustment from a movement that belongs to a purchase
  // ("spend"), so sweeping one kind out of the ledger leaves the other intact.
  await addHistory({ type, currencyId: id, delta, before, after, reason });
  return after;
}

/* ---------- History ---------- */

/**
 * The ledger is a *record of what happened*, not the source of truth for anything. Balances live
 * in their own setting and purchases in the catalogue, so editing or clearing a line here changes
 * only what is displayed. That is the whole reason it is safe to let the GM tidy it: a world's
 * worth of trial-and-error adjustments can be swept away without a single balance moving.
 */
export async function addHistory(entry) {
  const history = readHistory();
  history.push({ id: foundry.utils.randomID(), ts: Date.now(), user: game.user?.name ?? "GM", ...entry });
  return writeHistory(history);
}

function readHistory() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.HISTORY)) ?? [];
}

/**
 * Lines written before the ledger could be edited carry no id, so position stands in for one.
 * Any write stamps a real id on those, which is what keeps a positional id from ever being
 * confused with a stored one after the list shifts underneath it.
 */
function withIds(entries) {
  return entries.map((e, i) => (e.id ? e : { ...e, id: `pos-${i}` }));
}

async function writeHistory(entries) {
  return game.settings.set(MODULE_ID, SETTINGS.HISTORY, entries.map(e =>
    (!e.id || String(e.id).startsWith("pos-")) ? { ...e, id: foundry.utils.randomID() } : e));
}

export function getHistory() {
  return withIds(readHistory());
}

/** Drop one line. Balances and purchase records are deliberately left exactly as they are. */
export async function removeHistory(id) {
  const entries = getHistory();
  const idx = entries.findIndex(e => e.id === id);
  if (idx < 0) return null;
  const [removed] = entries.splice(idx, 1);
  await writeHistory(entries);
  return removed;
}

/**
 * Sweep the ledger. `kind` is "all", or an entry type ("adjust", "purchase") to keep the rest —
 * a GM tidying away a currency experiment wants the purchases that surround it left alone.
 * A purchase's deduction lines are typed "spend" and travel with their purchase: sweeping
 * adjustments leaves them, sweeping purchases takes them too.
 * Returns how many lines went, so the caller can say.
 */
export async function clearHistory(kind = "all") {
  const entries = getHistory();
  const swept = kind === "purchase" ? ["purchase", "spend"] : [kind];
  const kept = kind === "all" ? [] : entries.filter(e => !swept.includes(e.type));
  await writeHistory(kept);
  return entries.length - kept.length;
}

/**
 * Reword one line. Only the reason is editable: the amounts are what actually happened, and a
 * ledger that can be made to disagree with the balance it describes is worse than no ledger.
 */
export async function editHistoryReason(id, reason) {
  const entries = getHistory();
  const entry = entries.find(e => e.id === id);
  if (!entry) return null;
  entry.reason = reason;
  await writeHistory(entries);
  return entry;
}
