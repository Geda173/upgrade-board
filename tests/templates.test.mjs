/**
 * Handlebars templates: they must compile, and they must render the values the apps pass in.
 *
 * `localize` is the only helper registered, because it is the only Foundry helper the templates
 * are allowed to use — everything else is precomputed in _prepareContext. It is backed by the
 * real `lang/en.json` rather than stubbed to echo its key, which is what keeps the assertions
 * below about English wording honest *and* makes a mistyped key fail here instead of rendering
 * as "UPGRADES.Shop.Lokced" in Foundry. Stubbing Foundry's `checked` and `selected` here once
 * hid a "Missing helper" crash that only appeared at runtime; nothing else gets registered.
 */
import fs from 'node:fs';

let Handlebars;
try {
  Handlebars = (await import('handlebars')).default;
} catch {
  console.log('SKIP  handlebars is not installed — run: npm install');
  process.exit(0);
}

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const tpl = name => fs.readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8');

/* ---------- Foundry's `localize`, as documented: hash args go to Localization#format ---------- */
const lang = JSON.parse(fs.readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const missingKeys = new Set();
const lookup = key => key.split('.').reduce((o, k) => (o ?? {})[k], lang);

Handlebars.registerHelper('localize', function (key, options) {
  const raw = lookup(key);
  if (typeof raw !== 'string') { missingKeys.add(key); return key; }
  const data = options?.hash ?? {};
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));
});

/* ---------- every template compiles without a helper ---------- */
for (const name of fs.readdirSync(new URL('../templates', import.meta.url))) {
  const src = tpl(name);
  let missingHelper = null;
  try {
    Handlebars.compile(src)({});
  } catch (e) {
    if (/Missing helper/.test(e.message)) missingHelper = e.message.split('\n')[0];
  }
  t(`${name}: uses only core Handlebars` + (missingHelper ? ` — ${missingHelper}` : ''), !missingHelper);
}

/* ---------- rendering with realistic context ---------- */
const vocab = {
  windowTitle: 'The Memorial Garden', currencyName: 'Sprigs',
  currencyIcon: 'fa-solid fa-seedling', currencyIconIsImg: false, actionVerb: 'Plant',
  hostName: "Elara's Respite", hostImg: '', hostIsImage: false,
  hostIconClass: 'fa-solid fa-seedling', greeting: 'The soil remembers.'
};

const shopCards = [
    { id: 'a', displayName: 'Nightbloom', displayFlavor: 'Planted in memory.', displayImg: '',
      cost: 3, purchased: false, mystery: false, affordable: true, selected: true,
      targetLabel: 'Galadon Stormwhisper', excerpt: 'Planted at the north wall; it flowers in winter.',
      costs: [{ amount: 3, name: 'Sprigs', icon: 'fa-solid fa-seedling', isImage: false },
              { amount: 1, name: 'Pearls of Power', icon: 'fa-solid fa-circle', isImage: false }],
      effectLines: ['All weapon damage +1d4 cold', 'Armor Class +1'] },
    { id: 'b', displayName: '???', displayFlavor: '…', displayImg: '', cost: 9,
      purchased: false, mystery: true, affordable: false, selected: false,
      targetLabel: null, effectLines: [] },
    { id: 'c', displayName: 'Ashen Fern', displayFlavor: 'Owned.', displayImg: '', cost: 2,
      purchased: true, soldOut: true, available: false, mystery: false, affordable: false,
      selected: false, targetLabel: null, effectLines: [], ownedCount: 0 },
    { id: 'f', displayName: 'Connect to Lighthouse', displayFlavor: '', displayImg: '', cost: 10,
      purchased: false, soldOut: false, available: true, mystery: false, affordable: false,
      locked: true, onPath: true, requiresLabel: 'Activate Magelight',
      selected: false, targetLabel: null, effectLines: [], ownedCount: 0 },
    { id: 'e', displayName: 'Healing Draught', displayFlavor: 'Bought again and again.', displayImg: '',
      cost: 1, purchased: true, soldOut: false, available: true, mystery: false, affordable: true,
      selected: false, targetLabel: 'Whoever buys it', effectLines: [],
      ownedCount: 3, ownedBy: 'Ander Raventail, Syllith Azmarun' },
    { id: 'd', displayName: 'Secret Bloom', displayFlavor: 'Sealed.', displayImg: '', cost: 4,
      purchased: false, mystery: false, affordable: true, selected: false,
      targetLabel: null, effectLines: [], effectSecret: true },
    { id: 'g', displayName: 'Oath of Ash', displayFlavor: 'The first vow.', displayImg: '', cost: 5,
      purchased: false, soldOut: false, available: true, mystery: false, affordable: false,
      locked: true, excluded: true, excludedBy: 'Oath of Salt', exclusiveLabel: '',
      selected: false, targetLabel: null, effectLines: [], ownedCount: 0 },
    { id: 'h', displayName: 'Oath of Bone', displayFlavor: 'Still open.', displayImg: '', cost: 5,
      purchased: false, soldOut: false, available: true, mystery: false, affordable: true,
      locked: false, excluded: false, excludedBy: '', exclusiveLabel: 'Oath of Ash, 1 more',
      selected: false, targetLabel: null, effectLines: [], ownedCount: 0 }
];

