/**
 * Player-facing shop window (ApplicationV2 + Handlebars).
 */
import { exclusiveClaim, exclusiveSiblings, getCategories, getUpgrades, groupByCategory,
         isAvailable, isUnlocked, pathDepth, sortByPath, tierShortfall, treeLayout,
         unmetRequirements } from "../catalog.js";
import { canAfford, describeCosts, getBalance, getBalances, getCurrencies, hasMultipleCurrencies } from "../economy.js";
import { MODULE_ID, getVocabulary, isImagePath } from "../settings.js";
import { requestPurchase } from "../purchase.js";
import { emit } from "../sockets.js";
import { describeTarget } from "../systems/adapter.js";
import { describeUpgradeEffect } from "../effects.js";
import { UpgradesWindow } from "./ui.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShopApp extends UpgradesWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "upgrades-shop",
    classes: ["upgrades", "upg-shop"],
    window: { title: "Upgrades", icon: "fa-solid fa-gem", resizable: true },
    position: { width: 920, height: "auto" },
    actions: {
      buy: ShopApp.#onBuy,
      deposit: ShopApp.#onDeposit,
      showToPlayers: ShopApp.#onShowToPlayers,
      openEditor: ShopApp.#onOpenEditor,
      openSettings: ShopApp.#onOpenSettings,
      selectCard: ShopApp.#onSelectCard
    }
  };

  // Selecting a card re-renders the window, and a socket refresh can arrive at any moment —
  // without this, either one throws the reader back to the top of the board.
  static SCROLL_SELECTOR = ".window-content";

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/shop.hbs` }
  };

  #selectedId = null;

  /** The GM names the window ("The Exchange"), so the title can't live in DEFAULT_OPTIONS. */
  get title() {
    return getVocabulary().windowTitle;
  }

  static show() {
    ShopApp.instance ??= new ShopApp();
    ShopApp.instance.render({ force: true });
    return ShopApp.instance;
  }

  async _prepareContext(_options) {
    const isGM = game.user.isGM;
    const balance = getBalance();
    const all = getUpgrades();
    // Everyone sees every upgrade: hidden ones appear to players as "???" teasers below.
    const visible = sortByPath(all, all);

    // Players should be able to read what an upgrade does *before* paying for it.
    // Teasers stay blank — the whole point of a "???" card is that it gives nothing away.
    const effectLines = new Map();
    await Promise.all(visible.map(async u => {
      if (u.hidden && !isGM) return;                       // teasers give nothing away
      if (u.hideEffect && !u.purchased && !isGM) return;   // deliberately kept secret until owned
      effectLines.set(u.id, await describeUpgradeEffect(u));
    }));

    const upgrades = visible
      .map(u => {
        const mystery = u.hidden && !isGM;
        // A mutually exclusive set has to announce itself *before* anyone commits, or the
        // exclusivity is only ever discovered by the player who finds their card closed.
        const claim = exclusiveClaim(u, all);
        // A "???" rival must not be named even while the choice is open, so teasers are counted
        // rather than listed — the set's size is not a secret, its contents are.
        const rivals = exclusiveSiblings(u, all);
        const namedRivals = rivals.filter(r => !(r.hidden && !isGM)).map(r => r.name);
        const secretRivals = rivals.length - namedRivals.length;
        return {
          ...u,
          mystery,
          displayName: mystery ? "???" : u.name,
          displayFlavor: mystery ? t("UPGRADES.Shop.MysteryFlavor") : u.flavor,
          displayImg: mystery ? "" : u.img,
          available: isAvailable(u),
          soldOut: !isAvailable(u),
          locked: !isUnlocked(u, all) || !!claim,
          // Named so a player can see what to buy first rather than just that they cannot buy this.
          requiresLabel: mystery ? "" : unmetRequirements(u, all).map(r => r.name).join(", "),
          // The tier gate explains itself the same way: how many talents short, not just "locked".
          tierLabel: (() => {
            const gate = mystery ? null : tierShortfall(u, all);
            return gate ? t("UPGRADES.Shop.TierGate", { count: gate.missing }) : "";
          })(),
          onPath: !mystery && pathDepth(u, all) > 0,
          excluded: !!claim,
          // The rival may itself be a "???" teaser, and a card that closes off must not be the
          // thing that names it. Players are told the choice is spent, not what spent it.
          excludedBy: (!mystery && claim)
            ? ((claim.hidden && !isGM) ? t("UPGRADES.Shop.AChoiceMade") : claim.name)
            : "",
          // Shown while the choice is still open, so the cost of taking one is visible up front.
          exclusiveLabel: (!mystery && rivals.length && !claim)
            ? [...namedRivals, ...(secretRivals ? [`${secretRivals} more`] : [])].join(", ")
            : "",
          affordable: isAvailable(u) && isUnlocked(u, all) && !claim && canAfford(u),
          // One entry per resource the upgrade is priced in; with a single resource this is
          // exactly the one icon-and-number the card always showed.
          costs: mystery ? [] : describeCosts(u).map(c => ({
            amount: c.amount,
            name: c.currency.name,
            icon: c.currency.icon,
            isImage: isImagePath(c.currency.icon ?? "")
          })),
          ownedCount: u.repeatable ? (u.purchases?.length ?? 0) : 0,
          ownedBy: (u.purchases ?? []).map(p => p.actorName).filter(Boolean).join(", "),
          selected: u.id === this.#selectedId,
          // Only worth showing when it isn't the default "everyone" case.
          targetLabel: (!mystery && u.target === "actor") ? describeTarget(u) : null,
          effectLines: mystery ? [] : (effectLines.get(u.id) ?? []),
          // A short plain-text taste of the description, so a card can be read without expanding it.
          excerpt: mystery ? "" : ShopApp.#excerpt(u.description),
          // Distinguish "kept secret" from "does nothing" — otherwise a secret upgrade
          // looks identical to a purely cosmetic one.
          effectSecret: !mystery && u.hideEffect && !u.purchased && !isGM,
          // The GM needs to see at a glance that players are not seeing this.
          effectSecretForGM: isGM && u.hideEffect && !u.purchased
        };
      });

    const selected = upgrades.find(u => u.selected && !u.mystery) ?? null;

    // Sections are only rendered as headings once the GM defines some; a world with none
    // still gets exactly the flat grid it had before. A section whose layout is "tree" gains
    // grid positions and connector edges; its cards are the same markup reshaped by CSS.
    const groups = groupByCategory(upgrades).map(group => ShopApp.#treeContext(group, all, isGM));

    return {
      isGM,
      balance,
      upgrades,
      groups,
      hasSections: groups.some(g => g.name),
      selected,
      selectedDescription: selected ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(selected.description ?? "") : null,
      vocab: getVocabulary(),
      currencies: getCurrencies().map(c => ({
        ...c,
        balance: getBalances()[c.id] ?? 0,
        isImage: isImagePath(c.icon ?? "")
      })),
      hasMultipleCurrencies: hasMultipleCurrencies(),
      ...(await ShopApp.#depositContext())
    };
  }



  /**
   * A tree section's extra geometry: a grid cell per tile, and the connector edges.
   *
   * Geometry only follows edges inside the section — a cross-section prerequisite still locks,
   * but there is no arrow into another tree, so the tooltip names it (with its section) instead.
   * Edge state is most of the WoW feel: lit when the prerequisite is owned, dim when not, cut
   * when either end has been ruled out by a spent exclusive choice.
   */
  static #treeContext(group, all, isGM) {
    if (group.layout !== "tree" || !group.upgrades.length) return group;
    const layout = treeLayout(group.upgrades);
    const inSection = new Set(group.upgrades.map(u => u.id));
    const owned = new Map(all.map(u => [u.id, !!u.purchased]));
    const excluded = new Map(group.upgrades.map(u => [u.id, !!u.excluded]));
    const sections = new Map(getCategories().map(c => [c.id, c.name]));

    const tiles = group.upgrades.map(u => {
      const cell = layout.get(u.id);
      // Unmet prerequisites, named — and located, when the arrow that would explain the lock
      // cannot be drawn because the prerequisite lives in another section.
      const requiresTip = u.mystery ? "" : unmetRequirements(u, all).map(r => {
        const named = (r.hidden && !isGM) ? "???" : r.name;
        return inSection.has(r.id) ? named
          : t("UPGRADES.Shop.InSection", { name: named, section: sections.get(r.categoryId) ?? t("UPGRADES.Shop.OtherSection") });
      }).join(", ");
      return {
        ...u,
        treeCell: `${cell.row + 1} / ${cell.col + 1}`,
        treeTooltip: ShopApp.#tileTooltip(u, requiresTip)
      };
    });

    const edges = group.upgrades.flatMap(u => (u.requires ?? [])
      .filter(id => inSection.has(id))
      .map(id => ({
        from: id, to: u.id,
        lit: owned.get(id) === true,
        cut: excluded.get(id) === true || excluded.get(u.id) === true
      })));

    return { ...group, isTree: true, treeEdges: JSON.stringify(edges), upgrades: tiles };
  }

  /**
   * The hover summary for a tree tile. A summary on purpose: the detail pane stays the place
   * for the full description and the buy button — the tooltip never grows one.
   */
  static #tileTooltip(u, requiresTip) {
    const esc = s => String(s ?? "").replace(/[&<>"']/g,
      ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const parts = [`<h4>${esc(u.displayName)}</h4>`];
    if (u.costs?.length) {
      parts.push(`<div class="upg-tip-cost">${u.costs.map(c => `${c.amount} ${esc(c.name)}`).join(", ")}</div>`);
    }
    if (u.displayFlavor) parts.push(`<em>${esc(u.displayFlavor)}</em>`);
    if (u.effectLines?.length) {
      parts.push(`<ul>${u.effectLines.map(line => `<li>${esc(line)}</li>`).join("")}</ul>`);
    }
    if (u.effectSecret) parts.push(`<div>${esc(t("UPGRADES.Shop.EffectSecret"))}</div>`);
    if (requiresTip) parts.push(`<div class="upg-tip-lock">${esc(t("UPGRADES.Shop.Requires", { name: requiresTip }))}</div>`);
    if (u.tierLabel) parts.push(`<div class="upg-tip-lock">${esc(u.tierLabel)}</div>`);
    if (u.excludedBy) parts.push(`<div class="upg-tip-lock">${esc(t("UPGRADES.Shop.RuledOutBy", { name: u.excludedBy }))}</div>`);
    return `<div class="upg-tree-tip">${parts.join("")}</div>`;
  }

  /**
   * Connectors: one SVG per tree grid, drawn from measured tile positions after every render.
   * Positions come from offsetLeft/offsetTop — grid-relative, immune to the section's own
   * horizontal scroll — and every arrival is vertical, so the arrowhead always points down.
   */
  #drawConnectors() {
    const NS = "http://www.w3.org/2000/svg";
    for (const grid of this.element?.querySelectorAll(".upg-tree-grid") ?? []) {
      grid.querySelector(".upg-tree-svg")?.remove();
      let edges = [];
      try { edges = JSON.parse(grid.dataset.treeEdges || "[]"); } catch { /* stale markup */ }
      if (!edges.length) continue;

      const svg = document.createElementNS(NS, "svg");
      svg.classList.add("upg-tree-svg");
      svg.setAttribute("width", grid.scrollWidth);
      svg.setAttribute("height", grid.scrollHeight);

      for (const edge of edges) {
        const from = grid.querySelector(`[data-upgrade-id="${CSS.escape(edge.from)}"]`);
        const to = grid.querySelector(`[data-upgrade-id="${CSS.escape(edge.to)}"]`);
        if (!from || !to) continue;
        const x1 = from.offsetLeft + from.offsetWidth / 2;
        const y1 = from.offsetTop + from.offsetHeight;
        const x2 = to.offsetLeft + to.offsetWidth / 2;
        const y2 = to.offsetTop;
        const state = edge.cut ? "cut" : edge.lit ? "lit" : "dim";

        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", x1 === x2
          ? `M${x1},${y1} L${x2},${y2}`
          : `M${x1},${y1} L${x1},${(y1 + y2) / 2} L${x2},${(y1 + y2) / 2} L${x2},${y2}`);
        path.classList.add("upg-tree-edge", state);
        svg.appendChild(path);

        const arrow = document.createElementNS(NS, "path");
        arrow.setAttribute("d", `M${x2 - 4},${y2 - 6} L${x2 + 4},${y2 - 6} L${x2},${y2} Z`);
        arrow.classList.add("upg-tree-arrow", state);
        svg.appendChild(arrow);
      }
      grid.prepend(svg);
    }
  }

  #resizeObserver = null;

  _onRender(context, options) {
    super._onRender(context, options);
    this.#drawConnectors();
    // Cell positions move when the window is resized, and the connectors are measured pixels.
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#drawConnectors());
    for (const grid of this.element?.querySelectorAll(".upg-tree-grid") ?? []) {
      this.#resizeObserver.observe(grid);
    }
  }

  /** Strip the GM's HTML down to a short line for the card face. */
  static #excerpt(html, limit = 130) {
    if (!html) return "";
    const text = String(html)
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length <= limit) return text;
    // cut on a word boundary rather than mid-word
    const cut = text.slice(0, limit);
    return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : limit) + "…";
  }

  /** What the current user could hand in right now, if anything. */
  static async #depositContext() {
    const { getCurrencyItem, countCurrencyOn } = await import("../currency.js");
    const source = await getCurrencyItem();
    const actor = game.user.character;
    if (!source || !actor) return { canDeposit: false, depositAmount: 0, depositActorId: null };
    const amount = countCurrencyOn(actor, source.name);
    return { canDeposit: amount > 0, depositAmount: amount, depositActorId: actor.id };
  }

  static async #onDeposit(_event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    if (game.user.isGM) {
      const { depositFrom } = await import("../currency.js");
      const amount = await depositFrom(game.actors.get(actorId));
      ui.notifications.info(amount ? t("UPGRADES.Notify.HandedIn", { amount }) : t("UPGRADES.Notify.NothingToHandIn"));
      emit({ type: "refresh" });
      ShopApp.instance?.render();
      return;
    }
    // World data is GM-writable only, so the actual move happens on their client.
    emit({ type: "deposit", actorId, userId: game.user.id });
  }

  static #onBuy(_event, target) {
    requestPurchase(target.dataset.upgradeId);
  }

  static #onSelectCard(_event, target) {
    const app = ShopApp.instance;
    if (!app) return;
    app.#selectedId = app.#selectedId === target.dataset.upgradeId ? null : target.dataset.upgradeId;
    app.render();
  }

  static #onShowToPlayers() {
    emit({ type: "openShop" });
    ui.notifications.info(t("UPGRADES.Notify.ShownToPlayers"));
  }

  static async #onOpenEditor() {
    const { EditorApp } = await import("./editor-app.js");
    EditorApp.show();
  }

  static async #onOpenSettings() {
    const { SettingsApp } = await import("./settings-app.js");
    SettingsApp.show();
  }

  async _onClose(options) {
    await super._onClose(options);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (ShopApp.instance === this) ShopApp.instance = null;
  }
}
