import { i18n } from './i18n-stub.mjs';
globalThis.CONST = { ACTIVE_EFFECT_MODES:{CUSTOM:0,MULTIPLY:1,ADD:2,DOWNGRADE:3,UPGRADE:4,OVERRIDE:5} };
globalThis.game = { system:{ id:"dnd5e" }, i18n };
globalThis.CONFIG = {};
globalThis.fromUuid = async u => u === "Item.good" ? { name: "Frostroot Blessing" } : null;
const { describeRows, describeUpgradeEffect } = await import(new URL('../scripts/effects.js', import.meta.url));
let bad=0; const t=(n,c)=>{if(!c)bad=1;console.log((c?'PASS ':'FAIL ')+n)};

const d = rows => describeRows(rows);
t('damage reads naturally',
  d([{preset:"weapon.damage", value:"1d4", damageType:"cold"}])[0] === "All weapon damage +1d4 cold");
t('untyped damage omits the type',
  d([{preset:"weapon.damage", value:"1d4"}])[0] === "All weapon damage +1d4");
t('legacy bracket form still reads right',
  d([{preset:"weapon.damage", value:"1d8[cold]"}])[0] === "All weapon damage +1d8 cold");
t('flat bonus keeps one sign only',
  d([{preset:"ac", value:"+1"}])[0] === "Armor Class +1");
t('unsigned flat bonus gains a sign',
  d([{preset:"ac", value:"1"}])[0] === "Armor Class +1");
t('ability score reads naturally',
  d([{preset:"ability.wis", value:"2"}])[0] === "Wisdom score +2");
t('upgrade-mode reads as "raised to", without the parenthetical',
  d([{preset:"darkvision", value:"60"}])[0] === "Darkvision raised to 60");
t('custom row shows its path', d([{preset:"custom", key:"system.foo", value:"+1"}])[0] === "system.foo +1");
t('blank rows are skipped', d([{preset:"ac", value:"  "}]).length === 0);
t('multiple rows each get a line', d([{preset:"ac",value:"1"},{preset:"init",value:"2"}]).length === 2);

const build = await describeUpgradeEffect({ effectMode:"build", effectBuild:{rows:[{preset:"ac",value:"1"}]} });
t('build mode describes its rows', build[0] === "Armor Class +1");
const link = await describeUpgradeEffect({ effectMode:"link", effectUuid:"Item.good" });
t('link mode names the linked document', link[0] === "Frostroot Blessing");
const broken = await describeUpgradeEffect({ effectMode:"link", effectUuid:"Item.missing" });
t('unresolvable link says nothing rather than lying', broken.length === 0);
t('cosmetic upgrade says nothing', (await describeUpgradeEffect({ effectMode:"none" })).length === 0);
t('legacy upgrade with only a uuid is treated as a link',
  (await describeUpgradeEffect({ effectUuid:"Item.good" }))[0] === "Frostroot Blessing");
process.exit(bad);
