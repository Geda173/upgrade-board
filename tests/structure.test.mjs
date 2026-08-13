/**
 * Structural invariants that are easy to break with an innocent edit and produce
 * no error when broken — an unreachable Save button, an unbound preview, a window
 * that grows off the bottom of the screen.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/* ---------- every script parses as an ES module ---------- */
const scripts = [
  'scripts/settings.js', 'scripts/economy.js', 'scripts/catalog.js', 'scripts/effects.js', 'scripts/main.js', 'scripts/purchase.js',
  'scripts/sockets.js', 'scripts/systems/adapter.js',
  'scripts/apps/shop-app.js', 'scripts/apps/editor-app.js', 'scripts/apps/upgrade-editor.js',
  'scripts/apps/settings-app.js', 'scripts/apps/ui.js', 'scripts/apps/choice-dialog.js'
];
for (const rel of scripts) {
  const path = new URL(`../${rel}`, import.meta.url).pathname;
  let ok = true;
  try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); }
  catch { ok = false; }
  t(`${rel} parses`, ok);
}

/* ---------- CSS is well-formed ---------- */
const css = read('styles/shop.css');
const opens = (css.match(/{/g) || []).length, closes = (css.match(/}/g) || []).length;
t(`stylesheet braces balanced (${opens} rules)`, opens === closes);

/* ---------- forms scroll, footers stay reachable ---------- */
for (const [file, body] of [['templates/upgrade-editor.hbs', 'upg-form-body'],
                            ['templates/settings.hbs', 'upg-settings-panes']]) {
  const s = read(file);
  const bodyAt = s.indexOf(`class="${body}"`);
  const footAt = s.indexOf('class="upg-form-footer"');
  t(`${file}: has a scroll container`, bodyAt >= 0);
  t(`${file}: footer sits after it`, footAt > bodyAt);
  const between = s.slice(bodyAt, footAt);
  t(`${file}: container closes before the footer`,
    (between.match(/<\/div>/g) || []).length >= (between.match(/<div/g) || []).length);
}
t('scroll container actually scrolls', /\.upg-form-body \{[^}]*overflow-y: auto/.test(css));
t('footer is pinned', /\.upg-form-footer \{[^}]*flex: none/.test(css));
t('footer is opaque so content cannot show through',
  /\.upg-form-footer \{[^}]*background: var\(--upg-bg-panel\)/.test(css));
