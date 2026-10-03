/**
 * One way to reach Foundry's translations.
 *
 * The catch this module exists for: every preset catalogue, theme list and settings table in this
 * codebase is a module-scope constant, and module scope is evaluated when the file is imported —
 * long before Foundry has loaded a translation file. Resolving a label at definition time would
 * bake in whatever `game.i18n` was (usually nothing) at import. So `localizeFields()` installs
 * *getters*: the constant carries keys, and the English — or German — is looked up on first read,
 * by which time `game.i18n` exists.
 *
 * Outside Foundry there is no `game` at all. `t()` then returns the key unchanged, which is what
 * lets the suites import these modules; the ones that assert on wording install a stub that reads
 * lang/en.json instead (tests/i18n-stub.mjs).
 */

/** Localize `key`, formatting `{placeholders}` from `data` when given. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data === undefined ? i18n.localize(key) : i18n.format(key, data);
}

/**
 * Replace named fields on each entry with a getter that localizes what the field holds.
 *
 * `localizeFields(list, { label: id => `UPGRADES.Preset.Dnd5e.${id}` })` derives the key from the
 * entry; `localizeFields(list, "hint")` treats the field's current value as the key itself.
 */
export function localizeFields(list, spec) {
  const fields = typeof spec === "string" ? { [spec]: null } : spec;
  return list.map(entry => {
    const out = { ...entry };
    for (const [field, deriveKey] of Object.entries(fields)) {
      const key = deriveKey ? deriveKey(entry) : entry[field];
      if (typeof key !== "string") continue;
      Object.defineProperty(out, field, { get: () => t(key), enumerable: true, configurable: true });
    }
    return out;
  });
}
