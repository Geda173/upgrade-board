/**
 * Tree arrangement: drag tiles onto cells to author their position.
 *
 * Derivation gives every tree a sensible shape for free; this window is for the deliberate
 * gaps and columns of the reference. Dropping a tile on a cell writes `treeRow`/`treeCol`,
 * which win over derivation; clearing a tile hands it back. Authored tiles carry a pin so the
 * GM can always tell which tiles they placed and which the graph placed — without that, edits
 * to the prerequisites move some tiles and not others and the board feels haunted.
 *
 * The tiles are drag sources, not document drops, so this does not go through wireDropZone —
 * that helper exists for dragging *documents* in from the sidebar, and pretending a tile is
 * one would be a second kind of lie.
 */
import { getCategories, getUpgrades, treeLayout, upsertUpgrade } from "../catalog.js";
import { MODULE_ID, isImagePath } from "../settings.js";
import { emit, refreshOpenApps } from "../sockets.js";
import { UpgradesWindow, drawTreeConnectors } from "./ui.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Room beyond the current extent, so a tile can be dragged into empty space. */
const SPARE_ROWS = 2;
const SPARE_COLS = 2;
const MIN_ROWS = 3;
const MIN_COLS = 4;

export class TreeArrangeApp extends UpgradesWindow(HandlebarsApplicationMixin(ApplicationV2)) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: "upgrades-tree-arrange",
    classes: ["upgrades", "upg-arrange"],
    window: { title: "UPGRADES.Arrange.Title", icon: "fa-solid fa-sitemap", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      clearTile: TreeArrangeApp.#onClearTile,
      clearAll: TreeArrangeApp.#onClearAll
    }
  };

  static SCROLL_SELECTOR = ".upg-arrange-body";

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/tree-arrange.hbs` }
  };

  #sectionId = null;

  static show(sectionId) {
    if (!game.user.isGM) return;
    TreeArrangeApp.instance ??= new TreeArrangeApp();
    TreeArrangeApp.instance.#sectionId = sectionId;
    TreeArrangeApp.instance.render({ force: true });
    return TreeArrangeApp.instance;
  }

  get title() {
    const section = getCategories().find(c => c.id === this.#sectionId);
    return t("UPGRADES.Arrange.Title", { section: section?.name ?? "" });
  }

  async _prepareContext(_options) {
    const section = getCategories().find(c => c.id === this.#sectionId);
    const upgrades = getUpgrades().filter(u => u.categoryId === this.#sectionId);
    const layout = treeLayout(upgrades);

    let maxRow = 0;
    let maxCol = 0;
    for (const cell of layout.values()) {
      maxRow = Math.max(maxRow, cell.row);
      maxCol = Math.max(maxCol, cell.col);
    }
    const rows = Math.max(MIN_ROWS, maxRow + 1 + SPARE_ROWS);
    const cols = Math.max(MIN_COLS, maxCol + 1 + SPARE_COLS);

    const authored = value => Number.isInteger(value) && value >= 0;
    const byCell = new Map();
    for (const u of upgrades) {
      const cell = layout.get(u.id);
      byCell.set(`${cell.row}:${cell.col}`, {
        id: u.id, name: u.name, img: u.img,
        isImage: isImagePath(u.img ?? ""),
        // Placed by hand, or landed there by derivation — the pin is the difference.
        pinned: authored(u.treeRow) || authored(u.treeCol)
      });
    }

    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push({ row, col, tile: byCell.get(`${row}:${col}`) ?? null });
      }
    }

    const inSection = new Set(upgrades.map(u => u.id));
    const edges = upgrades.flatMap(u => (u.requires ?? [])
      .filter(id => inSection.has(id))
      .map(id => ({ from: id, to: u.id, lit: false, cut: false })));

    return {
      sectionName: section?.name ?? "",
      cells, cols,
      treeEdges: JSON.stringify(edges),
      hasPinned: upgrades.some(u => authored(u.treeRow) || authored(u.treeCol))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    drawTreeConnectors(this.element);

    for (const tile of this.element.querySelectorAll(".upg-arrange-tile")) {
      tile.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", JSON.stringify({ upgradeBoardTile: tile.dataset.upgradeId }));
        event.dataTransfer.effectAllowed = "move";
      });
    }
    for (const cell of this.element.querySelectorAll(".upg-arrange-cell")) {
      cell.addEventListener("dragover", event => { event.preventDefault(); cell.classList.add("hover"); });
      cell.addEventListener("dragleave", () => cell.classList.remove("hover"));
      cell.addEventListener("drop", async event => {
        event.preventDefault();
        cell.classList.remove("hover");
        let data = null;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
        const id = data?.upgradeBoardTile;
        if (!id) return;
        await upsertUpgrade({ id, treeRow: Number(cell.dataset.row), treeCol: Number(cell.dataset.col) });
        this.#afterMutation();
      });
    }
  }

  static async #onClearTile(_event, target) {
    await upsertUpgrade({ id: target.dataset.id, treeRow: null, treeCol: null });
    this.#afterMutation();
  }

  static async #onClearAll(_event, _target) {
    const upgrades = getUpgrades().filter(u => u.categoryId === this.#sectionId);
    for (const u of upgrades) {
      if (u.treeRow !== null || u.treeCol !== null) {
        await upsertUpgrade({ id: u.id, treeRow: null, treeCol: null });
      }
    }
    this.#afterMutation();
  }

  /** The shop draws from the same fields, so it re-renders alongside this window. */
  #afterMutation() {
    emit({ type: "refresh" });
    refreshOpenApps();
    this.render();
  }

  async _onClose(options) {
    await super._onClose(options);
    if (TreeArrangeApp.instance === this) TreeArrangeApp.instance = null;
  }
}
