/**
 * GM console: upgrade CRUD, currency ledger, history. (ApplicationV2 + Handlebars)
 */
import { deleteCategory, deleteUpgrade, exclusiveSiblings, getCategories, getUpgrade, getUpgrades,
         groupByCategory, moveCategory, removePurchase, upsertCategory, upsertUpgrade } from "../catalog.js";
import { adjustBalance, clearHistory, describeCosts, editHistoryReason, getBalance, getBalances,
         getCosts, getCurrencies, getCurrency, getHistory, hasMultipleCurrencies,
         removeHistory } from "../economy.js";
import { MODULE_ID, SETTINGS, getVocabulary, isImagePath } from "../settings.js";
import { emit, refreshOpenApps } from "../sockets.js";
import { resyncUpgrades, removeUpgradeEffect, reapplyUpgradeEffect, describeTarget } from "../systems/adapter.js";
import { describeBuild, EFFECT_MODE } from "../effects.js";
import { UpgradeEditor } from "./upgrade-editor.js";
import { UpgradesWindow } from "./ui.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class EditorApp extends UpgradesWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "upgrades-editor",
    classes: ["upgrades", "upg-editor"],
    window: { title: "UPGRADES.Editor.Title", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 760, height: 640 },
    actions: {
      addUpgrade: EditorApp.#onAddUpgrade,
      editUpgrade: EditorApp.#onEditUpgrade,
      deleteUpgrade: EditorApp.#onDeleteUpgrade,
      toggleHidden: EditorApp.#onToggleHidden,
      refund: EditorApp.#onRefund,
      adjustBalance: EditorApp.#onAdjustBalance,
      resync: EditorApp.#onResync,
      openSettings: EditorApp.#onOpenSettings,
      placeCurrency: EditorApp.#onPlaceCurrency,
      addCategory: EditorApp.#onAddCategory,
      editCategory: EditorApp.#onEditCategory,
      removeCategory: EditorApp.#onRemoveCategory,
      moveCategoryUp: EditorApp.#onMoveCategoryUp,
      moveCategoryDown: EditorApp.#onMoveCategoryDown,
      clearHistory: EditorApp.#onClearHistory,
      removeHistoryEntry: EditorApp.#onRemoveHistoryEntry,
      editHistoryEntry: EditorApp.#onEditHistoryEntry
    }
  };

  // The console re-renders after every mutation, so it must name its scrolling element or the
  // GM is thrown back to the top of the table on each edit.
  static SCROLL_SELECTOR = ".upg-editor-body";

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/editor.hbs` }
  };

  static show() {
    if (!game.user.isGM) return;
    EditorApp.instance ??= new EditorApp();
    EditorApp.instance.render({ force: true });
    return EditorApp.instance;
  }

  async _prepareContext(_options) {
    const vocab = getVocabulary();
    const upgrades = getUpgrades();
    const history = getHistory();
    return {
      vocab,
      balance: getBalance(),
      currencies: getCurrencies().map(c => ({
        ...c, balance: getBalances()[c.id] ?? 0, isImage: isImagePath(c.icon ?? "")
      })),
      hasMultipleCurrencies: hasMultipleCurrencies(),
      hasCurrencyItem: !!game.settings.get(MODULE_ID, SETTINGS.CURRENCY_ITEM),
      categories: getCategories(),
      hasCategories: getCategories().length > 0,
      groups: groupByCategory(
        upgrades
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map(u => ({
            ...u,
            targetLabel: describeTarget(u),
            effectLabel: EditorApp.#effectLabel(u),
            // Named rather than counted: the whole question when reading the table is *which*
            // upgrade taking this one would close off.
            exclusiveLabel: exclusiveSiblings(u, upgrades).map(o => o.name).join(", "),
            // The raw `cost` field only ever holds a legacy bare number, so anything priced since
            // multiple resources arrived rendered an empty cell here.
            costLabel: describeCosts(u).map(c => `${c.amount} ${c.currency.name}`).join(", ") || "—",
            ownedCount: u.purchases?.length ?? 0,
            isRepeatable: !!u.repeatable,
            ownedNames: (u.purchases ?? []).map(p => p.actorName).filter(Boolean).join(", ")
          }))
      ),
      history: history.slice(-25).reverse().map(h => ({
        ...h,
        when: new Date(h.ts).toLocaleString(),
        isPurchase: h.type === "purchase",
        // Each line names the resource it actually moved. Falling back to the vocabulary setting
        // labelled every adjustment with the *first* resource's name, whichever one had moved.
        currencyName: getCurrency(h.currencyId)?.name ?? getVocabulary().currencyName,
        // Only a manual adjustment can be reworded; purchase and spend lines are statements of
        // what happened. (Spend lines written before the type existed read as "adjust" and stay
        // editable — indistinguishable, and harmless.)
        canReword: h.type !== "purchase" && h.type !== "spend",
        deltaStr: (h.delta > 0 ? "+" : "") + h.delta
      })),
      hasHistory: history.length > 0,
      // The list is capped at 25, so a Clear button has to say what it is really about to remove.
      historyTotal: history.length
    };
  }

  /** Short "what does it do" cell for the upgrade table. */
  static #effectLabel(upgrade) {
    let label = "";
    if (upgrade.effectMode === EFFECT_MODE.BUILD) label = describeBuild(upgrade.effectBuild?.rows) || t("UPGRADES.Editor.EmptyBonus");
    else if (upgrade.effectMode === EFFECT_MODE.LINK) label = upgrade.effectUuid ? t("UPGRADES.Editor.LinkedEffect") : t("UPGRADES.Editor.LinkNotSet");
    if (label && upgrade.hideEffect && !upgrade.purchased) label += ` · ${t("UPGRADES.Editor.HiddenFromPlayers")}`;
    return label;
  }



  /* ---------- actions ---------- */

  static async #onAddUpgrade() {
    new UpgradeEditor(null, async data => {
      await upsertUpgrade(data);
      EditorApp.#afterMutation();
    }).render({ force: true });
  }

  static async #onEditUpgrade(_event, target) {
    const existing = getUpgrade(target.dataset.id);
    if (!existing) return;
    new UpgradeEditor(existing, async data => {
      await upsertUpgrade({ id: existing.id, ...data });
      // An owned upgrade whose payload or target changed must be rebuilt on the sheets.
      if (existing.purchased) {
        const updated = getUpgrade(existing.id);
        const { count } = await reapplyUpgradeEffect(updated);
        if (count) ui.notifications.info(`Upgrades: re-applied “${updated.name}” to ${count} character(s).`);
      }
      EditorApp.#afterMutation();
    }).render({ force: true });
  }

  static async #onDeleteUpgrade(_event, target) {
    const u = getUpgrade(target.dataset.id);
    if (!u) return;
    const ok = await DialogV2.confirm({
      window: { title: t("UPGRADES.Dialog.DeleteUpgrade") },
      content: `<p>${t("UPGRADES.Dialog.DeleteUpgradeBody", { name: `<strong>${foundry.utils.escapeHTML(u.name)}</strong>` })}</p>`
        + (u.purchased ? `<p>${t("UPGRADES.Dialog.DeleteUpgradeOwned")}</p>` : "")
        + `<p>${t("UPGRADES.Dialog.CannotBeUndone")}</p>`
    });
    if (!ok) return;
    // Delete the catalog entry *and* whatever it put on the sheets, or the bonus is orphaned forever.
    const { count } = await removeUpgradeEffect(u.id);
    await deleteUpgrade(u.id);
    if (count) ui.notifications.info(t("UPGRADES.Notify.RemovedGrants", { count }));
    EditorApp.#afterMutation();
  }

  static async #onToggleHidden(_event, target) {
    const u = getUpgrade(target.dataset.id);
    if (!u) return;
    await upsertUpgrade({ id: u.id, hidden: !u.hidden });
    EditorApp.#afterMutation();
  }

  /** Refunds one acquisition — the most recent — so a repeatable upgrade can be unwound stepwise. */
  static async #onRefund(_event, target) {
    const u = getUpgrade(target.dataset.id);
    if (!u?.purchases?.length) return;
    const vocab = getVocabulary();
    const last = u.purchases[u.purchases.length - 1];
    const who = last.actorName ?? describeTarget(u).toLowerCase();
    const remaining = u.purchases.length - 1;

    const ok = await DialogV2.confirm({
      window: { title: t("UPGRADES.Dialog.RefundUpgrade") },
      content: `<p>${t("UPGRADES.Dialog.RefundBody", {
          name: `<strong>${foundry.utils.escapeHTML(u.name)}</strong>`,
          price: foundry.utils.escapeHTML(describeCosts(u).map(c => `${c.amount} ${c.currency.name}`).join(", ")
            || t("UPGRADES.Dialog.Nothing")),
          who: foundry.utils.escapeHTML(who)
        })}</p>`
        + (remaining ? `<p>${t("UPGRADES.Dialog.RefundRemaining", { count: remaining })}</p>` : "")
    });
    if (!ok) return;

    for (const cost of getCosts(u)) {
      await adjustBalance(cost.currencyId, cost.amount, t("UPGRADES.Ledger.Refund", { name: u.name }), { type: "spend" });
    }
    await removePurchase(u.id, last.id);
    // Repeatable grants carry a purchase id, so only this one is removed.
    await removeUpgradeEffect(u.id, u.repeatable ? last.id : null);
    EditorApp.#afterMutation();
  }

  static async #onAdjustBalance(_event, target) {
    const currencies = getCurrencies();
    // The picker only appears once there is a choice to make.
    const preset = target?.dataset?.currencyId;
    const picker = (currencies.length > 1 && !preset)
      ? `<div class="form-group"><label>${t("UPGRADES.Settings.Resource")}</label><select name="currencyId">`
        + currencies.map(c => `<option value="${c.id}">${foundry.utils.escapeHTML(c.name)}</option>`).join("")
        + `</select></div>`
      : "";

    const result = await DialogV2.prompt({
      window: { title: preset ? t("UPGRADES.Editor.Adjust", { name: getCurrency(preset)?.name ?? "" }) : t("UPGRADES.Dialog.Adjust") },
      content: `${picker}
        <div class="form-group"><label>${t("UPGRADES.Dialog.AmountLabel")}</label>
          <input type="number" name="delta" value="1" step="1" autofocus></div>
        <div class="form-group"><label>${t("UPGRADES.Dialog.ReasonLabel")}</label>
          <input type="text" name="reason" placeholder="${t('UPGRADES.Dialog.ReasonEg')}"></div>`,
      ok: {
        label: t("UPGRADES.Dialog.Apply"),
        callback: (_event, button) => {
          const form = button.form;
          return {
            currencyId: preset ?? form.elements.currencyId?.value ?? currencies[0]?.id,
            delta: Number(form.elements.delta.value) || 0,
            reason: form.elements.reason.value
          };
        }
      }
    }).catch(() => null);
    if (!result || !result.delta) return;
    await adjustBalance(result.currencyId, result.delta, result.reason);
    EditorApp.#afterMutation();
  }

  static async #onOpenSettings() {
    const { SettingsApp } = await import("./settings-app.js");
    SettingsApp.show();
  }

  /** Drop currency into a chest, a body, or anyone else the party will search. */
  static async #onPlaceCurrency() {
    const { getCurrencyItem, placeCurrency } = await import("../currency.js");
    const source = await getCurrencyItem();
    if (!source) {
      return ui.notifications.warn(t("UPGRADES.Notify.NoCurrencyItemSetup"));
    }
    const actors = game.actors.filter(a => a.isOwner).sort((a, b) => a.name.localeCompare(b.name));
    const options = actors
      .map(a => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)} (${a.type})</option>`).join("");
    const result = await DialogV2.prompt({
      window: { title: t("UPGRADES.Editor.Place", { currency: source.name }) },
      content: `<div class="form-group"><label>${t("UPGRADES.Dialog.Into")}</label><select name="actorId">${options}</select></div>
        <div class="form-group"><label>${t("UPGRADES.Dialog.HowMany")}</label>
          <input type="number" name="amount" value="1" min="1" step="1" autofocus></div>`,
      ok: {
        label: t("UPGRADES.Dialog.Place"),
        callback: (_e, button) => ({
          actorId: button.form.elements.actorId.value,
          amount: Math.max(1, Number(button.form.elements.amount.value) || 0)
        })
      }
    }).catch(() => null);
    if (!result) return;
    const actor = game.actors.get(result.actorId);
    const placed = await placeCurrency(actor, result.amount);
    if (placed) ui.notifications.info(t("UPGRADES.Notify.Placed", { count: placed, currency: source.name, actor: actor.name }));
  }

  static async #onAddCategory() {
    const section = await EditorApp.#promptSection(t("UPGRADES.Editor.NewSection"));
    if (!section) return;
    await upsertCategory(section);
    EditorApp.#afterMutation();
  }

  static async #onEditCategory(_event, target) {
    const category = getCategories().find(c => c.id === target.dataset.id);
    if (!category) return;
    const section = await EditorApp.#promptSection(t("UPGRADES.Dialog.EditSection"), category);
    if (!section) return;
    await upsertCategory({ id: category.id, ...section });
    EditorApp.#afterMutation();
  }

  static async #onRemoveCategory(_event, target) {
    const category = getCategories().find(c => c.id === target.dataset.id);
    if (!category) return;
    const inside = getUpgrades().filter(u => u.categoryId === category.id).length;
    const ok = await DialogV2.confirm({
      window: { title: t("UPGRADES.Dialog.DeleteSection") },
      content: `<p>${t("UPGRADES.Dialog.DeleteSectionBody", { name: `<strong>${foundry.utils.escapeHTML(category.name)}</strong>` })}</p>`
        + (inside ? `<p>${t("UPGRADES.Dialog.DeleteSectionKeeps", { count: inside })}</p>` : "")
    });
    if (!ok) return;
    await deleteCategory(category.id);
    EditorApp.#afterMutation();
  }

  static async #onMoveCategoryUp(_event, target) {
    await moveCategory(target.dataset.id, -1);
    EditorApp.#afterMutation();
  }

  static async #onMoveCategoryDown(_event, target) {
    await moveCategory(target.dataset.id, 1);
    EditorApp.#afterMutation();
  }

  /**
   * Sweep the ledger. Offered as a choice rather than a single "delete everything" because the
   * usual reason to want this is a run of currency experiments sitting among purchases that are
   * worth keeping.
   */
  static async #onClearHistory() {
    const entries = getHistory();
    // Spend lines belong to their purchases, so they count — and clear — with them.
    const purchases = entries.filter(e => e.type === "purchase" || e.type === "spend").length;
    const adjusts = entries.length - purchases;

    const result = await DialogV2.prompt({
      window: { title: t("UPGRADES.Dialog.ClearHistory") },
      content: `<p>${t("UPGRADES.Dialog.ClearHistoryBody", { currency: foundry.utils.escapeHTML(getVocabulary().currencyName) })}</p>
        <div class="form-group"><label>${t("UPGRADES.Dialog.Remove")}</label>
          <select name="kind" autofocus>
            <option value="adjust">${t("UPGRADES.Dialog.ClearAdjustments", { count: adjusts })}</option>
            <option value="purchase">${t("UPGRADES.Dialog.ClearPurchases", { count: purchases })}</option>
            <option value="all">${t("UPGRADES.Dialog.ClearEverything", { count: entries.length })}</option>
          </select></div>`,
      ok: { label: t("UPGRADES.Common.ClearAction"), callback: (_e, button) => button.form.elements.kind.value }
    }).catch(() => null);
    if (!result) return;

    const removed = await clearHistory(result);
    ui.notifications.info(removed ? t("UPGRADES.Notify.ClearedHistory", { count: removed }) : t("UPGRADES.Notify.NothingToClear"));
    EditorApp.#afterMutation();
  }

  static async #onRemoveHistoryEntry(_event, target) {
    if (!(await removeHistory(target.dataset.id))) return;
    EditorApp.#afterMutation();
  }

  static async #onEditHistoryEntry(_event, target) {
    const entry = getHistory().find(e => e.id === target.dataset.id);
    if (!entry) return;
    const reason = await DialogV2.prompt({
      window: { title: t("UPGRADES.Editor.EditReason") },
      content: `<p class="notes">${t("UPGRADES.Dialog.EditReasonNote")}</p>
        <div class="form-group"><label>${t("UPGRADES.Dialog.Reason")}</label>
          <input type="text" name="reason" value="${foundry.utils.escapeHTML(entry.reason ?? "")}"
                 placeholder="${t('UPGRADES.Dialog.ReasonEg')}" autofocus></div>`,
      ok: { label: t("UPGRADES.Common.Save"), callback: (_e, button) => button.form.elements.reason.value }
    }).catch(() => null);
    if (reason === null) return;   // cancelled; an emptied reason is a real edit
    await editHistoryReason(entry.id, reason.trim());
    EditorApp.#afterMutation();
  }

  /**
   * Name and layout for a section, in one small dialog. Layout is a per-section choice — a flat
   * shop section and a talent tree are both legitimate on the same board, which is exactly why
   * there is no global "board mode" anywhere.
   */
  static async #promptSection(title, initial = {}) {
    const chosen = initial.layout ?? "rows";
    const options = ["rows", "tree"].map(value =>
      `<option value="${value}" ${value === chosen ? "selected" : ""}>${
        t(value === "tree" ? "UPGRADES.Layout.Tree" : "UPGRADES.Layout.Rows")}</option>`).join("");
    const result = await DialogV2.prompt({
      window: { title },
      content: `<div class="form-group"><label>Name</label>
        <input type="text" name="name" value="${foundry.utils.escapeHTML(initial.name ?? "")}"
               placeholder="${t('UPGRADES.Dialog.SectionEg')}" autofocus></div>
        <div class="form-group"><label>${t("UPGRADES.Layout.Label")}</label>
        <select name="layout">${options}</select></div>
        <p class="hint">${t("UPGRADES.Layout.Hint")}</p>`,
      ok: { label: t("UPGRADES.Common.Save"), callback: (_e, button) => ({
        name: button.form.elements.name.value.trim(),
        layout: button.form.elements.layout.value
      }) }
    }).catch(() => null);   // dismissing the dialog rejects; that is a cancel, not an error
    return result?.name ? result : null;
  }

  static async #onResync() {
    const { created, refreshed } = await resyncUpgrades();
    ui.notifications.info(t("UPGRADES.Notify.Resynced", { count: created, refreshed }));
    EditorApp.#afterMutation();
  }

  static #afterMutation() {
    emit({ type: "refresh" });
    refreshOpenApps();
  }

  async _onClose(options) {
    await super._onClose(options);
    if (EditorApp.instance === this) EditorApp.instance = null;
  }
}
