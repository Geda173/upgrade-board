/**
 * Purchase pipeline: player request → GM approval → commit (deduct, mark, announce).
 * Everything in this file runs on the GM client only (dispatched via sockets.js).
 */
import { TARGET, addPurchase, exclusiveClaim, getUpgrade, isAvailable, tierShortfall, unmetRequirements } from "./catalog.js";
import { addHistory, adjustBalance, canAfford, describeCosts, getBalance, getCosts } from "./economy.js";
import { MODULE_ID, SETTINGS, getVocabulary } from "./settings.js";
import { anyGMOnline, emit, refreshOpenApps } from "./sockets.js";
import { applyUpgradeEffect, describeTarget, getPartyActors } from "./systems/adapter.js";
import { t } from "./i18n.js";

/**
 * Why this purchase cannot go ahead right now, or null when it can.
 *
 * Checked here as well as in the UI: the socket request is the real entry point. Two clients can
 * request opposite sides of the same choice at once, so this is decided here — on the one client
 * that commits — rather than trusted from whatever the shop last rendered.
 */
function refusalReason(upgrade) {
  if (!upgrade || upgrade.hidden || !isAvailable(upgrade)) {
    return t("UPGRADES.Refuse.Unavailable");
  }
  const unmet = unmetRequirements(upgrade);
  if (unmet.length) {
    return t("UPGRADES.Refuse.NeedsFirst", { name: upgrade.name, needs: unmet.map(u => u.name).join(t("UPGRADES.Refuse.And")) });
  }
  // The tier gate is the third lock rule, and like the other two it is decided here — on the
  // client that commits — because another purchase can refund out from under an open dialog.
  const shortfall = tierShortfall(upgrade);
  if (shortfall) {
    return t("UPGRADES.Refuse.TierGate", { name: upgrade.name, count: shortfall.missing });
  }
  const claim = exclusiveClaim(upgrade);
  if (claim) {
    return t("UPGRADES.Refuse.RuledOut", { name: upgrade.name, rival: claim.name });
  }
  if (!canAfford(upgrade)) {
    const short = describeCosts(upgrade)
      .filter(c => getBalance(c.currencyId) < c.amount)
      .map(c => `${getBalance(c.currencyId)}/${c.amount} ${c.currency.name}`)
      .join(", ");
    return t("UPGRADES.Refuse.TooCostly", { short });
  }
  return null;
}

/** Entry point for a player's purchase request (or a GM's direct purchase). */
export async function handlePurchaseRequest({ upgradeId, userId, choice = null }) {
  let upgrade = getUpgrade(upgradeId);
  const user = game.users.get(userId);
  const vocab = getVocabulary();

  const refused = refusalReason(upgrade);
  if (refused) return notifyUser(userId, refused);

  const requireApproval = game.settings.get(MODULE_ID, SETTINGS.REQUIRE_APPROVAL);
  const isGMDirect = user?.isGM;

  if (requireApproval && !isGMDirect) {
    const approved = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("UPGRADES.Approve.Title", { title: vocab.windowTitle }) },
      content: `<p>${t("UPGRADES.Approve.Body", {
          who: `<strong>${foundry.utils.escapeHTML(user?.name ?? t("UPGRADES.Approve.APlayer"))}</strong>`,
          what: `<strong>${foundry.utils.escapeHTML(upgrade.name)}</strong>`,
          price: `<strong>${foundry.utils.escapeHTML(priceLabel(upgrade))}</strong>`
        })}</p>
        <p>${t("UPGRADES.Approve.AppliesTo", {
          target: `<strong>${foundry.utils.escapeHTML(describeTarget(upgrade))}</strong>`
        })}</p>
        <p>${t("UPGRADES.Approve.Question")}</p>`,
      modal: false
    });
    if (!approved) {
      await notifyUser(userId, t("UPGRADES.Refuse.Declined", { name: upgrade.name }));
      return;
    }
  }

  // Resolve who it lands on before spending anything, so a failure here costs nothing.
  let buyerActor = null;
  if (upgrade.target === TARGET.BUYER) {
    buyerActor = await resolveBuyer(user);
    if (!buyerActor) {
      return notifyUser(userId, t(user?.isGM
        ? "UPGRADES.Refuse.NoCharacterChosen"
        : "UPGRADES.Refuse.NoAssignedCharacter"));
    }
  }

  // The dialogs above can sit open for minutes while other requests commit. Re-read and re-check
  // immediately before committing: the first pass answered "may this be asked", this one answers
  // "may this still happen" — otherwise two approved rivals both go through, and the second
  // purchase of an emptied pot under-pays silently (the balance clamps at zero rather than erring).
  upgrade = getUpgrade(upgradeId);
  const stale = refusalReason(upgrade);
  if (stale) return notifyUser(userId, stale);

  await commitPurchase(upgrade, user, buyerActor, choice);
}

