/**
 * Every function a module calls must actually exist.
 *
 * `node --check` validates syntax only. A release once shipped calling two helpers that were
 * never inserted — the file parsed perfectly and threw ReferenceError the moment the dialog
 * opened. This is the cheap static check that would have caught it.
 *
 * Deliberately conservative: it only inspects bare calls like `foo(...)`, never `obj.foo(...)`,
 * so it cannot reason about runtime shapes and will not cry wolf about Foundry's API.
 */
import fs from 'node:fs';

const SCRIPTS = [
  'scripts/settings.js', 'scripts/economy.js', 'scripts/catalog.js', 'scripts/effects.js', 'scripts/main.js', 'scripts/purchase.js',
  'scripts/sockets.js', 'scripts/currency.js', 'scripts/systems/adapter.js',
  'scripts/apps/shop-app.js', 'scripts/apps/editor-app.js', 'scripts/apps/upgrade-editor.js',
  'scripts/apps/settings-app.js', 'scripts/apps/ui.js', 'scripts/apps/choice-dialog.js'
];

// Things the browser, Foundry, or the language provides.
const AMBIENT = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'super',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Set', 'Map', 'Promise',
  'Error', 'RegExp', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'structuredClone',
  'foundry', 'game', 'ui', 'canvas', 'Hooks', 'CONFIG', 'CONST', 'fromUuid', 'fromUuidSync', 'ChatMessage',
  'Actor', 'Item', 'FilePicker', 'Token', 'Dialog', 'DialogV2', 'console', 'window', 'document',
  'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'fetch', 'Symbol', 'import', 'async'
]);

/** Comments and string bodies are prose, not code; scanning them invents calls that do not exist. */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')          // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')       // line comments, sparing protocol-ish "://"
    .replace(/`(?:\\.|[^`\\])*`/g, '``')          // template literals
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

let bad = 0;
const t = (n, c) => { if (!c) bad = 1; console.log((c ? 'PASS ' : 'FAIL ') + n); };

for (const rel of SCRIPTS) {
  const src = stripNonCode(fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));

  // What this module has available by name
  const declared = new Set([
    ...[...src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]),
    ...[...src.matchAll(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g)].map(m => m[1]),
    ...[...src.matchAll(/(?:export\s+)?class\s+(\w+)/g)].map(m => m[1]),
    // named imports, including multi-line ones
    ...[...src.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)]
      .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
    ...[...src.matchAll(/const\s*\{([^}]*)\}\s*=/g)]
      .flatMap(m => m[1].split(',').map(x => x.trim().split(':').pop().trim()).filter(Boolean)),
    // parameters and locally-scoped names that appear as arrow functions
    ...[...src.matchAll(/(\w+)\s*=>/g)].map(m => m[1]),
    // method definitions, including the private ones these classes lean on
    ...[...src.matchAll(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?#?(\w+)\s*\([^)]*\)\s*\{/gm)].map(m => m[1]),
    // object-literal shorthand methods and properties holding functions
    ...[...src.matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]),
    // destructured parameters, both `({ a, b })` and `(el, { a = [], b } = {})`
    ...[...src.matchAll(/\{([^{}]*)\}\s*=\s*\{\}/g), ...src.matchAll(/\(\s*\{([^{}]*)\}\s*\)/g)]
      .flatMap(m => m[1].split(',')
        .map(x => x.trim().split(/[=:]/)[0].trim())
        .filter(Boolean))
  ]);

  // Bare calls only: never obj.foo(), never this.#foo(), never a definition.
  const called = [...src.matchAll(/(^|[^.#\w$])([a-z_$][\w$]*)\s*\(/g)]
    .map(m => m[2])
    .filter(name => !AMBIENT.has(name));

  const missing = [...new Set(called)].filter(name => !declared.has(name));
  t(`${rel}: every function it calls is defined or imported`
    + (missing.length ? ` — missing: ${missing.join(', ')}` : ''), missing.length === 0);
}

process.exit(bad);
