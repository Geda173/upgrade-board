/**
 * The README makes factual claims about the module. Documentation drifts silently — it was three
 * releases out of date before anyone noticed — so the checkable claims are checked.
 */
import fs from 'node:fs';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const readme = read('README.md');
const data = read('scripts/settings.js');
const effects = read('scripts/effects.js');
const main = read('scripts/main.js');
const module_ = JSON.parse(read('module.json'));

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* every theme in the registry is listed, and none are invented */
const themes = [...data.matchAll(/\{ id: "(\w+)",\s+group: "([\w-]+)"/g)].map(m => m[1]);
t('the registry has themes to document', themes.length > 0);
t(`README says how many themes there are (${themes.length})`,
  new RegExp(`\\b(${themes.length}|sixteen|Sixteen)\\b`).test(readme));
for (const id of themes) {
  const label = id === 'goldenhall' ? 'Golden Hall' : id[0].toUpperCase() + id.slice(1);
  t(`  README lists the ${label} theme`, readme.includes(label));
}

/* the documented API is the API that exists */
for (const method of ['openShop', 'openEditor', 'openSettings']) {
  t(`api.${method} is documented and implemented`,
    readme.includes(method) && main.includes(`${method}:`));
}

/* system claims */
t('README claims PF2e support and the code has a PF2e catalogue',
  /PF2e/.test(readme) && effects.includes('PRESETS_PF2E'));
t('README claims dnd5e support and the code has a dnd5e catalogue',
  /dnd5e/.test(readme) && effects.includes('PRESETS_DND5E'));
t('README names the two PF2e rule elements actually produced',
  readme.includes('FlatModifier') && readme.includes('DamageDice')
  && effects.includes('"FlatModifier"') && effects.includes('"DamageDice"'));

/* install instructions */
t('the documented manifest URL is the one in module.json',
  readme.includes(module_.manifest));
t('README warns that the module is not in the package registry',
  /not in Foundry's package registry|not in the package registry/.test(readme));

/* retired features must not linger in the docs */
t('the retired world-wide "Grant upgrades as" setting is gone from the README',
  !/Grant upgrades as/.test(readme));
t('the roadmap does not promise things already shipped',
  !/categories\/tiers with prerequisites|PF2e rule-element support|per-character purchasing/.test(readme));

/* the setup checklist leads with the setting that causes real damage when skipped */
t('README leads the setup checklist with the party actor',
  readme.indexOf('Party actor') < readme.indexOf('Vocabulary'));

/* the manifest in the repo agrees with itself — the release rewrites both, but a reader does not */
t(`module.json's download points at its own version (v${module_.version})`,
  module_.download?.endsWith(`/releases/download/v${module_.version}/upgrade-board.zip`));

/* the installed readme embeds the screenshots, so the release zip has to carry them */
const embedded = [...readme.matchAll(/\]\((media\/[^)]+)\)/g)].map(m => m[1]);
const release = read('.github/workflows/release.yml');
t('the release zip keeps the media the README embeds',
  !embedded.length || !/-x\s+"media/.test(release));
t('every image the README embeds exists', embedded.every(rel => fs.existsSync(new URL(`../${rel}`, import.meta.url))));
t('the published manifest keeps its accents rather than escaping them',
  /ensure_ascii=False/.test(release));
t('README no longer points at a file the repo does not ship', !/`CLAUDE\.md`/.test(readme));

process.exit(bad);
