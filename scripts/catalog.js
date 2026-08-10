/**
 * The catalogue: upgrades, the sections they sit in, the paths between them, and the record of
 * what has been bought.
 *
 * Deliberately knows nothing about prices or balances — an upgrade's cost is the economy's
 * business. Adding an import of economy.js here would create a cycle; if that seems necessary,
 * the logic probably belongs on the other side of the boundary.
 */
import { MODULE_ID, SETTINGS } from "./settings.js";
import { t } from "./i18n.js";

/** Upgrade target modes. */
export const TARGET = {
  PARTY: "party",
  ACTOR: "actor",
  /** Whoever buys it — resolved at purchase time, so the GM need not know in advance. */
  BUYER: "buyer",
  /** An item carried by a character — the effect travels with the item when it changes hands. */
  ITEM: "item"
};

/**
 * Upgrade shape:
 * { id, name, cost, img, flavor, description (HTML), hidden, purchased,
 *   purchasedBy, purchasedAt, target, targetActorId, targetItemUuid, sort,
 *   effectMode, effectUuid, effectBuild: { rows: [{preset, value, damageType?, key?, mode?}] },
 *   hideEffect, categoryId, repeatable, showInEffectsBar, requires: [upgradeId],
 *   excludes: [upgradeId],
 *   choice: { enabled, label, hint },
 *   purchases: [{ id, actorId, actorName, by, at }] }
 *
 * `purchases` is the record of every acquisition. `purchased` is derived from it and kept
 * because the templates and availability checks read it.
 *
 * target: "party" → effect applies to every member of the party actor
 *         "actor" → effect applies only to targetActorId
 *         "item"  → effect lands on the item at targetItemUuid (must be carried by an actor)
 */
export function getUpgrades() {
  const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.UPGRADES)) ?? [];
  return linkFormerGroups(stored.map(normalizeUpgrade));
}

/**
 * v0.16.0 briefly modelled mutual exclusion as a named group in a registry of its own. Upgrades
 * authored then carry `exclusiveGroupId`; shared membership is turned into the direct links the
 * catalogue now uses, so nothing configured in that version is lost.
 */
function linkFormerGroups(upgrades) {
  const grouped = upgrades.filter(u => u.exclusiveGroupId);
  for (const u of grouped) {
    const rivals = grouped
      .filter(o => o.id !== u.id && o.exclusiveGroupId === u.exclusiveGroupId)
      .map(o => o.id);
    u.excludes = [...new Set([...u.excludes, ...rivals])];
  }
  return upgrades;
}

/** Fill in fields added after an upgrade was first authored. */
function normalizeUpgrade(upgrade) {
  const normalized = {
    target: TARGET.PARTY,
    targetActorId: null,
    targetItemUuid: null,
    effectBuild: { rows: [] },
    hideEffect: false,
    categoryId: null,
    repeatable: false,
    showInEffectsBar: false,
    requires: [],
    excludes: [],
    choice: { enabled: false, label: "", hint: "" },
    ...upgrade
  };

  // Upgrades authored before repeat-buying existed recorded a single boolean.
  if (!Array.isArray(normalized.purchases)) {
    normalized.purchases = upgrade.purchased
      ? [{
          id: "legacy", actorId: upgrade.targetActorId ?? null, actorName: null,
          by: upgrade.purchasedBy ?? "GM", at: upgrade.purchasedAt ?? null
        }]
      : [];
  }
  normalized.purchased = normalized.purchases.length > 0;
  normalized.purchaseCount = normalized.purchases.length;
  // Upgrades authored before effect modes existed only ever had a UUID.
  normalized.effectMode ??= upgrade.effectUuid ? "link" : "none";
  normalized.effectBuild.rows ??= [];
  return normalized;
}

export async function setUpgrades(upgrades) {
  return game.settings.set(MODULE_ID, SETTINGS.UPGRADES, upgrades);
}

export function getUpgrade(id) {
  return getUpgrades().find(u => u.id === id) ?? null;
}

export async function upsertUpgrade(data) {
  const upgrades = getUpgrades();
  const idx = upgrades.findIndex(u => u.id === data.id);
  if (idx >= 0) upgrades[idx] = foundry.utils.mergeObject(upgrades[idx], data);
  else upgrades.push({
    id: data.id ?? foundry.utils.randomID(),
    name: t("UPGRADES.New.Upgrade"), cost: 1, img: "", flavor: "", description: "",
    hidden: false, purchased: false, purchasedBy: null, purchasedAt: null,
    effectMode: "none", effectUuid: null, effectBuild: { rows: [] }, hideEffect: false,
    categoryId: null, repeatable: false, purchases: [], showInEffectsBar: false, requires: [],
    excludes: [],
    choice: { enabled: false, label: "", hint: "" },
    target: TARGET.PARTY, targetActorId: null, targetItemUuid: null, sort: upgrades.length,
    ...data
  });
  return setUpgrades(upgrades);
}