/**
 * Which character is buying.
 *
 * A player's assigned character is the obvious answer. A GM usually has none, so rather than
 * failing we ask — that is also how a GM buys something on a player's behalf.
 */
async function resolveBuyer(user) {
  if (user?.character) return user.character;
  if (!user?.isGM) return null;

  const candidates = getPartyActors();
  if (!candidates.length) {
    ui.notifications.warn(t("UPGRADES.Notify.NoPartyMembers"));
    return null;
  }
  const options = candidates
    .map(a => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`).join("");
  const chosen = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("UPGRADES.Buyer.Title") },
    content: `<div class="form-group"><label>${t("UPGRADES.UpgradeEditor.Character")}</label>
      <select name="actorId" autofocus>${options}</select></div>`,
    ok: { label: t("UPGRADES.Buyer.Grant"), callback: (_e, button) => button.form.elements.actorId.value }
  }).catch(() => null);
  return chosen ? game.actors.get(chosen) : null;
}

/** "3 Marks and 1 Favour" */
function priceLabel(upgrade) {
  const parts = describeCosts(upgrade).map(c => `${c.amount} ${c.currency.name}`);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

async function commitPurchase(upgrade, user, buyerActor = null, choice = null) {
  // Typed "spend", not "adjust": these lines belong to their purchase, so sweeping the GM's
  // manual adjustments out of the ledger leaves them standing next to it.
  for (const cost of getCosts(upgrade)) {
    await adjustBalance(cost.currencyId, -cost.amount, t("UPGRADES.Ledger.Acquired", { name: upgrade.name }), { type: "spend" });
  }

  const purchase = await addPurchase(upgrade.id, {
    actorId: buyerActor?.id ?? (upgrade.target === TARGET.ACTOR ? upgrade.targetActorId : null),
    actorName: buyerActor?.name ?? null,
    by: user?.name ?? "GM",
    choice
  });

  await addHistory({
    type: "purchase", upgradeId: upgrade.id, name: upgrade.name, price: priceLabel(upgrade),
    by: user?.name ?? "GM", forActor: buyerActor?.name ?? null
  });

  // Apply the mechanical payload, if the upgrade has one (cosmetic upgrades no-op silently).
  let effectNote = "";
  try {
    const applied = await applyUpgradeEffect(upgrade, { buyerActor, purchaseId: purchase?.id, choice });
    if (applied?.count) {
      effectNote = `<p class="upg-effect-note">✦ ${t("UPGRADES.Chat.EffectApplied", { names: foundry.utils.escapeHTML(applied.names.join(", ")) })}</p>`;
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to apply effect`, err);
    ui.notifications.warn(t("UPGRADES.Notify.EffectFailed"));
  }

  await ChatMessage.create({
    content: `
      <div class="upgrades-chat-card">
        ${upgrade.img ? `<img src="${foundry.utils.escapeHTML(upgrade.img)}" alt="">` : ""}
        <h3>${foundry.utils.escapeHTML(upgrade.name)}${choice ? ` (${foundry.utils.escapeHTML(choice.name)})` : ""}</h3>
        <p class="upg-flavor"><em>${foundry.utils.escapeHTML(upgrade.flavor ?? "")}</em></p>
        <p>${t("UPGRADES.Chat.AcquiredFor", { price: `<strong>${foundry.utils.escapeHTML(priceLabel(upgrade))}</strong>` })}</p>
        ${effectNote}
      </div>`
  });

  emit({ type: "refresh" });
  refreshOpenApps();
}

async function notifyUser(userId, message) {
  if (userId === game.user.id) ui.notifications.info(message);
  else emit({ type: "notify", userId, message });
}

/** Called from the shop UI on any client. Routes to the GM. */
export async function requestPurchase(upgradeId) {
  // Without a GM client there is nothing to receive the request — it would vanish into the
  // socket while the player is told it was sent. Better to say so before asking anything.
  if (!game.user.isGM && !anyGMOnline()) {
    return ui.notifications.warn(t("UPGRADES.Notify.NoGM"));
  }

  const upgrade = getUpgrade(upgradeId);

  // Asked here, on the buyer's own client, so the answer can travel with the request instead of
  // the GM having to ask back over the socket.
  let choice = null;
  if (upgrade?.choice?.enabled) {
    const { promptForDocument } = await import("./apps/choice-dialog.js");
    choice = await promptForDocument({
      label: upgrade.choice.label || t("UPGRADES.Buyer.Choose"),
      hint: upgrade.choice.hint || ""
    });
    if (!choice) return;   // cancelled: nothing spent, nothing sent
  }

  if (game.user.isGM) return handlePurchaseRequest({ upgradeId, userId: game.user.id, choice });
  emit({ type: "requestPurchase", upgradeId, userId: game.user.id, choice });
  ui.notifications.info(t("UPGRADES.Notify.RequestSent"));
}