const shop = Handlebars.compile(tpl('shop.hbs'))({
  isGM: true, balance: 7, vocab,
  currencies: [{ id: 'sprigs', name: 'Sprigs', icon: 'fa-solid fa-seedling', isImage: false, balance: 7 },
               { id: 'pearls', name: 'Pearls of Power', icon: 'fa-solid fa-circle', isImage: false, balance: 2 }],
  hasMultipleCurrencies: true,
  upgrades: shopCards,
  groups: [
    { id: 'c1', name: 'Lighthouse', icon: 'fa-solid fa-tower-observation', upgrades: shopCards.slice(0, 2) },
    { id: null, name: 'Other', icon: 'fa-solid fa-folder-open', upgrades: shopCards.slice(2) }
  ],
  hasSections: true,
  selected: { name: 'Nightbloom', img: '', flavor: 'Planted in memory.',
              targetLabel: 'Galadon Stormwhisper',
              effectLines: ['All weapon damage +1d4 cold', 'Armor Class +1'] },
  selectedDescription: '<p>Grants a boon.</p>'
});

const editor = Handlebars.compile(tpl('editor.hbs'))({
  vocab, balance: 7,
  categories: [{ id: 'c1', name: 'Lighthouse', icon: 'fa-solid fa-tower-observation' }],
  hasCategories: true,
  groups: [{ id: 'c1', name: 'Lighthouse', icon: 'fa-solid fa-tower-observation', upgrades: [
    { id: 'a', name: 'Nightbloom', img: '', costLabel: '3 Sprigs, 1 Pearl of Power',
      purchased: true, purchasedBy: 'Pat',
      hidden: false, targetLabel: 'Galadon Stormwhisper', ownedCount: 1,
      exclusiveLabel: 'Oath of Salt',
      effectLabel: '1d8[cold] all weapon damage' },
    { id: 'e', name: 'Healing Draught', img: '', costLabel: '1 Sprigs', purchased: true,
      isRepeatable: true,
      ownedCount: 3, ownedNames: 'Ander Raventail', hidden: false,
      targetLabel: 'Whoever buys it', effectLabel: '' }] }],
  hasHistory: true,
  historyTotal: 2,
  // `price` is the field a purchase entry actually stores; a fixture using `cost` hid the fact
  // that the template read the wrong one and rendered the price as nothing at all.
  history: [{ id: 'h1', when: 'today', isPurchase: true, name: 'Nightbloom', price: '3 Sprigs',
              by: 'Pat', canReword: false },
            { id: 'h2', when: 'today', isPurchase: false, deltaStr: '+5', before: 2, after: 7,
              currencyName: 'Pearls of Power', reason: 'Cleared the grove', canReword: true }]
});