export async function deleteUpgrade(id) {
  const remaining = getUpgrades().filter(u => u.id !== id);
  // Every reader tolerates a dangling id, but there is no reason to keep one: strip the deleted
  // upgrade out of the relations that named it.
  for (const u of remaining) {
    u.requires = (u.requires ?? []).filter(r => r !== id);
    u.excludes = (u.excludes ?? []).filter(r => r !== id);
  }
  return setUpgrades(remaining);
}

/** Every prerequisite of this upgrade that has not been bought yet. */
export function unmetRequirements(upgrade, all = getUpgrades()) {
  const byId = new Map(all.map(u => [u.id, u]));
  return (upgrade.requires ?? [])
    .map(id => byId.get(id))
    .filter(req => req && !req.purchases?.length);
}

export function isUnlocked(upgrade, all = getUpgrades()) {
  return unmetRequirements(upgrade, all).length === 0;
}

/**
 * Does `upgrade` depend on `targetId`, directly or through a chain?
 * Used to keep the prerequisite picker from offering an option that would close a loop —
 * a cycle would leave every upgrade in it permanently unbuyable.
 */
export function dependsOn(upgrade, targetId, all = getUpgrades(), seen = new Set()) {
  if (!upgrade || seen.has(upgrade.id)) return false;
  seen.add(upgrade.id);
  const byId = new Map(all.map(u => [u.id, u]));
  for (const id of upgrade.requires ?? []) {
    if (id === targetId) return true;
    if (dependsOn(byId.get(id), targetId, all, seen)) return true;
  }
  return false;
}

/** Which upgrades may safely be offered as prerequisites of this one. */
export function eligiblePrerequisites(upgrade, all = getUpgrades()) {
  // A prerequisite this upgrade is mutually exclusive with can never be met: buying it is exactly
  // what rules this one out, so the pair would sit locked forever.
  const rivals = new Set(exclusiveSiblings(upgrade, all).map(u => u.id));
  return all.filter(u =>
    u.id !== upgrade?.id && !dependsOn(u, upgrade?.id, all) && !rivals.has(u.id));
}

/** How deep into a path an upgrade sits; roots are 0. Cycles are clamped rather than hung on. */
export function pathDepth(upgrade, all = getUpgrades(), seen = new Set()) {
  if (!upgrade || seen.has(upgrade.id)) return 0;
  seen.add(upgrade.id);
  const byId = new Map(all.map(u => [u.id, u]));
  const depths = (upgrade.requires ?? [])
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(req => 1 + pathDepth(req, all, new Set(seen)));
  return depths.length ? Math.max(...depths) : 0;
}

/** Order so that a prerequisite always appears before the upgrades that need it. */
export function sortByPath(upgrades, all = getUpgrades()) {
  return [...upgrades].sort((a, b) =>
    (pathDepth(a, all) - pathDepth(b, all)) || ((a.sort ?? 0) - (b.sort ?? 0)));
}

/** Can this still be bought? Repeatable upgrades never run out. */
export function isAvailable(upgrade) {
  return !!upgrade.repeatable || !upgrade.purchases?.length;
}

/** Record an acquisition. Returns the new purchase record. */
export async function addPurchase(upgradeId, { actorId = null, actorName = null, by = "GM", choice = null } = {}) {
  const upgrades = getUpgrades();
  const upgrade = upgrades.find(u => u.id === upgradeId);
  if (!upgrade) return null;
  const record = { id: foundry.utils.randomID(), actorId, actorName, by, at: Date.now(), choice };
  upgrade.purchases = [...(upgrade.purchases ?? []), record];
  upgrade.purchased = true;
  upgrade.purchasedBy = by;
  upgrade.purchasedAt = record.at;
  await setUpgrades(upgrades);
  return record;
}

/** Undo one acquisition (the most recent unless a specific one is named). */
export async function removePurchase(upgradeId, purchaseId = null) {
  const upgrades = getUpgrades();
  const upgrade = upgrades.find(u => u.id === upgradeId);
  if (!upgrade?.purchases?.length) return null;
  const idx = purchaseId
    ? upgrade.purchases.findIndex(p => p.id === purchaseId)
    : upgrade.purchases.length - 1;
  if (idx < 0) return null;
  const [removed] = upgrade.purchases.splice(idx, 1);
  upgrade.purchased = upgrade.purchases.length > 0;
  if (!upgrade.purchased) { upgrade.purchasedBy = null; upgrade.purchasedAt = null; }
  await setUpgrades(upgrades);
  return removed;
}

