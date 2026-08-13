/**
 * Talent-tree layout derivation.
 *
 * The tree draws from computed geometry, and a wrong position fails the way everything fails
 * here — silently, as a tile sitting somewhere confusing. Four invariants:
 *
 *  - A `requires` chain lands on consecutive rows with nobody authoring anything.
 *  - Authored positions win over derivation, and two tiles authored into one cell nudge right
 *    rather than stack — a half-edited board still renders every tile somewhere.
 *  - Geometry only follows edges inside the section: a cross-section prerequisite locks, but
 *    it cannot be drawn, so for placement that tile is a root.
 *  - A cycle in `requires` clamps instead of hanging the render.
 */
import { i18n } from './i18n-stub.mjs';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.game = { system: { id: 'dnd5e' }, i18n, settings: { get: () => [] } };
globalThis.foundry = { utils: { deepClone: o => structuredClone(o), randomID: () => 'x' } };

const { treeLayout } = await import(new URL('../scripts/catalog.js', import.meta.url));

const u = (id, { requires = [], sort = 0, treeRow = null, treeCol = null } = {}) =>
  ({ id, requires, sort, treeRow, treeCol });
const at = (map, id) => map.get(id) ?? null;

/* ---------- derivation ---------- */
{
  const chain = treeLayout([u('a'), u('b', { requires: ['a'] }), u('c', { requires: ['b'] })]);
  t('a chain of three lands on rows 0, 1, 2',
    at(chain, 'a').row === 0 && at(chain, 'b').row === 1 && at(chain, 'c').row === 2);
  t('a lone chain keeps one column',
    [...chain.values()].every(p => p.col === 0));
}
{
  // A diamond: d needs both arms, so it sits below the longer one.
  const diamond = treeLayout([
    u('root'), u('left', { requires: ['root'], sort: 0 }), u('right', { requires: ['root'], sort: 1 }),
    u('mid', { requires: ['right'], sort: 2 }), u('point', { requires: ['left', 'mid'] })
  ]);
  t('a diamond puts the point below its longest arm', at(diamond, 'point').row === 3);
  t('siblings share a row in sort order',
    at(diamond, 'left').row === 1 && at(diamond, 'right').row === 1
    && at(diamond, 'left').col === 0 && at(diamond, 'right').col === 1);
}
{
  const flat = treeLayout([u('a', { sort: 2 }), u('b', { sort: 0 }), u('c', { sort: 1 })]);
  t('a section with no prerequisites lays out as a single row',
    [...flat.values()].every(p => p.row === 0));
  t('its columns follow sort order',
    at(flat, 'b').col === 0 && at(flat, 'c').col === 1 && at(flat, 'a').col === 2);
}

/* ---------- edges the geometry must not follow ---------- */
{
  // "elsewhere" is not in the section: it still locks, but there is no arrow to draw.
  const crossed = treeLayout([u('a', { requires: ['elsewhere'] }), u('b', { requires: ['a'] })]);
  t('a cross-section prerequisite does not sink the tile — it renders as a root',
    at(crossed, 'a').row === 0 && at(crossed, 'b').row === 1);
}
{
  const cycle = treeLayout([
    u('a', { requires: ['c'] }), u('b', { requires: ['a'] }), u('c', { requires: ['b'] }),
    u('sane', { requires: ['a'] })
  ]);
  t('a requires cycle clamps instead of hanging',
    ['a', 'b', 'c', 'sane'].every(id => Number.isInteger(at(cycle, id).row)));
  t('an upgrade hanging off the cycle still lands below its prerequisite',
    at(cycle, 'sane').row > at(cycle, 'a').row);
}