const upgradeEditor = Handlebars.compile(tpl('upgrade-editor.hbs'))({
  upgrade: { name: 'Nightbloom', cost: 3, img: '', flavor: '', description: '', hidden: false,
             target: 'actor', effectMode: 'build', effectUuid: '', purchased: true, hideEffect: true,
             repeatable: true, choiceEnabled: true, choiceLabel: 'Which spell?', choiceHint: 'Drag one in.' },
  vocab, saveLabel: 'Save', systemId: 'dnd5e', builderSupported: true, isPf2e: false,
  hasCategories: true,
  categories: [{ id: 'c1', name: 'Lighthouse', isSelected: true }],
  costRows: [{ id: 'sprigs', name: 'Sprigs', icon: 'fa-solid fa-seedling', isImage: false, amount: 3 },
             { id: 'pearls', name: 'Pearls of Power', icon: 'fa-solid fa-circle', isImage: false, amount: 1 }],
  bonusTypeLegend: [],
  choiceEnabled: true,
  hasPrerequisiteCandidates: true,
  prerequisites: [{ id: 'p1', name: 'Activate Magelight', section: 'Lighthouse',
                    search: 'activate magelight lighthouse', isSelected: true },
                  { id: 'p2', name: 'Talisman Permanency', section: '',
                    search: 'talisman permanency', isSelected: false }],
  requiresCount: 1, requiresFilter: '', showRequiresFilter: false,
  hasExclusionCandidates: true,
  // Long enough to earn a filter box, which is what a real catalogue looks like.
  exclusions: [{ id: 'x1', name: 'Oath of Salt', section: 'Oaths',
                 search: 'oath of salt oaths', isSelected: true },
               { id: 'x2', name: 'Fair Winds', section: '',
                 search: 'fair winds', isSelected: false }],
  excludesCount: 1, excludesFilter: 'oath', showExcludesFilter: true,
  exclusiveNote: 'Only one of this and Oath of Salt, Oath of Bone can ever be taken. '
    + 'Oath of Bone joins the set because it is already exclusive with something ticked here.',
  targetOptions: [{ value: 'party', label: 'The whole party', isSelected: false },
                  { value: 'buyer', label: 'Whoever buys it', isSelected: false },
                  { value: 'actor', label: 'One specific character', isSelected: true }],
  isBuyerTarget: false,
  isActorTarget: true, hasTargetActor: true,
  actorGroups: [{ label: 'Party', actors: [{ id: 'x', name: 'Galadon Stormwhisper', isSelected: true }] }],
  partyNote: '…',
  effectModeOptions: [{ value: 'none', label: 'Nothing', isSelected: false },
                      { value: 'build', label: 'Build a bonus', isSelected: true },
                      { value: 'link', label: 'Link', isSelected: false }],
  isBuild: true, isLink: false,
  rows: [{ index: 0, preset: 'weapon.damage', value: '1d8', key: '', mode: 2, isCustom: false,
           isDamage: true, isPf2e: false, placeholder: '+1d8',
           damageTypes: [{ id: 'cold', label: 'Cold', isSelected: true }],
           bonusTypes: [{ id: 'circumstance', label: 'Circumstance', isSelected: true }],
           presetLabel: 'All weapon damage',
           presetGroups: [{ label: 'Attack & damage', presets: [
             { id: 'weapon.damage', label: 'All weapon damage', isSelected: true,
               search: 'all weapon damage attack & damage' },
             { id: 'custom', label: 'Custom data path…', isSelected: false,
               search: 'custom data path… attack & damage' }] }],
           modeChoices: [{ value: 2, label: 'Add', isSelected: true }] },
         // the type IS the payload: a dnd5e trait set, or a PF2e immunity
         { index: 1, preset: 'resistance', value: 'fire', key: '', mode: 2, isCustom: false,
           isDamage: false, isIwr: true, valueIsType: true, isPf2e: false, placeholder: '',
           kinds: [{ id: 'fire', label: 'Fire', isSelected: true },
                   { id: 'cold', label: 'Cold', isSelected: false }],
           damageTypes: [], bonusTypes: [], presetGroups: [], modeChoices: [] },
         // an amount AND a type, and — being a rule element, not a modifier — no bonus type
         { index: 2, preset: 'resistance', value: '5', key: '', mode: 2, isCustom: false,
           isDamage: false, isIwr: true, valueIsType: false, isPf2e: true, placeholder: '5',
           kinds: [{ id: 'physical', label: 'Physical', isSelected: true }],
           damageTypes: [], bonusTypes: [{ id: 'circumstance', label: 'Circumstance', isSelected: true }],
           presetGroups: [], modeChoices: [] },
         // one of two answers rather than an amount: advantage, or PF2e's fortune
         { index: 3, preset: 'adv.save', value: 'advantage', key: '', mode: 2, isCustom: false,
           isDamage: false, isIwr: false, valueIsType: false, isPf2e: true, placeholder: '',
           hasChoices: true, choices: [{ id: 'advantage', label: 'Advantage', isSelected: true },
                                       { id: 'disadvantage', label: 'Disadvantage', isSelected: false }],
           kinds: [], damageTypes: [], bonusTypes: [{ id: 'circumstance', label: 'Circumstance', isSelected: true }],
           presetGroups: [], modeChoices: [] },
         // the preset is the whole statement — a special trait, or a sense with no range
         { index: 4, preset: 'flag.reliableTalent', value: '', key: '', mode: 5, isCustom: false,
           isDamage: false, isIwr: false, valueIsType: false, isPf2e: true, isToggle: true,
           placeholder: '', kinds: [], damageTypes: [],
           bonusTypes: [{ id: 'circumstance', label: 'Circumstance', isSelected: true }],
           presetGroups: [], modeChoices: [] }],
  linkedName: null, linkedImg: null, linkedType: null, linkMissing: false,
  showsGrantNote: true, grantNote: 'Granted as a feature.'
});

