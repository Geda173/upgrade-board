/**
 * Re-sync, and specifically the half of it that did not exist until v0.25.3.
 *
 * A grant is a snapshot: the payload is built when the upgrade is bought, so correcting a preset
 * in a later release never reaches anything already on a sheet. "All saving throws" gained the
 * death-save path in v0.25.1 and every character who already owned it kept the version that
 * silently skipped death saves. The GM had no signal, and the one button named for this job only
 * ever filled in *missing* grants — a stale one looks present, so it was skipped.
 *
 * These are the comparison rules. What must NOT trigger a rebuild matters as much as what must:
 * this deletes and recreates documents on live characters, so a false positive is not free.
 */
import { i18n } from './i18n-stub.mjs';

globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 } };
globalThis.game = { system: { id: 'dnd5e' }, i18n, actors: [], settings: { get: () => '' } };
globalThis.CONFIG = {};
globalThis.foundry = { utils: { deepClone: o => structuredClone(o) } };

const { grantSignature } = await import(new URL('../scripts/systems/adapter.js', import.meta.url));

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const ch = (key, mode, value) => ({ key, mode, value });

/* ---------- the exact case this was built for ---------- */
// What "All saving throws" built before v0.25.1, and what it builds now.
const oldSaveAll = { changes: [ch('system.bonuses.abilities.save', 2, '+1')] };
const newSaveAll = { changes: [
  ch('system.bonuses.abilities.save', 2, '+1'),
  ch('system.attributes.death.bonuses.save', 2, '+1')
] };
t('a grant missing a path added by a later release reads as drifted',
  grantSignature(oldSaveAll) !== grantSignature(newSaveAll));
t('and the same grant compares equal to itself',
  grantSignature(newSaveAll) === grantSignature(newSaveAll));

/* ---------- what must NOT count as drift ----------
 * Every one of these would rebuild documents on a live character for no reason. */
t('a renamed grant is not drift',
  grantSignature({ name: 'Old', changes: [ch('a', 2, '+1')] })
  === grantSignature({ name: 'New', changes: [ch('a', 2, '+1')] }));
t('new artwork is not drift',
  grantSignature({ img: 'a.webp', changes: [ch('a', 2, '+1')] })
  === grantSignature({ img: 'b.webp', changes: [ch('a', 2, '+1')] }));
t('a rewritten description is not drift',
  grantSignature({ description: 'x', changes: [ch('a', 2, '+1')] })
  === grantSignature({ description: 'y', changes: [ch('a', 2, '+1')] }));
t('flags are not drift',
  grantSignature({ flags: { 'upgrade-board': { upgradeId: 'x' } }, changes: [ch('a', 2, '+1')] })
  === grantSignature({ changes: [ch('a', 2, '+1')] }));
// A live document stores the mode as a number and the value as a string; a freshly built payload
// may carry either. Normalising both sides is the difference between "compare" and "rebuild
// everything, every time, forever".
t('a numeric string mode is not drift',
  grantSignature({ changes: [ch('a', '2', '+1')] }) === grantSignature({ changes: [ch('a', 2, '+1')] }));
t('a numeric value is not drift',
  grantSignature({ changes: [ch('a', 2, 1)] }) === grantSignature({ changes: [ch('a', 2, '1')] }));

/* ---------- what must count as drift ---------- */
t('a changed path is drift',
  grantSignature({ changes: [ch('a', 2, '+1')] }) !== grantSignature({ changes: [ch('b', 2, '+1')] }));
t('a changed amount is drift',
  grantSignature({ changes: [ch('a', 2, '+1')] }) !== grantSignature({ changes: [ch('a', 2, '+2')] }));
t('a changed mode is drift',
  grantSignature({ changes: [ch('a', 2, '+1')] }) !== grantSignature({ changes: [ch('a', 5, '+1')] }));
t('a dropped row is drift',
  grantSignature({ changes: [ch('a', 2, '+1'), ch('b', 2, '+1')] })
  !== grantSignature({ changes: [ch('a', 2, '+1')] }));

/* ---------- the shapes a grant actually takes on a sheet ----------
 * dnd5e hides the real changes on an effect embedded in a wrapper feat, so a signature that only
 * looked at the top-level document would call every wrapped grant identical to every other. */
const wrapper = { type: 'feat', effects: { contents: [{ changes: [ch('system.bonuses.abilities.save', 2, '+1')] }] } };
t('a wrapper feat is unwrapped to its embedded effect',
  grantSignature(wrapper) === grantSignature(oldSaveAll));
t('a wrapper feat is compared against the payload it was built from',
  grantSignature(wrapper) !== grantSignature(newSaveAll));
// Some collections come back as a plain array rather than an EmbeddedCollection.
t('an effects array is unwrapped the same way',
  grantSignature({ effects: [{ changes: [ch('a', 2, '+1')] }] })
  === grantSignature({ changes: [ch('a', 2, '+1')] }));

/* ---------- PF2e grants carry rule elements, not changes ---------- */
const rules = r => ({ type: 'feat', system: { rules: r } });
t('rule elements are compared',
  grantSignature(rules([{ key: 'FlatModifier', selector: ['ac'], value: 1 }]))
  === grantSignature(rules([{ key: 'FlatModifier', selector: ['ac'], value: 1 }])));
t('a changed rule element is drift',
  grantSignature(rules([{ key: 'FlatModifier', selector: ['ac'], value: 1 }]))
  !== grantSignature(rules([{ key: 'FlatModifier', selector: ['ac'], value: 2 }])));
t('a rule element gained in a later release is drift',
  grantSignature(rules([{ key: 'Resistance', type: ['cold'], value: 5 }]))
  !== grantSignature(rules([{ key: 'Resistance', type: ['cold'], value: 5 }, { key: 'Immunity', type: ['fire'] }])));

/* ---------- nothing to compare ----------
 * A null signature means "cannot tell", and resyncUpgrades treats that as leave-it-alone. */
t('a document with neither changes nor rules has no signature', grantSignature({ name: 'x' }) === null);
t('a missing document has no signature', grantSignature(null) === null);
t('an empty change list is still a signature, not nothing',
  grantSignature({ changes: [] }) === JSON.stringify([]));

/* ---------- the caller reports both numbers ---------- */
const fs = await import('node:fs');
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const adapter = read('scripts/systems/adapter.js');
t('resync returns both counts', /return \{ created, refreshed \}/.test(adapter));
// Linked payloads are clones of documents the GM owns and may have edited on purpose. Rebuilding
// those is a revert, not a re-sync.
t('only built payloads are compared', /=== EFFECT_MODE\.BUILD/.test(adapter));
t('a failed refresh is caught, so a sheet is never left with nothing',
  /catch \(err\) \{[\s\S]*?Could not refresh/.test(adapter));
const editor = read('scripts/apps/editor-app.js');
t('the editor surfaces the refreshed count', /refreshed \} = await resyncUpgrades/.test(editor));
t('and passes it to the notification', /Notify\.Resynced", \{ count: created, refreshed \}/.test(editor));

process.exit(bad);