/* ---------- authored positions ---------- */
{
  const placed = treeLayout([
    u('a'), u('b', { requires: ['a'], treeRow: 4, treeCol: 2 }), u('c', { requires: ['b'] })
  ]);
  t('an authored cell wins over derivation',
    at(placed, 'b').row === 4 && at(placed, 'b').col === 2);
  t('derivation for the rest is untouched by the override',
    at(placed, 'a').row === 0 && at(placed, 'c').row === 2);
}
{
  const collided = treeLayout([
    u('first', { treeRow: 1, treeCol: 1, sort: 0 }),
    u('second', { treeRow: 1, treeCol: 1, sort: 1 })
  ]);
  t('two tiles authored into one cell nudge right rather than stack',
    at(collided, 'first').col === 1 && at(collided, 'second').col === 2
    && at(collided, 'first').row === 1 && at(collided, 'second').row === 1);
}
{
  const mixed = treeLayout([
    u('claimed', { treeRow: 0, treeCol: 0, sort: 5 }),
    u('derived', { sort: 0 })
  ]);
  t('an authored tile keeps its cell even against an earlier-sorted derived one',
    at(mixed, 'claimed').col === 0 && at(mixed, 'derived').col === 1);
}
{
  t('negative or fractional authored values are treated as unset',
    at(treeLayout([u('a', { treeRow: -1, treeCol: 1.5 })]), 'a').row === 0
    && at(treeLayout([u('a', { treeRow: -1, treeCol: 1.5 })]), 'a').col === 0);
}
{
  t('an empty section is an empty layout', treeLayout([]).size === 0);
}

/* ---------- the tier gate: classic-WoW row thresholds, decided 2026-08-13 ---------- */
const { tierShortfall } = await import(new URL('../scripts/catalog.js', import.meta.url));
{
  const cats = [{ id: 'tree', layout: 'tree', tierGate: 2 }, { id: 'flat', layout: 'rows', tierGate: 2 }];
  const g = (id, { requires = [], bought = 0, categoryId = 'tree', sort = 0 } = {}) =>
    ({ id, requires, sort, treeRow: null, treeCol: null, categoryId,
       purchases: Array.from({ length: bought }, (_, i) => ({ id: `p${i}` })) });

  const board = [
    g('a', { bought: 1 }), g('b', { sort: 1 }), g('c', { sort: 2 }),
    g('x', { requires: ['a'] }), g('y', { requires: ['a'], sort: 1 }),
    g('z', { requires: ['x'] })
  ];
  t('row zero is never gated', tierShortfall(board[0], board, cats) === null);
  t('a second-row talent is short until the gate is met', (() => {
    const s = tierShortfall(board.find(u => u.id === 'x'), board, cats);
    return s && s.needed === 2 && s.have === 1 && s.missing === 1;
  })());
  t('the threshold is cumulative: row two needs twice the gate', (() => {
    const s = tierShortfall(board.find(u => u.id === 'z'), board, cats);
    return s && s.needed === 4 && s.have === 1;
  })());
  t('talents anywhere above count, not just the row directly over it', (() => {
    const enough = board.map(u => ['a', 'b', 'c', 'x'].includes(u.id) ? { ...u, purchases: [{ id: 'p' }] } : u);
    return tierShortfall(enough.find(u => u.id === 'z'), enough, cats) === null;
  })());
  t('a repeatable counts once however often it was bought', (() => {
    const farmed = board.map(u => u.id === 'a' ? { ...u, purchases: [{id:'1'},{id:'2'},{id:'3'}] } : u);
    const s = tierShortfall(farmed.find(u => u.id === 'x'), farmed, cats);
    return s && s.have === 1;
  })());
  t('a rows-layout section is never gated',
    tierShortfall(g('r1', { categoryId: 'flat', requires: ['a'] }),
      [g('a', { categoryId: 'flat', bought: 1 }), g('r1', { categoryId: 'flat', requires: ['a'] })], cats) === null);
  t('gate zero means off', (() => {
    const open = [{ id: 'tree', layout: 'tree', tierGate: 0 }];
    return tierShortfall(board.find(u => u.id === 'x'), board, open) === null;
  })());
  t('an uncategorised upgrade is never gated',
    tierShortfall(g('loose', { categoryId: null }), board, cats) === null);
}

process.exit(bad);
