/**
 * The purchase record: availability, repeat buying, undoing one acquisition, and the
 * migration from the single `purchased` boolean that upgrades were authored with before.
 */
import { i18n } from './i18n-stub.mjs';

const store = new Map();
globalThis.game = {
  system: { id: 'dnd5e' },
  i18n,
  settings: {
    get: (_m, k) => store.get(k),
    set: (_m, k, v) => { store.set(k, v); return v; }
  },
  user: { name: 'GM' }
};
let idCounter = 0;
globalThis.foundry = {
  utils: {
    deepClone: v => structuredClone(v),
    randomID: () => `id${++idCounter}`,
    mergeObject: (a, b) => ({ ...a, ...b })
  }
};

// This suite spans both halves of the old data.js: what an upgrade is, and what it costs.
// Merged into one namespace so the assertions below read as they always did.
const D = {
  ...await import(new URL('../scripts/catalog.js', import.meta.url)),
  ...await import(new URL('../scripts/economy.js', import.meta.url))
};

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const reset = upgrades => { store.clear(); store.set('upgrades', upgrades); };

/* ---------- availability ---------- */
t('a fresh upgrade is available', D.isAvailable({ purchases: [] }));
t('a bought one-off is not', !D.isAvailable({ purchases: [{ id: 'p1' }] }));
t('a bought repeatable still is', D.isAvailable({ repeatable: true, purchases: [{ id: 'p1' }] }));
t('a repeatable bought many times still is',
  D.isAvailable({ repeatable: true, purchases: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));

/* ---------- migration from the old boolean ---------- */
reset([{ id: 'u1', name: 'Legacy', purchased: true, purchasedBy: 'Pat', purchasedAt: 123 }]);
let u = D.getUpgrade('u1');
t('a legacy purchased upgrade gains one purchase record', u.purchases.length === 1);
t('the legacy buyer is preserved', u.purchases[0].by === 'Pat');
t('the legacy timestamp is preserved', u.purchases[0].at === 123);
t('purchased stays true after migration', u.purchased === true);
t('a legacy unbought upgrade has no records',
  (reset([{ id: 'u2', name: 'Fresh', purchased: false }]), D.getUpgrade('u2').purchases.length === 0));
t('an unbought legacy upgrade reads as available', D.isAvailable(D.getUpgrade('u2')));

/* ---------- buying ---------- */
reset([{ id: 'u1', name: 'Draught', repeatable: true, purchases: [] }]);
const p1 = await D.addPurchase('u1', { actorId: 'a1', actorName: 'Ander', by: 'Pat' });
const p2 = await D.addPurchase('u1', { actorId: 'a2', actorName: 'Syllith', by: 'Kim' });
u = D.getUpgrade('u1');
t('each purchase is recorded', u.purchases.length === 2);
t('purchases carry distinct ids', p1.id !== p2.id);
t('a purchase remembers its actor', u.purchases[0].actorId === 'a1' && u.purchases[1].actorName === 'Syllith');
t('a purchase remembers who bought it', u.purchases[1].by === 'Kim');
t('purchaseCount is exposed for display', u.purchaseCount === 2);

/* ---------- undoing ---------- */
await D.removePurchase('u1');                       // most recent
u = D.getUpgrade('u1');
t('refunding with no id removes the most recent', u.purchases.length === 1 && u.purchases[0].id === p1.id);
await D.removePurchase('u1', p1.id);                // specific
u = D.getUpgrade('u1');
t('refunding a named purchase removes exactly it', u.purchases.length === 0);
t('purchased goes false once the last one is undone', u.purchased === false);
t('and it becomes available again', D.isAvailable(u));
t('refunding an empty upgrade is a no-op', (await D.removePurchase('u1')) === null);

reset([{ id: 'u1', name: 'One-off', purchases: [] }]);
await D.addPurchase('u1', { by: 'Pat' });
t('a party purchase records no actor', D.getUpgrade('u1').purchases[0].actorId === null);
t('a one-off becomes unavailable once bought', !D.isAvailable(D.getUpgrade('u1')));

/* ---------- upgrade paths ---------- */
const chain = [
  { id: 'A', name: 'Activate Magelight', requires: [], purchases: [] },
  { id: 'B', name: 'Connect to Lighthouse', requires: ['A'], purchases: [] },
  { id: 'C', name: 'Beacon Network', requires: ['B'], purchases: [] },
  { id: 'D', name: 'Dreamward', requires: ['A', 'B'], purchases: [] }
];
reset(chain);

t('a root upgrade is unlocked', D.isUnlocked(chain[0], chain));
t('a dependent upgrade is locked', !D.isUnlocked(chain[1], chain));
t('the unmet requirement is named', D.unmetRequirements(chain[1], chain)[0].name === 'Activate Magelight');
t('a two-step dependant is locked', !D.isUnlocked(chain[2], chain));

const bought = chain.map(u => u.id === 'A' ? { ...u, purchases: [{ id: 'p' }] } : u);
t('buying the prerequisite unlocks the next step', D.isUnlocked(bought[1], bought));
t('but not the step after that', !D.isUnlocked(bought[2], bought));
t('an upgrade needing two things reports only what is still missing',
  D.unmetRequirements(bought[3], bought).map(u => u.id).join() === 'B');

t('depth: a root is 0', D.pathDepth(chain[0], chain) === 0);
t('depth: one step in is 1', D.pathDepth(chain[1], chain) === 1);
t('depth: two steps in is 2', D.pathDepth(chain[2], chain) === 2);
t('depth uses the longest route when requirements converge', D.pathDepth(chain[3], chain) === 2);
t('prerequisites sort before the upgrades that need them',
  D.sortByPath(chain, chain).map(u => u.id).join() === 'A,B,C,D');

/* cycles must be impossible to create, not merely survived */
t('an upgrade cannot be offered itself as a prerequisite',
  !D.eligiblePrerequisites(chain[0], chain).some(u => u.id === 'A'));
t('something that already depends on this one is not offered',
  !D.eligiblePrerequisites(chain[0], chain).some(u => u.id === 'B'));
t('an unrelated upgrade is still offered',
  D.eligiblePrerequisites(chain[1], chain).some(u => u.id === 'A'));
t('dependsOn follows a chain', D.dependsOn(chain[2], 'A', chain));
t('dependsOn is false for an unrelated pair', !D.dependsOn(chain[0], 'C', chain));

/* a cycle that somehow reached the data must not hang the module */
const looped = [
  { id: 'X', requires: ['Y'], purchases: [] },
  { id: 'Y', requires: ['X'], purchases: [] }
];
t('a cycle does not hang pathDepth', typeof D.pathDepth(looped[0], looped) === 'number');
t('a cycle does not hang dependsOn', D.dependsOn(looped[0], 'X', looped) === true);
t('a cycle does not hang isUnlocked', D.isUnlocked(looped[0], looped) === false);

/* ---------- mutually exclusive upgrades ---------- */
// Authored on the upgrade itself: no registry, one side only, and closed transitively so a whole
// "choose one of these" can be written from a single upgrade.
const oaths = [
  { id: 'O1', name: 'Oath of Ash', excludes: ['O2', 'O3'], requires: [], purchases: [] },
  { id: 'O2', name: 'Oath of Salt', excludes: [], requires: [], purchases: [] },
  { id: 'O3', name: 'Oath of Bone', excludes: [], requires: [], purchases: [] },
  { id: 'F1', name: 'Fair Winds', excludes: [], requires: [], purchases: [] }
];
reset(oaths);

t('an upgrade naming nothing has no rivals', D.exclusiveSiblings(oaths[3], oaths).length === 0);
t('what an upgrade names is exclusive with it',
  D.exclusiveSiblings(oaths[0], oaths).map(u => u.id).sort().join() === 'O2,O3');
// the whole point of storing one side: the GM ticks it once, on whichever upgrade they are editing
t('the relation reads back the other way too',
  D.exclusiveSiblings(oaths[1], oaths).some(u => u.id === 'O1'));
t('and is closed transitively, so a set authored from one upgrade holds together',
  D.exclusiveSiblings(oaths[1], oaths).map(u => u.id).sort().join() === 'O1,O3');
t('a member never counts as its own rival',
  !D.exclusiveSiblings(oaths[0], oaths).some(u => u.id === 'O1'));
t('an unrelated upgrade is dragged into nothing', D.exclusiveSiblings(oaths[3], oaths).length === 0);
t('nothing is ruled out while the choice is open', oaths.every(u => !D.isExcluded(u, oaths)));

// a chain must fuse into one set: A–B and B–C means only one of the three
const chain3 = [
  { id: 'A', name: 'A', excludes: ['B'], requires: [], purchases: [] },
  { id: 'B', name: 'B', excludes: ['C'], requires: [], purchases: [] },
  { id: 'C', name: 'C', excludes: [], requires: [], purchases: [] }
];
t('a chain of links is one set, not two pairs',
  D.exclusiveSet(chain3[0], chain3).map(u => u.id).sort().join() === 'A,B,C');
t('the far end of a chain sees the near end',
  D.exclusiveSiblings(chain3[2], chain3).map(u => u.id).sort().join() === 'A,B');

// a link naming an upgrade that has since been deleted must not break the set
const dangling = [{ id: 'A', name: 'A', excludes: ['gone'], requires: [], purchases: [] }];
t('a link to a deleted upgrade is ignored rather than thrown on',
  D.exclusiveSiblings(dangling[0], dangling).length === 0);

const chosen = oaths.map(u => u.id === 'O2' ? { ...u, purchases: [{ id: 'p' }] } : u);
t('taking one rules out the rest of the set',
  D.isExcluded(chosen[0], chosen) && D.isExcluded(chosen[2], chosen));
t('the taken one is not ruled out by itself', !D.isExcluded(chosen[1], chosen));
t('the rival is named, so a card can say why', D.exclusiveClaim(chosen[0], chosen).name === 'Oath of Salt');
t('an upgrade outside the set is untouched', !D.isExcluded(chosen[3], chosen));
t('a claim does not leak to an unrelated upgrade', D.exclusiveClaim(chosen[3], chosen) === null);

// a repeatable member must not rule itself out on its second purchase
const twice = oaths.map(u => u.id === 'O2'
  ? { ...u, repeatable: true, purchases: [{ id: 'p1' }, { id: 'p2' }] } : u);
t('buying a repeatable member again does not rule itself out', !D.isExcluded(twice[1], twice));

// refunding the choice must reopen the rest, with nothing having recorded that it should
reset(oaths.map(u => u.id === 'O2' ? { ...u, purchases: [] } : u));
t('refunding the taken one reopens its rivals',
  D.getUpgrades().every(u => !D.isExcluded(u, D.getUpgrades())));

// a prerequisite you are exclusive with can never be met — taking it is what closes you off
reset(oaths);
t('an upgrade in the same exclusive set is not offered as a prerequisite',
  !D.eligiblePrerequisites(oaths[0], oaths).some(u => ['O2', 'O3'].includes(u.id)));
t('the withholding is symmetric, like the relation itself',
  !D.eligiblePrerequisites(oaths[1], oaths).some(u => u.id === 'O1'));
t('an upgrade outside the set is still offered',
  D.eligiblePrerequisites(oaths[0], oaths).some(u => u.id === 'F1'));
t('an unrelated upgrade may still require one of them',
  D.eligiblePrerequisites(oaths[3], oaths).some(u => u.id === 'O1'));

t('anything but itself may be named as exclusive',
  D.eligibleExclusions(oaths[0], oaths).map(u => u.id).sort().join() === 'F1,O2,O3');

// upgrades authored against the short-lived named-group model must not lose their pairing
reset([
  { id: 'G1', name: 'Ash', exclusiveGroupId: 'g1', excludes: [], requires: [], purchases: [] },
  { id: 'G2', name: 'Salt', exclusiveGroupId: 'g1', excludes: [], requires: [], purchases: [] },
  { id: 'G3', name: 'Loose', exclusiveGroupId: null, excludes: [], requires: [], purchases: [] }
]);
const migrated = D.getUpgrades();
t('a former group becomes direct links',
  D.exclusiveSiblings(migrated[0], migrated).map(u => u.id).join() === 'G2');
t('and an upgrade that was in no group stays free',
  D.exclusiveSiblings(migrated[2], migrated).length === 0);

/* ---------- resources ---------- */
// A world that predates multiple resources must keep working with nothing configured.
store.clear();
store.set('currencyName', 'Sprigs');
store.set('currencyIcon', 'fa-solid fa-seedling');
store.set('balance', 7);
t('a world with no resource list still gets one', D.getCurrencies().length === 1);
t('the synthesised resource takes the old name', D.getCurrencies()[0].name === 'Sprigs');
t('the old single balance becomes its balance', D.getBalance() === 7);
t('a single resource does not read as multiple', !D.hasMultipleCurrencies());

// an upgrade priced with the old bare number still resolves
t('a legacy cost migrates to the first resource',
  JSON.stringify(D.getCosts({ cost: 3 })) === JSON.stringify([{ currencyId: 'default', amount: 3 }]));
t('a costless upgrade has no price components', D.getCosts({ cost: 0 }).length === 0);
// The editor writes only `costs`. Saved as free, that list is empty, and the bare number left
// over from creation (or from before multiple resources) must not come back as the price.
t('an upgrade saved as free is free, whatever bare cost it still carries',
  D.getCosts({ costs: [], cost: 1 }).length === 0);
t('and a legacy price edited down to nothing stays nothing',
  D.canAfford({ costs: [], cost: 3 }) && D.getCosts({ costs: [], cost: 3 }).length === 0);
t('a legacy cost is affordable against the migrated balance', D.canAfford({ cost: 7 }));
t('and unaffordable above it', !D.canAfford({ cost: 8 }));

// now define two
store.set('currencies', [
  { id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 },
  { id: 'pearls', name: 'Pearls', icon: 'i', sort: 1 }
]);
store.set('balances', { sprigs: 5, pearls: 2 });
t('both resources are listed', D.getCurrencies().length === 2);
t('now it reads as multiple', D.hasMultipleCurrencies());
t('each balance is separate', D.getBalance('sprigs') === 5 && D.getBalance('pearls') === 2);
t('an unknown resource reads as zero', D.getBalance('nope') === 0);
t('getBalance with no argument uses the first resource', D.getBalance() === 5);

const dual = { costs: [{ currencyId: 'sprigs', amount: 3 }, { currencyId: 'pearls', amount: 1 }] };
t('a price in two resources is affordable when both cover it', D.canAfford(dual));
t('a price is unaffordable when only one falls short',
  !D.canAfford({ costs: [{ currencyId: 'sprigs', amount: 3 }, { currencyId: 'pearls', amount: 9 }] }));
t('zero-amount components are dropped',
  D.getCosts({ costs: [{ currencyId: 'sprigs', amount: 0 }, { currencyId: 'pearls', amount: 2 }] }).length === 1);
t('describeCosts pairs each amount with its resource',
  D.describeCosts(dual).map(c => c.currency.name).join() === 'Sprigs,Pearls');
t('a component naming a deleted resource is dropped from display',
  D.describeCosts({ costs: [{ currencyId: 'gone', amount: 1 }] }).length === 0);

await D.adjustBalance('pearls', -1, 'test');
t('adjusting one resource leaves the others alone',
  D.getBalance('pearls') === 1 && D.getBalance('sprigs') === 5);
await D.adjustBalance('pearls', -99, 'test');
t('a balance cannot go negative', D.getBalance('pearls') === 0);
await D.adjustBalance(3, 'legacy call');
t('the old two-argument adjustBalance still targets the first resource', D.getBalance('sprigs') === 8);

/* ---------- the ledger is editable, and is only a record ---------- */
// A world's worth of trial-and-error adjustments has to be sweepable without a balance moving.
store.clear();
store.set('currencies', [{ id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 }]);
store.set('balances', { sprigs: 10 });
await D.adjustBalance('sprigs', 5, 'first trial');
await D.adjustBalance('sprigs', -2, 'second trial');
await D.addHistory({ type: 'purchase', name: 'Nightbloom', price: '3 Sprigs', by: 'Pat' });

let log = D.getHistory();
t('every line carries an id to address it by', log.every(e => !!e.id));
t('ids are distinct', new Set(log.map(e => e.id)).size === log.length);

const balanceBefore = D.getBalance('sprigs');
await D.removeHistory(log[0].id);
t('a line can be removed', D.getHistory().length === log.length - 1);
t('removing one leaves the others', D.getHistory().some(e => e.reason === 'second trial'));
t('and moves no balance — the ledger is a record, not the source of truth',
  D.getBalance('sprigs') === balanceBefore);
t('removing an unknown line is a no-op', (await D.removeHistory('nope')) === null);

await D.editHistoryReason(D.getHistory().find(e => e.reason === 'second trial').id, 'Cleared the grove');
t('a reason can be reworded', D.getHistory().some(e => e.reason === 'Cleared the grove'));
t('rewording changes nothing else',
  D.getHistory().find(e => e.reason === 'Cleared the grove').delta === -2);
t('rewording an unknown line is a no-op', (await D.editHistoryReason('nope', 'x')) === null);

// the usual reason to want this is currency experiments sitting among purchases worth keeping
t('adjustments can be swept without touching purchases',
  (await D.clearHistory('adjust'), D.getHistory().every(e => e.type === 'purchase')));
t('the purchase record survives it', D.getHistory().length === 1);
t('and the balance is still untouched', D.getBalance('sprigs') === balanceBefore);
t('clearing reports how many lines went',
  (await D.addHistory({ type: 'adjust', delta: 1 }), await D.clearHistory('all')) === 2);
t('everything is gone', D.getHistory().length === 0);
t('clearing an empty ledger removes nothing', (await D.clearHistory('all')) === 0);

// lines written before the ledger could be edited carry no id; they must still be addressable
store.set('history', [{ ts: 1, type: 'adjust', delta: 3, reason: 'ancient' },
                      { ts: 2, type: 'adjust', delta: 4, reason: 'also ancient' }]);
const legacy = D.getHistory();
t('an id stands in for a line that never had one', legacy.every(e => !!e.id));
await D.removeHistory(legacy[1].id);
t('an id-less line can still be removed', D.getHistory().length === 1);
t('and exactly the right one went', D.getHistory()[0].reason === 'ancient');
t('the write stamps a real id, so position can never be mistaken for one',
  !String(D.getHistory()[0].id).startsWith('pos-'));

/* ---------- spend lines travel with their purchase ---------- */
// A purchase's own deductions are typed "spend": sweeping the GM's manual adjustments must
// leave them standing next to their purchase, and sweeping purchases must take them along.
store.clear();
store.set('currencies', [{ id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 }]);
store.set('balances', { sprigs: 10 });
await D.adjustBalance('sprigs', 2, 'a trial', { type: 'adjust' });
await D.adjustBalance('sprigs', -3, 'Acquired: Nightbloom', { type: 'spend' });
await D.addHistory({ type: 'purchase', name: 'Nightbloom', price: '3 Sprigs', by: 'Pat' });
t('a purchase deduction is recorded as a spend line',
  D.getHistory().some(e => e.type === 'spend' && e.delta === -3));
t('adjustBalance still defaults to a plain adjustment',
  D.getHistory().some(e => e.type === 'adjust' && e.delta === 2));
await D.clearHistory('adjust');
t('an adjustment sweep leaves spend lines with their purchase',
  D.getHistory().map(e => e.type).sort().join() === 'purchase,spend');
await D.clearHistory('purchase');
t('a purchase sweep takes the spend lines too', D.getHistory().length === 0);

/* ---------- deleting things leaves no debris ---------- */
// Removing a resource discards its balance key along with it.
store.clear();
store.set('currencies', [
  { id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 },
  { id: 'pearls', name: 'Pearls', icon: 'i', sort: 1 }
]);
store.set('balances', { sprigs: 5, pearls: 2 });
store.set('upgrades', []);
await D.deleteCurrency('pearls');
t('deleting a resource removes its currency', D.getCurrencies().length === 1);
t('and discards its balance key rather than stranding it',
  !('pearls' in store.get('balances')));
t('the surviving balance is untouched', D.getBalance('sprigs') === 5);

// A bare legacy cost means "in the first resource". Deleting that resource must not hand the
// price to whichever one moves up to first; deleting another must not lose it.
store.set('currencies', [
  { id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 },
  { id: 'pearls', name: 'Pearls', icon: 'i', sort: 1 }
]);
store.set('balances', { sprigs: 5, pearls: 2 });
store.set('upgrades', [{ id: 'L', name: 'Legacy', cost: 3, purchases: [] }]);
await D.deleteCurrency('pearls');
t('deleting another resource keeps a legacy price where it was',
  JSON.stringify(D.getCosts(D.getUpgrade('L'))) === JSON.stringify([{ currencyId: 'sprigs', amount: 3 }]));
store.set('currencies', [
  { id: 'sprigs', name: 'Sprigs', icon: 'i', sort: 0 },
  { id: 'pearls', name: 'Pearls', icon: 'i', sort: 1 }
]);
store.set('upgrades', [{ id: 'L', name: 'Legacy', cost: 3, purchases: [] }]);
await D.deleteCurrency('sprigs');
t('deleting the first resource does not re-price a legacy upgrade in the next one',
  D.getCosts(D.getUpgrade('L')).length === 0);

// Deleting an upgrade strips it out of the relations that named it.
reset([
  { id: 'A', name: 'A', requires: [], excludes: ['B'], purchases: [] },
  { id: 'B', name: 'B', requires: ['A'], excludes: [], purchases: [] },
  { id: 'C', name: 'C', requires: ['A'], excludes: ['A'], purchases: [] }
]);
await D.deleteUpgrade('A');
t('deleting an upgrade removes it', D.getUpgrades().length === 2);
t('and strips it from every requires list',
  D.getUpgrades().every(u => !(u.requires ?? []).includes('A')));
t('and from every excludes list',
  D.getUpgrades().every(u => !(u.excludes ?? []).includes('A')));

/* ---------- sections ---------- */
store.set('categories', [
  { id: 'c2', name: 'Runes', sort: 1 },
  { id: 'c1', name: 'Lighthouse', sort: 0 }
]);
t('sections come back in sort order', D.getCategories().map(c => c.name).join() === 'Lighthouse,Runes');

const grouped = D.groupByCategory([
  { id: 'a', categoryId: 'c1' }, { id: 'b', categoryId: 'c2' }, { id: 'c', categoryId: null }
]);
t('upgrades land in their section', grouped[0].name === 'Lighthouse' && grouped[0].upgrades.length === 1);
t('uncategorised upgrades go last, under Other',
  grouped[grouped.length - 1].name === 'Other' && grouped[grouped.length - 1].upgrades.length === 1);
t('an upgrade pointing at a deleted section is not lost',
  D.groupByCategory([{ id: 'x', categoryId: 'gone' }]).some(g => g.upgrades.length === 1));
store.set('categories', []);
t('with no sections defined there are no headings',
  D.groupByCategory([{ id: 'a' }])[0].name === null);

process.exit(bad);
