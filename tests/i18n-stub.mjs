/**
 * A `game.i18n` backed by the real lang/en.json, for suites that assert on wording.
 *
 * Exported rather than installed on `globalThis` as a side effect: these suites assign
 * `globalThis.game = { system: … }` in their own body, and an ES import is hoisted above that,
 * so anything this file wrote to `game` would be wiped before the first assertion ran. Spread it
 * into the stub instead — `globalThis.game = { system: {…}, i18n }`.
 *
 * Resolving against the real file rather than echoing the key is what keeps assertions like "the
 * untyped bonus says it always stacks" meaningful now the strings live outside the source.
 */
import fs from 'node:fs';

const lang = JSON.parse(fs.readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));

/** Foundry flattens nested translation objects into dotted keys; accept either shape. */
export function lookup(key) {
  if (typeof lang[key] === 'string') return lang[key];
  const nested = key.split('.').reduce((o, k) => (o ?? {})[k], lang);
  return typeof nested === 'string' ? nested : undefined;
}

/** Keys asked for that lang/en.json does not define — a suite can assert this stayed empty. */
export const missed = new Set();

const localize = key => {
  const hit = lookup(key);
  if (hit === undefined) { missed.add(key); return key; }
  return hit;
};

export const i18n = {
  localize,
  format: (key, data = {}) =>
    localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m))
};
