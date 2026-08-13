/**
 * System adapter: applies/removes an upgrade's mechanical payload on its target actors.
 *
 * The payload (upgrade.effectUuid) may point at:
 *  - an ActiveEffect (dnd5e & most systems)  → copied onto each actor as an ActiveEffect
 *  - an Item (PF2e Effect items, or a 5e feature/item) → copied onto each actor as an Item
 * Everything created is flagged with the upgrade id for clean refund/undo.
 */
import { TARGET } from "../catalog.js";
import { MODULE_ID, LEGACY_MODULE_ID, SETTINGS } from "../settings.js";
import { EFFECT_MODE, buildChanges, buildEnchantChanges, buildRules, buildRuneWrites, isPf2e } from "../effects.js";
import { t } from "../i18n.js";

/**
 * The party: members of the configured Group/Party actor.
 *
 * The fallback (every player-owned character) is deliberately last — a mature world tends to
 * hold dozens of "character" actors that are not PCs (wildshape copies, loot holders, summons),
 * so configuring the Party actor setting is strongly preferred.
 */
export function getPartyActors() {
  const configuredId = game.settings.get(MODULE_ID, SETTINGS.PARTY_ACTOR);
  const configured = configuredId ? game.actors.get(configuredId) : null;
  if (configured) {
    const members = groupMembers(configured);
    if (members.length) return members;
    console.warn(`${MODULE_ID} | Configured party actor "${configured.name}" has no character members.`);
  }

  // PF2e: Party actor
  if (game.system.id === "pf2e") {
    const party = game.actors.find(a => a.type === "party");
    const members = party ? groupMembers(party) : [];
    if (members.length) return members;
  }
  // dnd5e: first Group actor that has members
  if (game.system.id === "dnd5e") {
    for (const group of game.actors.filter(a => a.type === "group")) {
      const members = groupMembers(group);
      if (members.length) return members;
    }
  }
  // Last resort: every player-owned character
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

/** Character members of a Group (dnd5e) or Party (PF2e) actor. */
function groupMembers(actor) {
  // PF2e exposes resolved documents directly
  if (actor.members?.length) return [...actor.members].filter(a => a?.type === "character");
  // dnd5e stores {actor} references or raw ids
  return (actor.system?.members ?? [])
    .map(m => m?.actor ?? (typeof m === "string" ? game.actors.get(m) : null))
    .filter(a => a && a.type === "character");
}

/**
 * The actors an upgrade's effect should land on.
 * "actor" upgrades resolve to exactly one actor; "party" upgrades to the whole party.
 */
export function getTargetActors(upgrade, { buyerActor = null } = {}) {
  if (upgrade.target === TARGET.BUYER) {
    // Resolved at purchase time; nothing to resolve from the upgrade alone.
    return buyerActor ? [buyerActor] : [];
  }
  if (upgrade.target === TARGET.ACTOR) {
    const actor = upgrade.targetActorId ? game.actors.get(upgrade.targetActorId) : null;
    if (!actor) {
      console.warn(`${MODULE_ID} | Upgrade "${upgrade.name}" targets a missing actor (${upgrade.targetActorId}).`);
      return [];
    }
    return [actor];
  }
  return getPartyActors();
}

/**
 * The item an "item" upgrade lands on, or null when it is gone or unowned.
 *
 * Only items carried by an actor are legal targets: a sidebar item affects nobody, and every
 * copy handed out is a separate document the grant would silently miss. The picker enforces the
 * same rule, but the upgrade may have been edited or the item traded away since.
 */
export function getTargetItem(upgrade, choice = null) {
  // A fixed target always wins; without one, the buyer's nomination (recorded on the
  // purchase) is the target. Both resolve through the same carried-item rules.
  const uuid = upgrade.targetItemUuid || choice?.uuid || null;
  const item = uuid ? fromUuidSync(uuid) : null;
  if (!item || item.documentName !== "Item") {
    console.warn(`${MODULE_ID} | Upgrade "${upgrade.name}" targets a missing item (${uuid}).`);
    return null;
  }
  if (!(item.parent instanceof Actor)) {
    console.warn(`${MODULE_ID} | Upgrade "${upgrade.name}" targets an item nobody carries (${uuid}).`);
    return null;
  }
  return item;
}

/**
 * The documents an upgrade's payload should be embedded on — actors, or one carried item.
 * The single path every apply-side caller goes through, so "who gets this" is decided once.
 */
export function getTargetDocuments(upgrade, { buyerActor = null, choice = null } = {}) {
  if (upgrade.target === TARGET.ITEM) {
    const item = getTargetItem(upgrade, choice);
    return item ? [item] : [];
  }
  return getTargetActors(upgrade, { buyerActor });
}

/** Human-readable description of who an upgrade applies to. */
export function describeTarget(upgrade) {
  if (upgrade.target === TARGET.BUYER) return t("UPGRADES.Target.Buyer");
  if (upgrade.target === TARGET.ITEM) {
    // No fixed item means the buyer nominates one when they purchase.
    if (!upgrade.targetItemUuid) return t("UPGRADES.Target.ChosenItem");
    const item = fromUuidSync(upgrade.targetItemUuid);
    if (!item) return t("UPGRADES.Target.Unknown");
    return item.parent instanceof Actor
      ? t("UPGRADES.Target.ItemCarried", { item: item.name, owner: item.parent.name })
      : item.name;
  }
  if (upgrade.target !== TARGET.ACTOR) return t("UPGRADES.Target.Party");
  const actor = upgrade.targetActorId ? game.actors.get(upgrade.targetActorId) : null;
  return actor?.name ?? t("UPGRADES.Target.Unknown");
}

/**
 * Resolve an upgrade's payload into `{ documentName, data }` ready to embed, or null.
 * "build" assembles an ActiveEffect from the GM's preset rows; "link" clones a real document.
 */
export async function resolveEffectPayload(upgrade, { choice = null } = {}) {
  const mode = upgrade.effectMode ?? (upgrade.effectUuid ? EFFECT_MODE.LINK : EFFECT_MODE.NONE);

  if (mode === EFFECT_MODE.BUILD && isPf2e()) {
    // PF2e drives mechanics through rule elements on an Effect *item*, not ActiveEffect changes.
    // Duration defaults to unlimited (value -1), which is what a permanent upgrade wants.
    const rows = upgrade.effectBuild?.rows ?? [];
    const rules = buildRules(rows, { label: upgrade.name || "Upgrade" });
    // Rune rows are field writes on the target item, not rules — they ride the payload as a
    // plan of their own and are applied by `applyRuneWrites`. The item may itself be the
    // buyer's nomination, which is why the choice reaches down this far.
    const runes = upgrade.target === TARGET.ITEM
      ? buildRuneWrites(rows, getTargetItem(upgrade, choice)) : [];
    if (!rules.length && !runes.length) return null;
    return {
      ...(runes.length ? { runes } : {}),
      documentName: "Item",
      data: upgrade.showInEffectsBar
        ? {
            // An "effect" is PF2e's temporary-condition type, so it appears in the effects bar.
            name: upgrade.name || "Upgrade",
            type: "effect",
            img: upgrade.img || "icons/svg/upgrade.svg",
            system: {
              description: { value: upgrade.description || upgrade.flavor || "" },
              rules,
              duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
              level: { value: 1 },
              tokenIcon: { show: true },
              start: { value: 0, initiative: null },
              unidentified: false
            }
          }
        : {
            // Rule elements live on the base item schema and prepareRuleElements() walks every
            // item, so a feat applies the same bonuses without cluttering the effects bar.
            name: upgrade.name || "Upgrade",
            type: "feat",
            img: upgrade.img || "icons/svg/upgrade.svg",
            system: {
              description: { value: upgrade.description || upgrade.flavor || "" },
              rules,
              category: "bonus",
              level: { value: 1 },
              // A repeatable upgrade really is taken more than once; leaving the default of 1
              // would have the feat contradict the three copies of itself on the sheet.
              maxTakable: upgrade.repeatable ? 99 : 1,
              traits: { value: [], rarity: "common" }
            }
          }
    };
  }

  if (mode === EFFECT_MODE.BUILD) {
    const rows = upgrade.effectBuild?.rows ?? [];
    const changes = buildChanges(rows);
    // Item-upgrade rows become a *separate* enchantment-type effect on the item — the only
    // shape dnd5e applies to an item's own data — never changes on the wielder effect.
    const enchant = (upgrade.target === TARGET.ITEM && game.system.id === "dnd5e")
      ? buildEnchantChanges(rows, getTargetItem(upgrade, choice)) : [];
    if (!changes.length && !enchant.length) return null;
    return {
      ...(enchant.length ? { enchant } : {}),
      documentName: "ActiveEffect",
      data: {
        name: upgrade.name,
        img: upgrade.img || "icons/svg/upgrade.svg",
        changes,
        disabled: false,
        transfer: false,
        origin: null,
        description: upgrade.flavor ?? ""
      }
    };
  }

  if (mode === EFFECT_MODE.LINK) {
    if (!upgrade.effectUuid) return null;
    const source = await fromUuid(upgrade.effectUuid);
    if (!source) return null;
    const data = source.toObject();
    delete data._id;
    if (source.documentName === "ActiveEffect") {
      data.origin = null;
      data.transfer = false;
    }
    return { documentName: source.documentName === "ActiveEffect" ? "ActiveEffect" : "Item", data };
  }

  return null;
}

/**
 * Embed a resolved payload on one actor, flagged with the upgrade id.
 *
 * When the payload is an ActiveEffect and the GM asked for "feature" granting, the effect is
 * wrapped in a dnd5e feat item so it shows up in Features rather than hiding on the Effects tab.
 * Deleting that one item takes the bonus with it, which is what makes refund/undo clean.
 */
async function createFromPayload(target, payload, upgrade, purchaseId = null, choice = null) {
  const data = foundry.utils.deepClone(payload.data);
  const suffix = choice?.name ? ` (${choice.name})` : "";
  const link = choice?.name ? `<p>Chosen: @UUID[${choice.uuid}]{${choice.name}}</p>` : "";

  // A nominated document names the grant, so "Temporary Scroll" on the sheet reads
  // "Temporary Scroll (Fireball)" and links back to what was chosen.
  if (choice?.name) {
    data.name = `${data.name}${suffix}`;
    const path = payload.documentName === "Item" ? "system.description.value" : "description";
    const existing = foundry.utils.getProperty(data, path) ?? "";
    foundry.utils.setProperty(data, path, `${existing}${link}`);
  }

  foundry.utils.setProperty(data, `flags.${MODULE_ID}.upgradeId`, upgrade.id);
  if (purchaseId) foundry.utils.setProperty(data, `flags.${MODULE_ID}.purchaseId`, purchaseId);

  // An item target takes the payload directly. The wrapper feat below is a way of keeping a
  // character sheet tidy and makes no sense inside a sword.
  if (target.documentName === "Item") {
    let made = 0;

    // dnd5e item-preset rows arrive as a separate enchantment: `type: "enchantment"` with a
    // non-self origin is the one shape whose changes reach the *item's* own data —
    // Item5e.allApplicableEffects yields applied enchantments and nothing else, and the
    // actor-side iterator skips them symmetrically (release-5.3.3). `transfer` stays false;
    // this effect is about the sword, not its wielder. The parent actor is a real, resolvable,
    // non-self origin that carries no canEnchant() to object.
    if (payload.enchant?.length) {
      await target.createEmbeddedDocuments("ActiveEffect", [{
        name: data.name, img: data.img,
        type: "enchantment",
        origin: target.parent?.uuid ?? null,
        changes: foundry.utils.deepClone(payload.enchant),
        transfer: false, disabled: false,
        description: data.description ?? "",
        flags: foundry.utils.deepClone(data.flags)
      }]);
      made++;
    }

    if (payload.documentName === "ActiveEffect") {
      // `transfer: true` is what carries the effect to whoever holds the item — and, because
      // both systems suppress effects from unequipped/unattuned items, what makes a stashed
      // sword grant nothing. That suppression is the feature, not a bug. A build whose rows
      // were all item presets has no wielder half, so nothing empty is created.
      if (data.changes?.length || !payload.enchant) {
        data.transfer = true;
        data.disabled = false;
        await target.createEmbeddedDocuments("ActiveEffect", [data]);
        made++;
      }
      return made;
    }

    if (payload.data?.system?.rules?.length) {
      await mergeRulesIntoItem(target, payload, upgrade, purchaseId);
      made++;
    }
    if (payload.runes?.length) {
      made += await applyRuneWrites(target, payload.runes, upgrade, purchaseId);
    }
    // Rune writes can all be refused legitimately (the sword is already that strong) — each
    // refusal warned for itself, so zero is a quiet no-op there. Zero *without* runes in play
    // means a linked document nothing an item can hold, which must stay a hard error.
    if (!made && !payload.runes?.length) {
      throw new Error(`payload for "${upgrade.name}" cannot be embedded on an item`);
    }
    return made;
  }
  const actor = target;

  // Same choice on the dnd5e side: a bare ActiveEffect shows on the Effects tab, while wrapping
  // it in a feat keeps it quiet and puts it under Features where a permanent upgrade belongs.
  const wrap = payload.documentName === "ActiveEffect" && !upgrade.showInEffectsBar
    && game.system.id === "dnd5e";

  if (wrap) {
    // The wrapper is what the sheet shows, so the choice suffix and link go on it too — carried
    // only by the embedded effect they would be invisible without opening it.
    const item = {
      name: `${upgrade.name || payload.data.name}${suffix}`,
      type: "feat",
      img: upgrade.img || data.img || "icons/svg/upgrade.svg",
      system: { description: { value: `${upgrade.description || upgrade.flavor || ""}${link}` } },
      effects: [{ ...data, transfer: true, disabled: false }],
      flags: { [MODULE_ID]: { upgradeId: upgrade.id, ...(purchaseId ? { purchaseId } : {}) } }
    };
    return actor.createEmbeddedDocuments("Item", [item]);
  }

  return actor.createEmbeddedDocuments(payload.documentName, [data]);
}

/**
 * PF2e's half of granting to an item: an item cannot contain another item, so the built rule
 * elements are merged into the target's own `system.rules` instead of arriving as a document.
 *
 * Each merged rule is stamped with `{ [MODULE_ID]: { upgradeId, purchaseId } }`. That key is not
 * in the rule-element schema, which is precisely why it works: Foundry's DataModel validates and
 * cleans only declared fields (checked against `base.ts` at pf2e-8.3.0), so the tag rides along
 * in storage, PF2e ignores it, and refund can tell our rules from the GM's own — a merged rule
 * is not a document, so the usual flag has nowhere else to live. PF2e also ignores rules on
 * physical items that are not equipped/invested (`requiresEquipped` defaults on), so the
 * equipped-only behaviour needs nothing from us here.
 */
async function mergeRulesIntoItem(item, payload, upgrade, purchaseId = null) {
  const incoming = payload.data?.system?.rules;
  if (!Array.isArray(incoming) || !incoming.length) {
    // A linked document with no rule elements has nothing an item could carry.
    throw new Error(`payload for "${upgrade.name}" cannot be embedded on an item`);
  }
  const tag = { upgradeId: upgrade.id, ...(purchaseId ? { purchaseId } : {}) };
  const tagged = incoming.map(rule => ({ ...foundry.utils.deepClone(rule), [MODULE_ID]: tag }));
  const existing = sourceRules(item).map(rule => foundry.utils.deepClone(rule));
  return item.update({ "system.rules": [...existing, ...tagged] });
}

/**
 * An item's rules as STORED, never as prepared. PF2e's data prep rebuilds `system.rules` from
 * source through the rule-element schema, which drops undeclared keys — including the stamp
 * that is the only thing telling our rules from the GM's own. The stamp survives storage
 * (verified against base.ts at pf2e-8.3.0 and now against a live world); it just never appears
 * in prepared data. Reading the prepared array here made refund silently strip nothing and
 * merging bake prepared-only fields into storage — found live, 2026-08-13.
 */
function sourceRules(item) {
  return (item.toObject?.() ?? item)?.system?.rules ?? item.system?.rules ?? [];
}

/**
 * PF2e rune grants: write the fields, and record what changed under
 * `flags.<module>.runeGrants` on the item — the same job the per-rule stamp does for merged
 * rules, because a rune is not a document and the record is the only handle a refund has.
 *
 * Numeric runes never downgrade: a +1 upgrade bought for a sword that is already +2 changes
 * nothing, says so, and records nothing — there is nothing for a refund to reverse. Source
 * values are read from `toObject()`, not prepared data, because ABP zeroes prepared runes.
 */
async function applyRuneWrites(item, runes, upgrade, purchaseId = null) {
  if (!runes?.length) return 0;
  const source = item.toObject().system?.runes ?? {};
  const update = {};
  const records = [];
  for (const write of runes) {
    if (write.field === "property") {
      const list = update["system.runes.property"] ?? [...(source.property ?? [])];
      if (list.includes(write.slug)) {
        ui.notifications.warn(t("UPGRADES.Notify.RuneAlready", { item: item.name }));
        continue;
      }
      list.push(write.slug);
      update["system.runes.property"] = list;
      records.push({ upgradeId: upgrade.id, purchaseId, field: "property", slug: write.slug });
    } else {
      const key = `system.runes.${write.field}`;
      const from = update[key] ?? Number(source[write.field] ?? 0);
      if (from >= write.value) {
        ui.notifications.warn(t("UPGRADES.Notify.RuneNotBetter", { item: item.name }));
        continue;
      }
      update[key] = write.value;
      records.push({ upgradeId: upgrade.id, purchaseId, field: write.field, from, to: write.value });
    }
  }
  if (!records.length) return 0;

  const prior = item.flags?.[MODULE_ID]?.runeGrants ?? [];
  update[`flags.${MODULE_ID}.runeGrants`] = [...prior.map(g => ({ ...g })), ...records];
  await item.update(update);

  // Two ways a written rune can sit inert, both said out loud rather than discovered mid-fight:
  // ABP zeroes rune values at every prep, and property runes only occupy slots up to potency.
  const abp = game.pf2e?.settings?.variants?.abp;
  if (abp && abp !== "noABP") {
    ui.notifications.warn(t("UPGRADES.Notify.RuneAbp", { item: item.name }));
  }
  const potency = update["system.runes.potency"] ?? Number(source.potency ?? 0);
  const property = update["system.runes.property"] ?? source.property ?? [];
  if (property.length > potency) {
    ui.notifications.warn(t("UPGRADES.Notify.RuneNeedsPotency", { item: item.name }));
  }
  return records.length;
}

/**
 * Reverse this upgrade's recorded rune writes, newest first so stacked numerics unwind cleanly.
 * A field the GM has since changed by hand is left alone — reverting their number would be a
 * second wrong — but the record still goes: the purchase is refunded either way, and silence
 * is the one thing this may not do.
 */
async function removeRuneGrants(item, upgradeId, purchaseId = null) {
  const grants = item.flags?.[MODULE_ID]?.runeGrants;
  if (!Array.isArray(grants) || !grants.length) return 0;
  const matches = g => (purchaseId ? g.purchaseId === purchaseId : g.upgradeId === upgradeId);
  const mine = grants.filter(matches);
  if (!mine.length) return 0;

  const source = item.toObject().system?.runes ?? {};
  const update = {};
  for (const grant of [...mine].reverse()) {
    if (grant.field === "property") {
      const list = update["system.runes.property"] ?? [...(source.property ?? [])];
      const at = list.indexOf(grant.slug);
      if (at >= 0) list.splice(at, 1);
      update["system.runes.property"] = list;
    } else {
      const key = `system.runes.${grant.field}`;
      const current = update[key] ?? Number(source[grant.field] ?? 0);
      if (current === grant.to) update[key] = grant.from;
      else ui.notifications.warn(t("UPGRADES.Notify.RuneChangedByHand", { item: item.name }));
    }
  }
  update[`flags.${MODULE_ID}.runeGrants`] = grants.filter(g => !matches(g)).map(g => ({ ...g }));
  await item.update(update);
  return mine.length;
}

/** Does this recorded rune grant belong to the given upgrade or purchase? */
function runeGrantMatches(item, upgradeId, purchaseId) {
  const grants = item.flags?.[MODULE_ID]?.runeGrants;
  return Array.isArray(grants) && grants.some(g =>
    purchaseId ? g.purchaseId === purchaseId : g.upgradeId === upgradeId);
}

/** Does this stored rule element belong to the given upgrade or purchase? */
function mergedRuleMatches(rule, upgradeId, purchaseId) {
  const tag = rule?.[MODULE_ID];
  if (!tag) return false;
  return purchaseId ? tag.purchaseId === purchaseId : tag.upgradeId === upgradeId;
}

/** Strip this upgrade's merged rule elements back out of an item. Returns how many went. */
async function stripMergedRules(item, upgradeId, purchaseId = null) {
  const rules = sourceRules(item);
  if (!Array.isArray(rules) || !rules.length) return 0;
  const keep = rules.filter(rule => !mergedRuleMatches(rule, upgradeId, purchaseId));
  if (keep.length === rules.length) return 0;
  await item.update({ "system.rules": keep.map(rule => foundry.utils.deepClone(rule)) });
  return rules.length - keep.length;
}

/**
 * Already granted?
 *
 * A repeatable upgrade is matched on the purchase id, not the upgrade id — buying the same
 * thing twice is meant to produce two copies, so matching on upgrade id would block the second.
 */
/**
 * Does this document belong to the given upgrade or purchase?
 *
 * Checked under both ids. Anything granted before v0.22.0 carries `flags.upgrades`, and the
 * flag is the only reason a refund can find what it created — miss it and the effect stays on
 * the sheet forever with nothing able to remove it. Grants made from now on carry the new one.
 *
 * The legacy namespace is read off `doc.flags` directly and NOT through `getFlag`. `getFlag`
 * validates the scope against the currently active packages and *throws* — "Flag scope
 * "upgrades" is not valid or not currently active" — for anything else. After the rename that
 * module is by definition gone, so the legacy read threw on the first document it touched, and
 * because `hasUpgrade` runs this over every item the actor owns, it threw before a purchase
 * could apply anything. That is the whole bug: a world that migrated could not buy at all.
 */
function flagged(doc, upgradeId, purchaseId) {
  const field = purchaseId ? "purchaseId" : "upgradeId";
  const wanted = purchaseId ?? upgradeId;
  return doc.getFlag(MODULE_ID, field) === wanted
      || doc.flags?.[LEGACY_MODULE_ID]?.[field] === wanted;
}

function hasUpgrade(target, upgradeId, purchaseId = null) {
  if (findGrant(target, upgradeId, purchaseId)) return true;
  if (target.documentName !== "Item") return false;
  // A grant to an item may not be a document at all: rules merged into the item, or recorded
  // rune writes. Both must count as "granted" or a re-sync would grant them again. Read from
  // source — the stamp never survives into prepared data (see sourceRules).
  const rules = sourceRules(target);
  if (Array.isArray(rules) && rules.some(rule => mergedRuleMatches(rule, upgradeId, purchaseId))) return true;
  return runeGrantMatches(target, upgradeId, purchaseId);
}

/**
 * The document this module created on a target for a given upgrade, or null.
 * Works on an actor (embedded items and effects) and on an item (its own effects).
 */
function findGrant(target, upgradeId, purchaseId = null) {
  const matches = doc => flagged(doc, upgradeId, purchaseId);
  return target.items?.find(matches) ?? target.effects?.find(matches) ?? null;
}

/**
 * The mechanical core of a grant, reduced to a string, so a sheet can be compared against what
 * the catalogue would build today.
 *
 * Deliberately ignores name, artwork, description and flags: those are cosmetic, a GM may have
 * tidied them by hand, and rebuilding a sheet over a renamed icon would be obnoxious. What it
 * does compare is the part that actually does something — ActiveEffect changes on dnd5e, rule
 * elements on PF2e. Works on both a resolved payload's `data` and a live embedded document,
 * which is the whole point: the two have to be reducible to the same shape to be comparable.
 *
 * The dnd5e wrapper feat keeps the real changes on an embedded effect rather than on itself,
 * so that case is unwrapped here.
 */
export function grantSignature(source) {
  if (!source) return null;
  const effects = source.effects?.contents ?? source.effects;
  const embedded = Array.isArray(effects) ? effects[0] : null;
  const changes = source.changes ?? embedded?.changes;
  if (changes) {
    return JSON.stringify(changes.map(c => [c.key, Number(c.mode), String(c.value ?? "")]));
  }
  // Rules must come from source, not prepared data: PF2e's prep decorates every rule with
  // schema defaults (slug, priority, fromEquipment, …), so a prepared grant never compares
  // equal to the bare payload the catalogue builds and re-sync would rebuild it every pass.
  const rules = (source.toObject?.() ?? source)?.system?.rules ?? source.system?.rules;
  if (rules) return JSON.stringify(rules);
  return null;
}

/** Apply the upgrade's effect (if any) to its target actors. GM-side only. */
export async function applyUpgradeEffect(upgrade, { buyerActor = null, purchaseId = null, choice = null } = {}) {
  const payload = await resolveEffectPayload(upgrade, { choice });
  if (!payload) {
    // A cosmetic upgrade is a normal, silent case; a broken link is not.
    if (upgrade.effectMode === EFFECT_MODE.LINK && upgrade.effectUuid) {
      ui.notifications.warn(t("UPGRADES.Notify.LinkUnresolved", { name: upgrade.name }));
    }
    return { count: 0, names: [] };
  }

  // An item can carry an ActiveEffect, merged rule elements or rune writes, but never another
  // item — a linked feature or piece of equipment has no shape a sword could hold.
  if (upgrade.target === TARGET.ITEM && payload.documentName === "Item"
      && !payload.data?.system?.rules?.length && !payload.runes?.length) {
    ui.notifications.warn(t("UPGRADES.Notify.ItemLinkUnsupported", { name: upgrade.name }));
    return { count: 0, names: [] };
  }

  const targets = getTargetDocuments(upgrade, { buyerActor, choice });
  if (!targets.length) {
    ui.notifications.warn(t("UPGRADES.Notify.NoTarget", { name: upgrade.name }));
    return { count: 0, names: [] };
  }

  const names = [];
  for (const target of targets) {
    try {
      if (hasUpgrade(target, upgrade.id, upgrade.repeatable ? purchaseId : null)) continue;
      const made = await createFromPayload(target, payload, upgrade, purchaseId, choice);
      // A rune purchase whose every write was refused (already that strong) granted nothing,
      // and the chat card must not claim otherwise. Document paths return created documents.
      if (made !== 0) names.push(target.name);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not apply effect to ${target.name}`, err);
      ui.notifications.error(t("UPGRADES.Notify.ApplyFailed", { name: upgrade.name, actor: target.name }));
    }
  }
  return { count: names.length, names };
}

/** Remove everything this module created for a given upgrade (refund/undo). GM-side only. */
export async function removeUpgradeEffect(upgradeId, purchaseId = null) {
  const matches = doc => flagged(doc, upgradeId, purchaseId);
  let count = 0;
  for (const actor of game.actors) {
    const items = actor.items?.filter(matches) ?? [];
    if (items.length) {
      await actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
      count += items.length;
    }
    const effects = actor.effects?.filter(matches) ?? [];
    if (effects.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
      count += effects.length;
    }
    // Item-targeted grants live one level deeper: an effect embedded on a carried item, or
    // rule elements merged into one. The snapshot matters — the collection shifts under an
    // await, and the flagged deletions above have already changed it once.
    for (const item of [...(actor.items ?? [])]) {
      const embedded = item.effects?.filter(matches) ?? [];
      if (embedded.length) {
        await item.deleteEmbeddedDocuments("ActiveEffect", embedded.map(e => e.id));
        count += embedded.length;
      }
      count += await stripMergedRules(item, upgradeId, purchaseId);
      count += await removeRuneGrants(item, upgradeId, purchaseId);
    }
  }
  // An upgraded item that was traded back to the sidebar still carries the grant.
  for (const item of [...(game.items ?? [])]) {
    const embedded = item.effects?.filter(matches) ?? [];
    if (embedded.length) {
      await item.deleteEmbeddedDocuments("ActiveEffect", embedded.map(e => e.id));
      count += embedded.length;
    }
    count += await stripMergedRules(item, upgradeId, purchaseId);
    count += await removeRuneGrants(item, upgradeId, purchaseId);
  }
  return { count };
}

/**
 * Re-sync: make the sheets match the catalogue.
 *
 * Two jobs. It creates grants that are missing — late joiners, party-roster changes, an effect
 * someone deleted off a sheet by hand — and it rebuilds grants that have gone stale.
 *
 * The second job exists because a grant is a *snapshot*: the payload is built at the moment of
 * purchase, so correcting a preset in a later release does not reach anything already bought.
 * "All saving throws" gained the death-save path in v0.25.1 and every character who already owned
 * it kept the version that silently skipped death saves, with nothing to tell their GM. Saving
 * the upgrade in the editor rebuilt it, but only if you knew to go and do that for each one — and
 * the button named for exactly this job quietly did not.
 *
 * Only *built* payloads are compared. A linked document is a clone of something the GM owns and
 * may well have edited on purpose since; re-cloning it over their changes is not a re-sync, it is
 * a revert. Cosmetic drift is ignored too — see `grantSignature`.
 */
export async function resyncUpgrades() {
  const { getUpgrades } = await import("../catalog.js");
  let created = 0;
  let refreshed = 0;
  for (const upgrade of getUpgrades().filter(u => u.purchases?.length)) {
    // A buyer-nominated item makes the payload per-purchase — the enchantment's field depends
    // on what kind of item was chosen — so resolution moves inside the loop for that case.
    const nominated = upgrade.target === TARGET.ITEM && !upgrade.targetItemUuid;
    const basePayload = nominated ? null : await resolveEffectPayload(upgrade);
    if (!nominated && !basePayload) continue;
    const isBuilt = (upgrade.effectMode ?? (upgrade.effectUuid ? EFFECT_MODE.LINK : EFFECT_MODE.NONE))
      === EFFECT_MODE.BUILD;
    const wanted = isBuilt && basePayload ? grantSignature(basePayload.data) : null;

    for (const purchase of upgrade.purchases) {
      // A purchase remembers which actor it landed on, which is the only way a buyer-targeted
      // or repeatable grant can be rebuilt on the right sheet.
      const buyerActor = purchase.actorId ? game.actors.get(purchase.actorId) : null;
      const purchaseId = upgrade.repeatable ? purchase.id : null;
      const payload = nominated
        ? await resolveEffectPayload(upgrade, { choice: purchase.choice ?? null })
        : basePayload;
      if (!payload) continue;

      for (const target of getTargetDocuments(upgrade, { buyerActor, choice: purchase.choice ?? null })) {
        const existing = findGrant(target, upgrade.id, purchaseId);
        if (existing) {
          // An item grant can be several pieces — a transferring effect plus an enchantment,
          // or merged rules plus rune writes. findGrant sees one piece; rebuilding from it
          // would duplicate the others. Present means present, as with merged rules below;
          // rebuilding a *stale* multi-piece item grant is not attempted yet.
          if (target.documentName === "Item"
              && (payload.enchant?.length || payload.runes?.length)) continue;
          // Nothing to compare against, or nothing has drifted: leave the sheet alone.
          if (!wanted || grantSignature(existing) === wanted) continue;
          try {
            await target.deleteEmbeddedDocuments(existing.documentName, [existing.id]);
            await createFromPayload(target, payload, upgrade, purchase.id, purchase.choice ?? null);
            refreshed++;
          } catch (err) {
            // A grant that could not be replaced must not leave the sheet without one.
            console.error(`${MODULE_ID} | Could not refresh "${upgrade.name}" on ${target.name}`, err);
          }
          continue;
        }
        // A PF2e grant merged into an item's rules is invisible to findGrant — it is not a
        // document. Present means present: recreating it here would double the rules on every
        // re-sync. Rebuilding a *stale* merged grant is not attempted yet.
        if (hasUpgrade(target, upgrade.id, purchaseId)) continue;
        await createFromPayload(target, payload, upgrade, purchase.id, purchase.choice ?? null);
        created++;
      }
    }
  }
  return { created, refreshed };
}

/**
 * Re-apply a purchased upgrade from scratch: strip what we created, then apply the current
 * payload to the current targets. Used after the GM edits an upgrade that is already owned,
 * so a changed effect or a changed target takes hold immediately.
 */
export async function reapplyUpgradeEffect(upgrade) {
  await removeUpgradeEffect(upgrade.id);
  let count = 0;
  for (const purchase of upgrade.purchases ?? []) {
    const buyerActor = purchase.actorId ? game.actors.get(purchase.actorId) : null;
    // The buyer's nomination has to travel with the rebuild, or editing an owned upgrade would
    // quietly strip "(Fireball)" off every grant it had.
    const result = await applyUpgradeEffect(upgrade, {
      buyerActor, purchaseId: purchase.id, choice: purchase.choice ?? null
    });
    count += result.count;
  }
  return { count, names: [] };
}
