import { i18n } from './i18n-stub.mjs';
globalThis.CONST = { ACTIVE_EFFECT_MODES:{CUSTOM:0,MULTIPLY:1,ADD:2,DOWNGRADE:3,UPGRADE:4,OVERRIDE:5} };
globalThis.game = { system: { id: "dnd5e" }, i18n };
globalThis.CONFIG = {};
const { buildChanges, splitDamageValue, getDamageTypes, describeBuild } =
  await import(new URL('../scripts/effects.js', import.meta.url));
let bad=0; const t=(n,c)=>{if(!c)bad=1;console.log((c?'PASS ':'FAIL ')+n)};

t('13 damage types when CONFIG is empty', getDamageTypes().length === 13);
t('cold is among them', getDamageTypes().some(d => d.id === 'cold'));
globalThis.CONFIG = { DND5E: { damageTypes: { cold: {label:"Cold"}, fire: {label:"Fire"} } } };
t('live CONFIG wins when present', getDamageTypes().length === 2 && getDamageTypes()[0].label === 'Cold');
globalThis.CONFIG = {};

t('split parses amount and type', JSON.stringify(splitDamageValue("1d8[cold]")) === '{"amount":"1d8","damageType":"cold"}');
t('split tolerates no type', splitDamageValue("1d8").damageType === "");
t('split tolerates a sign', splitDamageValue("+1d8[cold]").amount === "+1d8");

// the new way: amount and type in separate fields
const nu = buildChanges([{ preset:"weapon.damage", value:"1d4", damageType:"cold" }]);
t('composes amount + type', nu.every(c => c.value === '+1d4[cold]'));
t('still fans out to both weapon paths', nu.length === 2);
// untyped is allowed
t('no type yields a bare signed formula',
  buildChanges([{preset:"weapon.damage", value:"1d4", damageType:""}])[0].value === '+1d4');
// legacy rows authored before the dropdown existed
const old = buildChanges([{ preset:"weapon.damage", value:"1d8[cold]" }]);
t('legacy bracketed value still works', old.every(c => c.value === '+1d8[cold]'));
t('explicit type overrides a bracketed legacy value',
  buildChanges([{preset:"weapon.damage", value:"1d8[cold]", damageType:"fire"}])[0].value === '+1d8[fire]');
// non-damage presets are untouched by any of this
t('AC is unaffected by damage handling',
  buildChanges([{preset:"ac", value:"1", damageType:"cold"}])[0].value === '+1');
t('describeBuild shows the type',
  describeBuild([{preset:"weapon.damage", value:"1d4", damageType:"cold"}]) === '1d4[cold] all weapon damage');
process.exit(bad);
