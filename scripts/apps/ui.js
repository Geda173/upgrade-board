/**
 * Shared window behaviour.
 *
 * Theming: every window carries `upg-theme-<id>` on its root element, and the stylesheet
 * defines each theme purely as a set of custom-property values. Structural CSS is shared,
 * so adding a theme means adding one colour block — never a second copy of the layout.
 *
 * Fitting: our default sizes assume a roomy screen. On a laptop they can put the footer —
 * and therefore the Save button — below the bottom of the display.
 */
import { THEMES, getTheme } from "../settings.js";
import { t } from "../i18n.js";

const THEME_CLASSES = THEMES.map(t => `upg-theme-${t.id}`);

/** Call from an ApplicationV2's _onRender. */
export function applyTheme(app) {
  const root = app.element;
  if (!root) return;
  root.classList.remove(...THEME_CLASSES);
  root.classList.add(`upg-theme-${getTheme()}`);
}

/**
 * Shrink a window to fit the current viewport, once, on first render.
 * Only ever shrinks: a GM who resizes a window larger is not overruled on later renders.
 */
export function fitToViewport(app, margin = 60) {
  const maxWidth = Math.max(320, window.innerWidth - margin);
  const maxHeight = Math.max(320, window.innerHeight - margin);
  const { width, height } = app.position ?? {};
  const next = {};
  if (typeof width === "number" && width > maxWidth) next.width = maxWidth;
  if (typeof height === "number" && height > maxHeight) next.height = maxHeight;
  if (Object.keys(next).length) app.setPosition(next);
}

/**
 * Remember where the user was before a re-render, and put them back afterwards.
 *
 * These windows rebuild themselves whenever a choice reshapes the form, which otherwise throws
 * the scroll position back to the top and drops focus — unusable once the form is longer than
 * the window. Foundry does not restore either for us.
 */
export function captureViewState(app, scrollSelector) {
  const scroller = app.element?.querySelector(scrollSelector);
  const active = document.activeElement;
  const inApp = active && app.element?.contains(active);
  return {
    scrollTop: scroller?.scrollTop ?? 0,
    name: inApp ? (active.name || null) : null,
    row: inApp ? (active.closest?.(".upg-row")?.dataset?.index ?? null) : null,
    caret: inApp && typeof active.selectionStart === "number" ? active.selectionStart : null
  };
}

export function restoreViewState(app, scrollSelector, state) {
  if (!state || !app.element) return;
  const scroller = app.element.querySelector(scrollSelector);
  if (scroller) scroller.scrollTop = state.scrollTop;
  if (!state.name) return;

  const scope = state.row !== null && state.row !== undefined
    ? app.element.querySelector(`.upg-row[data-index="${state.row}"]`) ?? app.element
    : app.element;
  const field = scope.querySelector(`[name="${state.name}"]`);
  if (!field) return;

  // `preventScroll` is load-bearing. A bare focus() scrolls the element into view inside every
  // scrollable ancestor, which silently overrode the scrollTop restored two lines above. Because
  // the browser only ever scrolls *towards* the focused element and these forms re-render on
  // every dropdown change, the body ratcheted downwards a little on each one and never came
  // back — the form appeared to scroll down but never up.
  field.focus({ preventScroll: true });
  // Restore again afterwards: focus can still move the scroller on engines that ignore the hint.
  if (scroller) scroller.scrollTop = state.scrollTop;

  // Putting the caret back matters most in the value fields, where a re-render lands mid-typing.
  if (state.caret !== null && typeof field.setSelectionRange === "function") {
    try { field.setSelectionRange(state.caret, state.caret); } catch { /* not a text field */ }
  }
}

/**
 * Drag-and-drop onto a zone, done once.
 *
 * Three copies of this existed — the effect link, the setup window's two slots, and the buyer
 * prompt — each re-deriving the drag payload and its own idea of what counts as a valid drop.
 *
 * @param {HTMLElement} el         the zone, usually carrying `data-drop`
 * @param {string[]}    accept     document names to accept, e.g. ["Item"]; empty accepts any
 * @param {Function}    onDrop     called with (doc, uuid) once a valid document is resolved
 */
export function wireDropZone(el, { accept = [], onDrop } = {}) {
  if (!el || typeof onDrop !== "function") return;

  el.addEventListener("dragover", event => { event.preventDefault(); el.classList.add("hover"); });
  el.addEventListener("dragleave", () => el.classList.remove("hover"));
  el.addEventListener("drop", async event => {
    event.preventDefault();
    el.classList.remove("hover");

    let data = null;
    try {
      data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch {
      // Some drag sources only put plain JSON on the clipboard.
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
    }

    const doc = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (!doc) return ui.notifications.warn(t("UPGRADES.Notify.EmptyDrop"));
    if (accept.length && !accept.includes(doc.documentName)) {
      const wanted = accept.map(a => t(`UPGRADES.DropKind.${a}`)).join(t("UPGRADES.DropKind.Or"));
      return ui.notifications.warn(t("UPGRADES.Notify.WrongDrop", { wanted, got: doc.documentName }));
    }
    await onDrop(doc, data.uuid);
  });
}

/**
 * Talent-tree connectors: one SVG per `.upg-tree-grid` under `root`, drawn from measured tile
 * positions after render. Shared between the shop and the arrangement window so the two can
 * never drift — the same reason the card markup refuses to fork. Positions come from
 * offsetLeft/offsetTop (grid-relative, immune to the section's own horizontal scroll), and
 * every arrival is vertical, so the arrowhead always points down. Edge state rides in the
 * grid's `data-tree-edges` JSON: lit when the prerequisite is owned, dim when not, cut when a
 * spent exclusive choice closed either end.
 */
export function drawTreeConnectors(root) {
  const NS = "http://www.w3.org/2000/svg";
  for (const grid of root?.querySelectorAll(".upg-tree-grid") ?? []) {
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

/**
 * Everything every window in this module wants: the current theme, a size that fits the screen,
 * and a scroll position that survives the re-render triggered by changing a field.
 *
 * Set `static SCROLL_SELECTOR` on a subclass to name its scrolling element; windows that do not
 * re-render themselves can leave it null.
 */
export function UpgradesWindow(Base) {
  return class extends Base {
    static SCROLL_SELECTOR = null;

    async _preRender(context, options) {
      await super._preRender(context, options);
      const selector = this.constructor.SCROLL_SELECTOR;
      if (selector) this.viewState = captureViewState(this, selector);
    }

    _onFirstRender(context, options) {
      super._onFirstRender(context, options);
      fitToViewport(this);
    }

    _onRender(context, options) {
      super._onRender(context, options);
      applyTheme(this);
      const selector = this.constructor.SCROLL_SELECTOR;
      if (selector) restoreViewState(this, selector, this.viewState);
    }
  };
}