/* ---------- Mutually exclusive upgrades ---------- */

/**
 * An upgrade names the others it cannot be taken alongside, on the upgrade itself — there is no
 * registry of named sets to keep in step with the catalogue.
 *
 * The relation is stored on one side but read as **symmetric**: ticking B on A says the same
 * thing as ticking A on B, so the GM only ever authors it once. It is also closed
 * **transitively**, so A–B plus B–C makes one set of three the party picks from once; a whole
 * "choose one of five" can be authored from a single upgrade rather than as ten pairs.
 *
 * Which one was taken is *derived* from the purchase records of the set, never written down.
 * Refunding it therefore reopens the rest with nothing having to remember that it should — the
 * same reason `purchased` is derived from `purchases`.
 */
export function exclusiveSet(upgrade, all = getUpgrades()) {
  if (!upgrade) return [];
  const byId = new Map(all.map(u => [u.id, u]));
  const seen = new Set([upgrade.id]);
  const queue = [upgrade];
  while (queue.length) {
    const current = queue.shift();
    // Both directions: what this one names, and what names it.
    const linked = [
      ...(current.excludes ?? []),
      ...all.filter(u => (u.excludes ?? []).includes(current.id)).map(u => u.id)
    ];
    for (const id of linked) {
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      queue.push(byId.get(id));
    }
  }
  return [...seen].map(id => byId.get(id)).filter(Boolean);
}

/** The other upgrades competing for the same slot. */
export function exclusiveSiblings(upgrade, all = getUpgrades()) {
  return exclusiveSet(upgrade, all).filter(u => u.id !== upgrade?.id);
}

/** Anything but itself can be named as mutually exclusive; no pairing is ever illegal. */
export function eligibleExclusions(upgrade, all = getUpgrades()) {
  return all.filter(u => u.id !== upgrade?.id);
}

/**
 * The sibling that has already been taken, if any — the reason this one is ruled out.
 * Only siblings count, so buying a repeatable upgrade a second time never rules itself out.
 */
export function exclusiveClaim(upgrade, all = getUpgrades()) {
  return exclusiveSiblings(upgrade, all).find(u => u.purchases?.length) ?? null;
}

export function isExcluded(upgrade, all = getUpgrades()) {
  return exclusiveClaim(upgrade, all) !== null;
}

/* ---------- Categories ---------- */

/**
 * Sections the GM groups upgrades into ("Lighthouse", "Runes and Enchanting").
 * Shape: { id, name, icon, sort }. Upgrades reference one by id, or null for uncategorised.
 */
export function getCategories() {
  const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.CATEGORIES)) ?? [];
  return stored.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

export async function setCategories(categories) {
  return game.settings.set(MODULE_ID, SETTINGS.CATEGORIES, categories);
}

export async function upsertCategory(data) {
  const categories = getCategories();
  const idx = categories.findIndex(c => c.id === data.id);
  if (idx >= 0) categories[idx] = { ...categories[idx], ...data };
  else categories.push({
    id: data.id ?? foundry.utils.randomID(),
    name: t("UPGRADES.New.Section"), icon: "fa-solid fa-folder", sort: categories.length,
    ...data
  });
  return setCategories(categories);
}

/** Deleting a section keeps its upgrades — they fall back to uncategorised. */
export async function deleteCategory(id) {
  await setCategories(getCategories().filter(c => c.id !== id));
  const upgrades = getUpgrades();
  let touched = false;
  for (const u of upgrades) {
    if (u.categoryId === id) { u.categoryId = null; touched = true; }
  }
  if (touched) await setUpgrades(upgrades);
}

/** Swap a section with its neighbour. */
export async function moveCategory(id, delta) {
  const categories = getCategories();
  const i = categories.findIndex(c => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= categories.length) return;
  [categories[i], categories[j]] = [categories[j], categories[i]];
  categories.forEach((c, n) => { c.sort = n; });
  return setCategories(categories);
}

/**
 * Upgrades arranged into their sections, for display.
 * Uncategorised upgrades come last, and only carry a heading when sections exist at all —
 * a world that never defines one should look exactly as it did before.
 */
export function groupByCategory(upgrades) {
  const categories = getCategories();
  if (!categories.length) return [{ id: null, name: null, icon: null, upgrades }];

  const groups = categories.map(c => ({ ...c, upgrades: upgrades.filter(u => u.categoryId === c.id) }));
  const known = new Set(categories.map(c => c.id));
  const loose = upgrades.filter(u => !u.categoryId || !known.has(u.categoryId));
  if (loose.length) groups.push({ id: null, name: "Other", icon: "fa-solid fa-folder-open", upgrades: loose });
  return groups.filter(g => g.upgrades.length);
}

/* ---------- Currency pool ---------- */