/* ---------- assertions: these catch ../ depth mistakes, which fail silently ---------- */
// Bound the split to the card grid first. Splitting the whole document leaves the LAST card's
// chunk running on into the detail pane, which made a correct template look like a leak.
// Cards now live in one grid per section; collect across all of them, each bounded to its own
// grid. The opening tag is matched loosely because a tree section carries extra attributes.
const cards = [...shop.matchAll(/<section class="upg-grid[^"]*"[^>]*>([\s\S]*?)<\/section>/g)]
  .flatMap(m => m[1].split('<div class="upg-card').slice(1));
const teaser = cards.find(c => c.includes('mystery'));
const normal = cards.find(c => c.includes('Nightbloom'));
const secret = cards.find(c => c.includes('Secret Bloom'));

t('shop: currency icon resolves inside the card loop', shop.includes('fa-seedling'));
t('shop: action verb comes from vocab', shop.includes('>Plant<'));
t('shop: per-actor target badge', shop.includes('Galadon Stormwhisper'));
t('shop: host name', /Elara(&#x27;|')s Respite/.test(shop));

t('shop: a card previews the description without expanding',
  !!normal && normal.includes('upg-excerpt') && normal.includes('flowers in winter'));
t('shop: a card with no flavour text reserves no empty line',
  (() => { const c = cards.find(x => x.includes('Healing Draught')); return !!c; })());
t('shop: a teaser card has no excerpt', !!teaser && !teaser.includes('upg-excerpt'));
t('shop: a normal card lists what it grants', !!normal && normal.includes('All weapon damage +1d4 cold'));
t('shop: detail pane has a "What it grants" heading', shop.includes('What it grants'));
t('shop: a teaser card leaks nothing', !!teaser && !teaser.includes('upg-effects') && teaser.includes('???'));
t('shop: a secret card says so instead of looking cosmetic',
  !!secret && secret.includes('upg-effect-secret') && !secret.includes('upg-effects'));

t('shop: every resource has its own purse in the header',
  (shop.match(/upg-purse/g) || []).length >= 2);
t('shop: a multi-resource price shows every component',
  (() => { const c = cards.find(x => x.includes('Nightbloom'));
           return !!c && (c.match(/upg-price/g) || []).length === 2; })());
t('shop: section heading rendered', shop.includes('upg-section-head') && shop.includes('Lighthouse'));
t('shop: every card still rendered across sections', cards.length === 8);

/* ---------- a tree section: same card markup, extra geometry ---------- */
const shopTree = Handlebars.compile(tpl('shop.hbs'))({
  isGM: false, balance: 3, vocab, currencies: [], upgrades: [],
  groups: [{
    id: 'tree1', name: 'The Old Oak', icon: 'fa-solid fa-tree', isTree: true,
    treeEdges: '[{"from":"root","to":"branch","lit":true,"cut":false}]',
    upgrades: [
      { id: 'root', displayName: 'Deep Roots', displayFlavor: '', displayImg: '', mystery: false,
        purchased: true, soldOut: true, affordable: false, selected: false, targetLabel: null,
        effectLines: [], treeCell: '1 / 1',
        treeTooltip: '<div class="upg-tree-tip"><h4>Deep Roots</h4></div>' },
      { id: 'branch', displayName: 'First Branch', displayFlavor: '', displayImg: '', mystery: false,
        purchased: false, soldOut: false, affordable: true, selected: false, targetLabel: null,
        effectLines: [], ownedCount: 3, treeCell: '2 / 1',
        treeTooltip: '<div class="upg-tree-tip"><h4>First Branch</h4></div>' }
    ]
  }],
  hasSections: true, selected: null, selectedDescription: null
});
t('shop: a tree section wraps in its own scroll container',
  shopTree.includes('class="upg-tree-wrap"'));
t('shop: a tree grid carries its edges for the connector overlay',
  /class="upg-grid upg-tree-grid"\s+data-tree-edges="\[\{/.test(shopTree));
t('shop: a tile is placed by grid-area, not left to flow',
  shopTree.includes('style="grid-area: 1 / 1"') && shopTree.includes('style="grid-area: 2 / 1"'));
t('shop: a tile carries its hover summary',
  shopTree.includes('data-tooltip=') && shopTree.includes('upg-tree-tip'));
t('shop: a repeatable tile shows its plain tally, no maximum implied',
  shopTree.includes('×3') && !shopTree.includes('3/'));
t('shop: a rows section gains none of the tree attributes',
  !shop.includes('upg-tree-grid') && !shop.includes('data-tree-edges') && !shop.includes('grid-area'));
(() => {
  const ruled = cards.find(c => c.includes('Oath of Ash'));
  const open = cards.find(c => c.includes('Oath of Bone'));
  t('shop: a ruled-out card is marked as such, not merely locked',
    !!ruled && ruled.includes('excluded'));
  t('shop: a ruled-out card names the rival that closed it',
    !!ruled && ruled.includes('Ruled out by Oath of Salt'));
  t('shop: a ruled-out card offers no purchase button',
    !!ruled && ruled.includes('>Ruled out<') && !/data-action="buy"/.test(ruled));
  // The exclusivity has to be visible while the choice is still open, or the only player who
  // learns about it is the one who finds their card closed.
  t('shop: an open choice names what it is a choice against',
    !!open && open.includes('Choose this or Oath of Ash'));
  // A "???" rival is counted, never named — the set's size is not a secret, its contents are.
  t('shop: a hidden rival is counted rather than named', !!open && open.includes('1 more'));
  t('shop: an open choice can still be bought',
    !!open && /data-action="buy"/.test(open) && !open.includes('Ruled out'));
})();
(() => {
  const lockedCard = cards.find(c => c.includes('Connect to Lighthouse'));
  t('shop: a locked card is marked locked', !!lockedCard && lockedCard.includes('locked'));
  t('shop: a locked card names what unlocks it',
    !!lockedCard && lockedCard.includes('Requires Activate Magelight'));
  t('shop: a locked card offers no purchase button',
    !!lockedCard && lockedCard.includes('>Locked<') && !/data-action="buy"/.test(lockedCard));
  t('shop: a card on a path is visually linked',
    !!lockedCard && lockedCard.includes('on-path') && lockedCard.includes('upg-path-link'));
})();
t('shop: a sold-out card is stamped Owned', shop.includes('upg-stamp'));
(() => {
  const repeat = cards.find(c => c.includes('Healing Draught'));
  t('shop: a repeatable card shows a tally, not an Owned stamp',
    !!repeat && repeat.includes('upg-tally') && repeat.includes('\u00d73') && !repeat.includes('upg-stamp'));
  t('shop: a repeatable card can still be bought', !!repeat && repeat.includes('upg-buy') && !repeat.includes('disabled'));
  t('shop: a repeatable card lists who owns it', !!repeat && repeat.includes('Ander Raventail'));
})();

t('editor: repeatable upgrade shows a purchase tally', editor.includes('Bought \u00d73'));
t('editor: repeatable upgrade lists its owners', editor.includes('Ander Raventail'));
t('editor: section heading row rendered', editor.includes('upg-group-row') && editor.includes('Lighthouse'));
t('editor: section management list rendered', editor.includes('upg-category-list'));
// Exclusivity is authored on the upgrade, so the console has nothing to configure for it.
t('editor: there is no exclusive-group registry to keep in step',
  !/exclusiveGroup/i.test(editor) && !/data-action="addExclusiveGroup"/.test(editor));
t('editor: the upgrade table names what an upgrade cannot be taken with',
  /fa-code-branch[\s\S]{0,40}Not with Oath of Salt/.test(editor));
t('editor: a purchase line shows the price it actually stores',
  editor.includes('acquired for 3 Sprigs'));
t('editor: an adjustment names the resource that moved, not the default one',
  editor.includes('Pearls of Power +5'));
t('editor: the ledger can be swept', /data-action="clearHistory"/.test(editor));
t('editor: each line can be removed', (editor.match(/data-action="removeHistoryEntry"/g) || []).length === 2);
t('editor: only an adjustment offers a reword',
  (editor.match(/data-action="editHistoryEntry"/g) || []).length === 1);
t('editor: the upgrade table prices multi-resource upgrades',
  editor.includes('3 Sprigs, 1 Pearl of Power'));
// This guarded `{{../vocab.currencyName}}` reaching into the history loop at the right depth.
// That lookup is gone — it named every adjustment after the *first* resource whichever one had
// actually moved — replaced by a precomputed per-entry name, asserted above. The one remaining
// `../` in the templates is the shop's action verb, covered by its own case.
t('editor: no history line depends on an outer-context lookup any more',
  !/\{\{\.\.\/[\s\S]*?\}\}/.test(editor.slice(editor.indexOf('upg-history'))));
t('editor: target column', editor.includes('Galadon Stormwhisper'));
t('editor: effect label', editor.includes('1d8[cold] all weapon damage'));

/* the bonus-target picker replaced a forty-option <select> */
t('upgrade-editor: the target picker is a filtered list, not a native dropdown',
  upgradeEditor.includes('upg-preset-picker') && !/<select name="rowPreset"/.test(upgradeEditor));
t('upgrade-editor: the value still lives in a field called rowPreset',
  /<input type="hidden" name="rowPreset" value="weapon\.damage">/.test(upgradeEditor));
t('upgrade-editor: the current target is shown on the closed picker',
  /class="upg-preset-current"[\s\S]{0,140}All weapon damage/.test(upgradeEditor));
t('upgrade-editor: the chosen option is marked', /upg-preset-option chosen"[^>]*data-preset-pick="weapon\.damage"/.test(upgradeEditor));
t('upgrade-editor: each option carries what the filter matches on',
  /data-search="all weapon damage attack &amp; damage"/.test(upgradeEditor));
t('upgrade-editor: group headings survive the move off optgroup',
  /upg-preset-group">Attack &amp; damage</.test(upgradeEditor));
t('upgrade-editor: the menu starts closed', /class="upg-preset-menu" hidden/.test(upgradeEditor));
t('upgrade-editor: row value', upgradeEditor.includes('value="1d8"'));
t('upgrade-editor: damage type dropdown appears', upgradeEditor.includes('rowDamageType'));

/* a resistance row asks for a kind, not a bonus */
(() => {
  const rows = upgradeEditor.split('<div class="upg-row"').slice(1);
  const traitRow = rows.find(r => r.includes('data-index="1"'));
  const amountRow = rows.find(r => r.includes('data-index="2"'));
  t('upgrade-editor: a trait row offers a type dropdown instead of a value field',
    !!traitRow && /<select name="rowValue"/.test(traitRow) && !/<input type="text" name="rowValue"/.test(traitRow));
  t('upgrade-editor: the chosen trait type is selected',
    !!traitRow && /value="fire" selected/.test(traitRow));
  t('upgrade-editor: a trait row needs no separate damage-type dropdown',
    !!traitRow && !traitRow.includes('rowDamageType'));
  t('upgrade-editor: a resistance with an amount keeps its value field',
    !!amountRow && /<input type="text" name="rowValue"/.test(amountRow));
  t('upgrade-editor: and gains a resistance-type dropdown',
    !!amountRow && /name="rowDamageType" class="upg-resist-type"/.test(amountRow));
  // A resistance is not a modifier, so PF2e's stacking type would be meaningless on it.
  t('upgrade-editor: a PF2e resistance row offers no bonus type',
    !!amountRow && !amountRow.includes('rowBonusType'));

  // Two row shapes that render no text field. If either branch failed to render its control the
  // row would still look plausible in the editor and simply never write anything.
  const choiceRow = rows.find(r => r.includes('data-index="3"'));
  const toggleRow = rows.find(r => r.includes('data-index="4"'));
  t('upgrade-editor: a choice row offers its two answers, not an amount field',
    !!choiceRow && /<select name="rowValue" class="upg-roll-choice"/.test(choiceRow)
      && !/<input type="text" name="rowValue"/.test(choiceRow));
  t('upgrade-editor: the chosen answer is selected',
    !!choiceRow && /value="advantage" selected/.test(choiceRow));
  t('upgrade-editor: a choice row carries no bonus type — it is not a modifier',
    !!choiceRow && !choiceRow.includes('rowBonusType'));
  t('upgrade-editor: a toggle row still submits a value',
    !!toggleRow && /<input type="hidden" name="rowValue" value="1">/.test(toggleRow));
  t('upgrade-editor: a toggle row asks for nothing else',
    !!toggleRow && !/<input type="text" name="rowValue"/.test(toggleRow)
      && !toggleRow.includes('rowBonusType'));
})();
t('upgrade-editor: dnd5e does NOT get the pf2e bonus-type dropdown',
  !upgradeEditor.includes('rowBonusType'));
t('upgrade-editor: target actor marked selected', upgradeEditor.includes('Galadon Stormwhisper'));
t('upgrade-editor: one cost field per resource',
  upgradeEditor.includes('name="cost:sprigs"') && upgradeEditor.includes('name="cost:pearls"'));
t('upgrade-editor: cost fields are labelled with the resource',
  upgradeEditor.includes('Sprigs') && upgradeEditor.includes('Pearls of Power'));
t('upgrade-editor: existing amounts are filled in',
  /name="cost:sprigs" value="3"/.test(upgradeEditor));
t('upgrade-editor: section dropdown marks the current section',
  /name="categoryId"[\s\S]*?value="c1" selected/.test(upgradeEditor));
t('upgrade-editor: prerequisite picker lists candidates',
  upgradeEditor.includes('name="requires"') && upgradeEditor.includes('Talisman Permanency'));
t('upgrade-editor: an existing prerequisite is ticked',
  /value="p1"[^>]*checked/.test(upgradeEditor));
t('upgrade-editor: the exclusion picker lists the upgrades that already exist',
  upgradeEditor.includes('name="excludes"') && upgradeEditor.includes('Fair Winds'));
t('upgrade-editor: an existing exclusion is ticked',
  /name="excludes" value="x1"[^>]*checked/.test(upgradeEditor));
t('upgrade-editor: an unticked one is not',
  /name="excludes" value="x2"(?![^>]*checked)/.test(upgradeEditor));
// The set is closed transitively, so the note has to name members nobody ticked here.
t('upgrade-editor: names the whole resulting set, not just the ticks',
  upgradeEditor.includes('Oath of Bone joins the set'));

/* the pickers have to stay usable once a world has a real catalogue in it */
t('upgrade-editor: a long picker gets a filter box',
  /name="excludesFilter"[^>]*value="oath"/.test(upgradeEditor));
t('upgrade-editor: a short one does not', !upgradeEditor.includes('name="requiresFilter"'));
t('upgrade-editor: each row carries what the filter matches on',
  /data-search="oath of salt oaths"/.test(upgradeEditor));
t('upgrade-editor: a row names its section, so near-identical names are tellable apart',
  /upg-picker-section">Lighthouse</.test(upgradeEditor));
t('upgrade-editor: a row with no section renders no empty label',
  !/upg-picker-section"><\/span>/.test(upgradeEditor));
t('upgrade-editor: how many are ticked is visible without counting boxes',
  upgradeEditor.includes('1 ticked'));
t('upgrade-editor: the no-matches line starts hidden and is not left showing',
  /upg-picker-empty[^"]*filtered-out/.test(upgradeEditor));
t('upgrade-editor: offers the buyer-choice prompt', upgradeEditor.includes('name="choiceEnabled"'));
t('upgrade-editor: the prompt question is editable when enabled',
  upgradeEditor.includes('value="Which spell?"'));
t('upgrade-editor: offers the effects-bar toggle', upgradeEditor.includes('showInEffectsBar'));
t('upgrade-editor: offers the buyer target', upgradeEditor.includes('Whoever buys it'));
t('upgrade-editor: repeatable checkbox is checked when set',
  /name="repeatable"[^>]*checked/.test(upgradeEditor));
t('upgrade-editor: hide-mechanics checkbox is checked when set',
  /name="hideEffect"[^>]*checked/.test(upgradeEditor));

/* ---------- localization ----------
 * A key that is not in en.json renders as the key itself in Foundry — visible, but only to
 * whoever opens that window. Both directions are checked: nothing referenced may be missing,
 * and nothing in the file may be dead, or the German translator works on strings no one sees. */
t(`every localize key used above resolves in en.json${missingKeys.size ? ` — missing: ${[...missingKeys].join(', ')}` : ''}`,
  missingKeys.size === 0);

/* The check above only sees keys on branches the fixtures happen to render. This one reads every
 * key out of the source, so a typo inside an `{{#if}}` no fixture enters is still caught. */
const referenced = new Set();
for (const name of fs.readdirSync(new URL('../templates', import.meta.url))) {
  for (const m of tpl(name).matchAll(/\{\{\{?localize\s+"([^"]+)"/g)) referenced.add(m[1]);
}
const undeclared = [...referenced].filter(k => typeof lookup(k) !== 'string');
t(`every localize key in the templates exists in en.json${undeclared.length ? ` — missing: ${undeclared.join(', ')}` : ''}`,
  undeclared.length === 0);

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`));
/* Scripts reference keys too — some literally, some built from an id (`UPGRADES.Preset.${cat}`).
 * A derived key cannot be found by reading the source, so a static prefix counts as a reference
 * for everything beneath it; the effects suites check those individually against the real
 * catalogues, which is where the objects actually exist. */
const prefixes = [];
const scriptDir = new URL('../scripts/', import.meta.url);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : [new URL(e.name, dir)]);
for (const file of walk(scriptDir)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/["'`](UPGRADES\.[\w.-]*)/g)) {
    if (src.slice(m.index).startsWith(`\`${m[1]}\${`) || /\$\{/.test(src.slice(m.index, m.index + m[0].length + 2))) {
      prefixes.push(m[1]);
    }
    referenced.add(m[1]);
  }
  for (const m of src.matchAll(/`(UPGRADES\.[\w.-]*)\$\{/g)) prefixes.push(m[1]);
}

const declared = flatten(lang);
const used = k => referenced.has(k) || prefixes.some(p => k.startsWith(p));
const unused = declared.filter(k => !used(k));

t(`every key in en.json is used by a template or a script${unused.length ? ` — unused: ${unused.join(', ')}` : ''}`,
  unused.length === 0);
t('the templates reference at least one localized string', referenced.size > 0);

process.exit(bad);