for (const cls of ['upg-upgrade-editor', 'upg-settings-app', 'upg-editor', 'upg-shop']) {
  t(`${cls} is capped to the viewport`,
    new RegExp(`\\.${cls} \\.window-content \\{[^}]*max-height: calc\\(100vh`).test(css));
}
// Theme, viewport fitting and scroll preservation are guaranteed by one mixin rather than
// repeated per app, so the assertion is that every window goes through it.
const ui = read('scripts/apps/ui.js');
t('the shared window mixin applies the theme', /applyTheme\(this\)/.test(ui));
t('the shared window mixin shrinks to the viewport', /fitToViewport\(this\)/.test(ui));
t('the shared window mixin restores scroll and focus', /restoreViewState\(this, selector/.test(ui));
for (const app of ['shop-app', 'editor-app', 'settings-app', 'upgrade-editor']) {
  t(`${app} is built on the shared window mixin`,
    /extends UpgradesWindow\(/.test(read(`scripts/apps/${app}.js`)));
}
// A window that re-renders itself must name its scrolling element, or the mixin has nothing to
// restore. That is all four: the shop re-renders on card select and on every socket refresh, and
// the GM console after every mutation — both used to snap back to the top.
for (const app of ['shop-app', 'editor-app', 'settings-app', 'upgrade-editor']) {
  t(`${app} declares which element scrolls`,
    /static SCROLL_SELECTOR = "\.[\w-]+"/.test(read(`scripts/apps/${app}.js`)));
}

/* ---------- cards align across a row ---------- */
t('cards are flex columns so their content can be distributed',
  /\.upg-card \{[^}]*flex-direction: column/.test(css));
t('the card body flexes to fill the card',
  /\.upg-card \.upg-body \{[^}]*flex: 1/.test(css));
t('the cost row is pushed to the bottom, so buttons line up across a row',
  /\.upg-cost \{[^}]*margin-top: auto/.test(css));
t('card art keeps its height when a neighbour is taller',
  /\.upg-card \.upg-art \{[^}]*flex: none/.test(css));
t('the description excerpt is clamped so one card cannot run away',
  /\.upg-excerpt \{[^}]*-webkit-line-clamp: 3/.test(css));

/* ---------- the setup window's live preview stays wired ---------- */
const settingsHbs = read('templates/settings.hbs');
const settingsJs = read('scripts/apps/settings-app.js');
const inTpl = new Set([...settingsHbs.matchAll(/data-bind="([^"]+)"/g)].map(m => m[1]));
const inJs = new Set([
  ...[...settingsJs.matchAll(/setText\("([\w-]+)"/g)].map(m => m[1]),
  ...[...settingsJs.matchAll(/\[data-bind="([\w-]+)"\]/g)].map(m => m[1])
]);
t('preview patches at least six bindings', inJs.size >= 6);
for (const b of [...inJs].sort()) t(`  template defines [data-bind="${b}"]`, inTpl.has(b));
for (const b of [...inTpl].sort()) t(`  JS patches [data-bind="${b}"]`, inJs.has(b));

const actions = new Set([...settingsHbs.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
const registered = new Set([...settingsJs.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]));
for (const a of [...actions].sort()) t(`  setup action "${a}" is registered`, registered.has(a));
t('preview can show a theme the surrounding window is not using',
  /class="upgrades upg-theme-\{\{draft\.theme\}\} upg-preview"/.test(settingsHbs));

/* ---------- upgrade paths ---------- */
t('a locked upgrade is refused at the socket entry point, not just in the UI',
  /unmetRequirements\(upgrade\)/.test(read('scripts/purchase.js')));
t('a tier-gated upgrade is refused at the socket entry point, not just in the UI',
  /tierShortfall\(upgrade\)/.test(read('scripts/purchase.js')));
t('a nominated item is re-validated on the committing client, not trusted from the buyer',
  /Refuse\.NoItemChosen/.test(read('scripts/purchase.js')));

/* ---------- the checks cannot go stale inside a dialog ---------- */
// The approval and buyer dialogs can sit open while other purchases commit; whatever was true
// when they opened proves nothing about the moment the commit runs. v0.20.0's fix: the request
// is validated once on arrival and again — against a re-read upgrade — right before committing.
{
  const purchaseJs = read('scripts/purchase.js');
  t('the request is validated when it arrives',
    /const refused = refusalReason\(upgrade\);/.test(purchaseJs));
  t('and validated again immediately before the commit',
    /const stale = refusalReason\(upgrade\);[\s\S]{0,80}commitPurchase/.test(purchaseJs));
  t('the second pass re-reads the upgrade rather than trusting the stale one',
    /upgrade = getUpgrade\(upgradeId\);\s*\n\s*const stale/.test(purchaseJs));
  t('a request with no GM connected is refused up front, not silently dropped',
    /anyGMOnline\(\)/.test(purchaseJs));
}
t('locked cards are visually distinct', /\.upg-card\.locked \{/.test(css));
t('cards on a path carry a rail', /\.upg-card\.on-path \{[^}]*border-left/.test(css));

/* ---------- mutually exclusive choices ---------- */
// The rival that closed a card off may be bought on another client between render and click,
// so the decision belongs on the client that commits, not in whatever the shop last drew.
t('a ruled-out upgrade is refused at the socket entry point, not just in the UI',
  /exclusiveClaim\(upgrade\)/.test(read('scripts/purchase.js')));
t('a ruled-out card is visually distinct from a merely locked one',
  /\.upg-card\.excluded \{/.test(css) && /\.upg-card\.excluded \.upg-art \{/.test(css));
t('a ruled-out card says which rival closed it',
  /\{\{#if excludedBy\}\}/.test(read('templates/shop.hbs')));
// A "???" teaser that wins the choice must not be named by the card it closed.
t('a hidden rival is not named to players',
  /claim\.hidden && !isGM\) \? t\("UPGRADES\.Shop\.AChoiceMade"\)/.test(read('scripts/apps/shop-app.js')));
t('an open choice announces itself before anyone commits',
  /\{\{#if exclusiveLabel\}\}/.test(read('templates/shop.hbs'))
  && /exclusiveLabel: \(!mystery && rivals\.length && !claim\)/.test(read('scripts/apps/shop-app.js')));
// Exclusivity is authored on the upgrade, not in a registry the GM has to keep in step: there is
// no world setting behind it and nothing in the console to configure first.
t('exclusivity needs no setup step of its own',
  !/EXCLUSIONS/.test(read('scripts/settings.js'))
  && !/exclusiveGroup/i.test(read('templates/editor.hbs')));
t('the picker offers the upgrades that already exist',
  /name="excludes"/.test(read('templates/upgrade-editor.hbs'))
  && /eligibleExclusions\(live, all\)/.test(read('scripts/apps/upgrade-editor.js')));

/* ---------- the pickers survive a large catalogue ---------- */
// Both "comes after" and "cannot be taken with" list every other upgrade, so a world with a few
// dozen of them turns each into a wall of checkboxes taller than the form.
t('a picker list is capped and scrolls inside itself',
  /\.upg-picker-list \{[^}]*max-height: \d+px/.test(css)
  && /\.upg-picker-list \{[^}]*overflow-y: auto/.test(css));
t('a filtered-out row is actually hidden', /\.filtered-out \{ display: none/.test(css));
// Typing must narrow the list without rebuilding the form — a re-render per keystroke would
// fight the caret — but the text still has to survive the re-render that ticking a box triggers.
t('filtering happens in the DOM, not by re-rendering',
  /input\.addEventListener\("input", apply\)/.test(read('scripts/apps/upgrade-editor.js')));
t('the filter text is part of the draft, so a tick does not clear it',
  /this\.draft\.requiresFilter = val\("requiresFilter"\)/.test(read('scripts/apps/upgrade-editor.js'))
  && /this\.draft\.excludesFilter = val\("excludesFilter"\)/.test(read('scripts/apps/upgrade-editor.js')));
t('both pickers are the same widget rather than two that can drift',
  (read('templates/upgrade-editor.hbs').match(/class="upg-picker upg-prereqs" data-picker="\w+"/g) || []).length === 2);
// Ticking re-renders the form, and the list scrolls inside itself — outside what the shared
// mixin restores — so without this you are thrown to the top of the list after every tick.
t('a picker keeps its scroll position across the re-render a tick causes',
  /list\.scrollTop = this\.#pickerScroll\[key\]/.test(read('scripts/apps/upgrade-editor.js')));
// Ticked rows float to the top so the current state reads without scrolling — but on what was
// ticked when the window opened, not the live set, which would pull each row out from under the
// cursor as it is clicked.
t('ticked rows float to the top, in an order fixed when the window opens',
  /Number\(b\.wasSelected\) - Number\(a\.wasSelected\)/.test(read('scripts/apps/upgrade-editor.js'))
  && /#pinned = \{\s*requires: new Set/.test(read('scripts/apps/upgrade-editor.js')));
// Ticking one upgrade can pull in whatever it was already exclusive with, so the note has to be
// built from the closed set — reading back only the ticked boxes would understate it.
t('the editor names the whole set, not just what was ticked',
  /const rivals = exclusiveSiblings\(live, all\)/.test(read('scripts/apps/upgrade-editor.js'))
  && /#exclusiveNote\(rivals\)/.test(read('scripts/apps/upgrade-editor.js')));
t('being ruled out also withdraws the buy button',
  /affordable: isAvailable\(u\) && isUnlocked\(u, all\) && !claim/.test(read('scripts/apps/shop-app.js')));
// Buying the prerequisite is exactly what rules the dependant out, so the pair would sit
// locked forever; the picker must never offer it.
t('a prerequisite from the same exclusive set cannot be authored',
  /const rivals = new Set\(exclusiveSiblings\(upgrade, all\)/.test(read('scripts/catalog.js')));
t('the exclusion list is part of the upgrade editor draft',
  /this\.draft\.excludes = \[\.\.\.form\.querySelectorAll\('\[name="excludes"\]:checked'\)\]/
    .test(read('scripts/apps/upgrade-editor.js')));

t('a repeatable upgrade does not declare itself take-once',
  /maxTakable: upgrade\.repeatable/.test(read('scripts/systems/adapter.js')));
/* ---------- the bonus-target picker ---------- */
// It replaced a <select> of forty-odd options across seven optgroups, which is the same
// scaling problem the prerequisite pickers had, in the one place a GM cannot avoid.
t('the target picker filters in the DOM rather than re-rendering per keystroke',
  /filter\.addEventListener\("input", apply\)/.test(read('scripts/apps/upgrade-editor.js')));
t('only choosing a target re-renders, because only that reshapes the row',
  /field\.value = option\.dataset\.presetPick;[\s\S]{0,120}this\.render\(\)/
    .test(read('scripts/apps/upgrade-editor.js')));
t('the open list is capped and scrolls inside itself',
  /\.upg-preset-list \{[^}]*max-height: \d+px[^}]*overflow-y: auto/.test(css));
// scrollIntoView walks every scrollable ancestor; that is how the form used to get dragged along.
// Match a call, not the word — the comment explaining why it is avoided says it too.
t('the list is scrolled by hand, not with scrollIntoView',
  !/\.scrollIntoView\(/.test(read('scripts/apps/upgrade-editor.js'))
  && /list\.scrollTop = Math\.max\(0, chosen\.offsetTop/.test(read('scripts/apps/upgrade-editor.js')));
t('a heading whose options are all filtered away is hidden too',
  /heading\.classList\.toggle\("filtered-out", !live\)/.test(read('scripts/apps/upgrade-editor.js')));
t('the picker can be driven from the keyboard',
  /event\.key === "Escape"/.test(read('scripts/apps/upgrade-editor.js'))
  && /event\.key === "Enter"/.test(read('scripts/apps/upgrade-editor.js')));

t('the bonus type is hidden on a dice row, where it would be discarded',
  /bonusType\.classList\.toggle\("hidden", isDice\)/.test(read('scripts/apps/upgrade-editor.js')));

t('the merchant token wrap falls through for every other token',
  /return original\.call\(this, event\)/.test(read('scripts/main.js')));
t('the merchant token wrap is applied only once',
  /_upgradesMerchantBound/.test(read('scripts/main.js')));

t('the buyer is asked on their own client, before the request is sent',
  /promptForDocument[\s\S]{0,900}emit\(\{ type: "requestPurchase"/.test(read('scripts/purchase.js')));
t('cancelling the prompt spends nothing', /if \(!choice\) return;/.test(read('scripts/purchase.js')));
t('the choice is remembered on the purchase so re-sync can rebuild it',
  /choice: purchase\.choice/.test(read('scripts/systems/adapter.js')));
// The dnd5e quiet grant wraps the effect in a feat; the wrapper is what the sheet shows, so the
// nomination has to reach it — carried only by the embedded effect it was invisible.
t('the wrapped feat carries the choice in its name',
  /name: `\$\{upgrade\.name \|\| payload\.data\.name\}\$\{suffix\}`/.test(read('scripts/systems/adapter.js')));
t('and the chosen document is linked from the wrapper description',
  /description: \{ value: `\$\{upgrade\.description \|\| upgrade\.flavor \|\| ""\}\$\{link\}` \}/.test(read('scripts/systems/adapter.js')));
t('re-renders restore scroll position', /restoreViewState\(this, selector/.test(read('scripts/apps/ui.js')));
// A bare focus() scrolls the element into view in every scrollable ancestor, overriding the
// scrollTop restored moments earlier. Because the browser only ever scrolls *towards* the focused
// element, a form that re-renders on each dropdown change ratchets downwards and never comes back.
t('restoring focus does not drag the scroll container with it',
  /field\.focus\(\{ preventScroll: true \}\)/.test(read('scripts/apps/ui.js')));
t('and the scroll position is reasserted after focus, for engines that ignore the hint',
  /focus\(\{ preventScroll: true \}\);[\s\S]{0,220}scroller\.scrollTop = state\.scrollTop/
    .test(read('scripts/apps/ui.js')));

/* ---------- the merchant token has to be reachable by players ---------- */
const dataJs = read('scripts/settings.js');
t('the module checks whether players can view the merchant actor',
  /testUserPermission\(u, "LIMITED"\)/.test(dataJs));
t('and offers to grant the minimum level that lets a click through',
  /ownership\.default/.test(dataJs) && /DOCUMENT_OWNERSHIP_LEVELS\.LIMITED/.test(dataJs));
t('granting never lowers an existing permission',
  /Math\.max\(\s*actor\.ownership\?\.default/.test(dataJs));
t('a world with no players is not warned about',
  /if \(!players\.length\) return LEVELS\.LIMITED/.test(dataJs));

/* ---------- no dead interactive surfaces ---------- */
// A drop zone in a template with no listener behind it looks completely normal and does nothing
// at all. Both zones in the setup window shipped that way, unnoticed, because the edit that was
// supposed to add their listeners anchored on text that lived in a different file.
const APP_FOR_TEMPLATE = {
  'settings.hbs': 'scripts/apps/settings-app.js',
  'upgrade-editor.hbs': 'scripts/apps/upgrade-editor.js',
  'shop.hbs': 'scripts/apps/shop-app.js',
  'editor.hbs': 'scripts/apps/editor-app.js'
};
for (const [template, app] of Object.entries(APP_FOR_TEMPLATE)) {
  const tplSrc = read(`templates/${template}`);
  const appSrc = read(app);
  const zones = [...new Set([...tplSrc.matchAll(/data-drop="([\w-]+)"/g)].map(m => m[1]))];
  for (const zone of zones) {
    // either named directly, or reached through a loop over zone names
    const wired = appSrc.includes(`data-drop="${zone}"`) || appSrc.includes(`"${zone}"`);
    t(`${template}: drop zone "${zone}" has a listener behind it`, wired);
  }
  // every data-action in a template must be a registered action
  const actions = [...new Set([...tplSrc.matchAll(/data-action="([\w-]+)"/g)].map(m => m[1]))];
  const registered = new Set([...appSrc.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]));
  for (const action of actions) {
    t(`${template}: action "${action}" is registered`, registered.has(action));
  }
}

/* ---------- nothing should ask the user to know an icon name ---------- */
// This was fixed three separate times: the currency icon, the host portrait, and the resource
// dialog. Each surface that takes an icon must offer a way to choose one.
const settingsApp = read('scripts/apps/settings-app.js');
t('the setup form offers a picker for the currency icon',
  /iconGroups/.test(settingsHbs) && /name="currencyIcon"/.test(settingsHbs));
t('the setup form offers a picker for the host portrait',
  /hostIconGroups/.test(settingsHbs) && /name="hostImg"/.test(settingsHbs));
t('the resource dialog offers a picker rather than a bare field',
  /iconPickerHtml\(ICON_GROUPS/.test(settingsApp));
t('the resource dialog wires the picker up to its field',
  /wireIconPicker\((?:dialog|root)[^)]*, "icon"\)/.test(settingsApp));
t('every icon surface also allows browsing for an image',
  (settingsApp.match(/data-browse-icon|pickIconImage|pickHostImg/g) || []).length >= 2);
t('the picker writes into the field, keeping one source of truth',
  /input\.value = b\.dataset\.pickIcon/.test(settingsApp));

/* ---------- effect visibility rules ---------- */
const shopJs = read('scripts/apps/shop-app.js');
t('teasers never compute effect lines', /u\.hidden && !isGM\) return;/.test(shopJs));
t('secret upgrades withhold lines until owned',
  /u\.hideEffect && !u\.purchased && !isGM\) return;/.test(shopJs));
t('the GM is shown a hidden-from-players marker',
  /effectSecretForGM: isGM && u\.hideEffect && !u\.purchased/.test(shopJs));

process.exit(bad);
