/**
 * The purchase pipeline itself, run end to end on the GM side against a settings store that
 * yields on every write the way Foundry's does.
 *
 * Four bugs, all of which left the party charged for something it should not have been:
 *
 *  - Two requests committing at once both passed the final check, because the commit awaits a
 *    settings write before the balance and the purchase record are both stored. Rivals in an
 *    exclusive set both went through; an emptied pot under-paid, clamped at zero.
 *  - An upgrade whose named actor or fixed item had been deleted still took the payment, then
 *    warned that its effect had nowhere to go.
 *  - Closing the approval window with its X sent the player nothing.
 *  - A refund after a re-price returned today's price, because the purchase did not record what
 *    it had cost.
 *
 * The structure suite pins the shape of the socket entry point by reading the source; this one
 * runs it, because a source scan once froze a bug in place (v0.24.1).
 */
import { i18n } from './i18n-stub.mjs';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- a small Foundry ---------- */
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const store = new Map();
const notes = [], sent = [], chat = [];
let answer = async () => true;            // what the GM says in the approval dialog
let idCounter = 0;

class Actor {}
const users = new Map([
  ['gm', { id: 'gm', name: 'Gamemaster', isGM: true, active: true }],
  ['p1', { id: 'p1', name: 'Pat', isGM: false, active: true, character: null }]
]);
const actors = new Map();
const listOf = map => ({
  get: id => map.get(id),
  find: f => [...map.values()].find(f),
  filter: f => [...map.values()].filter(f),
  some: f => [...map.values()].some(f)
});

let onSocket = null;
globalThis.Actor = Actor;
globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.CONFIG = {};
globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m) } };
globalThis.ChatMessage = { create: async data => chat.push(data) };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;
globalThis.foundry = {
  utils: {
    deepClone: v => structuredClone(v),
    randomID: () => `id${++idCounter}`,
    mergeObject: (a, b) => ({ ...a, ...b }),
    escapeHTML: s => String(s ?? '')
  },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: Base => class extends Base {},
      DialogV2: { confirm: options => answer(options), prompt: async () => null }
    }
  }
};
globalThis.game = {
  system: { id: 'dnd5e' },
  i18n: { ...i18n, lang: 'en' },
  user: users.get('gm'),
  users: listOf(users),
  actors: listOf(actors),
  settings: {
    get: (_m, k) => structuredClone(store.get(k)),
    // Foundry's write is a round trip to the server; nothing is stored until it comes back.
    set: async (_m, k, v) => { await tick(); store.set(k, structuredClone(v)); return v; }
  },
  socket: { on: (_c, fn) => { onSocket = fn; }, emit: (_c, msg) => sent.push(msg) }
};

const { handlePurchaseRequest } = await import(new URL('../scripts/purchase.js', import.meta.url));
const { getUpgrade } = await import(new URL('../scripts/catalog.js', import.meta.url));
const { getBalance, getCosts } = await import(new URL('../scripts/economy.js', import.meta.url));
const { initSockets } = await import(new URL('../scripts/sockets.js', import.meta.url));

const upgrade = data => ({
  name: data.id, hidden: false, purchases: [], requires: [], excludes: [],
  target: 'party', effectMode: 'none', costs: [{ currencyId: 'gold', amount: 3 }], ...data
});
const world = (upgrades, balance = 10) => {
  store.clear();
  store.set('currencies', [{ id: 'gold', name: 'Gold', icon: 'i', sort: 0 }]);
  store.set('balances', { gold: balance });
  store.set('history', []);
  store.set('upgrades', upgrades.map(upgrade));
  store.set('requireApproval', false);
  notes.length = 0; sent.length = 0; chat.length = 0;
};
const buy = (upgradeId, userId = 'gm') => handlePurchaseRequest({ upgradeId, userId });
const owned = id => getUpgrade(id).purchases.length;
// Counted separately from the purchase records: without the lock the second commit's write lands
// on top of the first's and erases it, so the records alone can look right while two chat cards
// went out and the ledger shows two charges.
const committed = () => chat.length;
const charges = () => store.get('history').filter(e => e.type === 'spend').length;

