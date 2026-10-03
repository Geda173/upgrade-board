/**
 * The shape of the module, rather than its behaviour.
 *
 * data.js grew to 674 lines covering settings, resources, upgrades, paths, purchases and history,
 * which meant any part could reach any other for free and invisibly. It is now three modules with
 * a deliberate direction of dependency, and these assertions are what stop that eroding again.
 */
import fs from 'node:fs';
import path from 'node:path';

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const root = new URL('../scripts/', import.meta.url);
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
    else if (entry.name.endsWith('.js')) files.push(`${dir}${entry.name}`);
  }
})('');

const normalise = (from, spec) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.js$/, '');

const staticDeps = {}, dynamicDeps = {};
for (const rel of files) {
  const src = fs.readFileSync(new URL(rel, root), 'utf8');
  const key = rel.replace(/\.js$/, '');
  staticDeps[key] = [...src.matchAll(/^import\s[\s\S]*?from\s*["'](\.[^"']+)["']/gm)]
    .map(m => normalise(rel, m[1]));
  dynamicDeps[key] = [...src.matchAll(/await import\(\s*["'](\.[^"']+)["']/g)]
    .map(m => normalise(rel, m[1]));
}

/* ---------- no static cycles ---------- */
function findCycles(graph) {
  const found = new Set();
  const walk = (node, trail) => {
    for (const next of graph[node] ?? []) {
      if (trail.includes(next)) found.add([...trail.slice(trail.indexOf(next)), next].join(' -> '));
      else walk(next, [...trail, next]);
    }
  };
  for (const node of Object.keys(graph)) walk(node, [node]);
  return [...found];
}
const cycles = findCycles(staticDeps);
t('no static import cycles' + (cycles.length ? `: ${cycles.join(' | ')}` : ''), cycles.length === 0);

/* ---------- the direction of dependency is the point ---------- */
t('catalog does not depend on economy — an upgrade does not know its own price',
  !staticDeps['catalog']?.includes('economy'));
t('economy may depend on catalog — removing a resource must strip it from upgrades',
  staticDeps['economy']?.includes('catalog') === true);
t('settings depends on neither — configuration knows nothing about upgrades or money',
  !staticDeps['settings']?.some(d => ['catalog', 'economy'].includes(d)));
t('the three core modules never import a window',
  ['settings', 'economy', 'catalog'].every(m => !(staticDeps[m] ?? []).some(d => d.startsWith('apps/'))));

/* ---------- cross-layer reaching is dynamic and therefore visible ---------- */
t('settings reaches the socket layer only dynamically',
  !staticDeps['settings']?.includes('sockets') && dynamicDeps['settings']?.includes('sockets') === true);
t('sockets reaches the purchase pipeline only dynamically',
  !staticDeps['sockets']?.includes('purchase') && dynamicDeps['sockets']?.includes('purchase') === true);

/* ---------- nothing outlives its replacement ---------- */
t('data.js is gone, not merely emptied', !files.includes('data.js'));
t('no module still imports it', Object.values(staticDeps).every(d => !d.includes('data')));

process.exit(bad);