/* ---------- two requests at once ---------- */
world([{ id: 'A', excludes: ['B'] }, { id: 'B' }]);
await Promise.all([buy('A'), buy('B')]);
t('only one side of an exclusive choice commits when both land together',
  owned('A') + owned('B') === 1);
t('one commit, not two that overwrote each other', committed() === 1 && charges() === 1);
t('and the pot paid for exactly one', getBalance('gold') === 7);
t('the loser is told why', notes.some(n => /ruled out/i.test(n)));

world([{ id: 'R', repeatable: true }], 5);
await Promise.all([buy('R'), buy('R')]);
t('an emptied pot refuses the second of two simultaneous purchases', owned('R') === 1);
t('rather than clamping at zero and under-charging', getBalance('gold') === 2);
t('and only one was ever announced', committed() === 1 && charges() === 1);

world([{ id: 'R', repeatable: true }], 30);
await Promise.all([buy('R'), buy('R'), buy('R')]);
t('requests that can all be afforded all go through', owned('R') === 3 && getBalance('gold') === 21);

/* ---------- a target that is gone ---------- */
world([{ id: 'S', target: 'actor', targetActorId: 'gone', effectMode: 'build',
         effectBuild: { rows: [{ preset: 'ac', value: '1' }] } }]);
await buy('S');
t('an upgrade granting to a deleted actor is refused', owned('S') === 0);
t('and costs nothing', getBalance('gold') === 10);
t('and says so', notes.some(n => /no longer exists/.test(n)));

world([{ id: 'I', target: 'item', targetItemUuid: 'Actor.x.Item.gone', effectMode: 'build',
         effectBuild: { rows: [{ preset: 'item.magic', value: '1' }] } }]);
await buy('I');
t('so is one granting to a deleted item', owned('I') === 0 && getBalance('gold') === 10);

world([{ id: 'C', target: 'actor', targetActorId: 'gone' }]);
await buy('C');
t('a cosmetic upgrade does not care that its target is gone', owned('C') === 1);

/* ---------- the price paid travels with the purchase ---------- */
world([{ id: 'P', repeatable: true }]);
await buy('P');
t('the purchase records what it cost',
  JSON.stringify(getUpgrade('P').purchases[0].paid) === JSON.stringify([{ currencyId: 'gold', amount: 3 }]));
t('which is what getCosts said at the time', getCosts(getUpgrade('P'))[0].amount === 3);

/* ---------- the approval dialog ---------- */
world([{ id: 'X' }]);
store.set('requireApproval', true);
answer = async () => null;                 // the X button, where it resolves
await buy('X', 'p1');
t('closing the approval window declines', owned('X') === 0 && getBalance('gold') === 10);
t('and the player hears that it was declined',
  sent.some(m => m.type === 'notify' && m.userId === 'p1' && /declined/.test(m.message)));

sent.length = 0;
answer = async () => { throw new Error('Dialog was closed'); };   // where it rejects
let threw = false;
try { await buy('X', 'p1'); } catch { threw = true; }
t('a rejecting close does not escape as an error', !threw);
t('and is still a decline', sent.some(m => m.type === 'notify' && /declined/.test(m.message)));

answer = async () => true;
await buy('X', 'p1');
t('approving still buys it', owned('X') === 1);

/* ---------- the socket entry point ---------- */
initSockets();
world([{ id: 'Q' }]);
store.set('requireApproval', true);
let asked = 0;
answer = async () => { asked++; return true; };
await onSocket({ type: 'requestPurchase', upgradeId: 'Q', userId: 'gm' });
t('a socket request claiming to be from a GM is dropped', owned('Q') === 0 && asked === 0);
await onSocket({ type: 'requestPurchase', upgradeId: 'Q', userId: 'p1' });
t('a player request still reaches approval and commits', asked === 1 && owned('Q') === 1);

process.exit(bad);
