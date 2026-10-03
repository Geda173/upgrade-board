/**
 * Test runner.  `npm test`, or `node tests/run.mjs [name-fragment]`
 *
 * There is no framework here on purpose — the module itself has no build step and no runtime
 * dependencies, and the same discipline keeps the tests readable. Each suite is a standalone
 * ES module that prints PASS/FAIL lines and exits non-zero on failure; this runner just spawns
 * them and totals up. Suites that need something unavailable (handlebars, network) print SKIP
 * and exit zero.
 *
 * These are not unit tests for their own sake. Every suite here exists because something broke:
 * effect paths that silently did nothing, a Handlebars helper Foundry does not provide, a Save
 * button below the fold, icon classes that render blank.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = new URL('./', import.meta.url);
const filter = process.argv[2] ?? '';

const suites = readdirSync(dir)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => f.includes(filter))
  .sort();

if (!suites.length) {
  console.error(filter ? `No suite matches "${filter}".` : 'No suites found.');
  process.exit(1);
}

const results = [];
for (const suite of suites) {
  const label = suite.replace('.test.mjs', '');
  const res = spawnSync(process.execPath, [fileURLToPath(new URL(suite, dir))], { encoding: 'utf8' });
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  const pass = (out.match(/^PASS /gm) ?? []).length;
  const fail = (out.match(/^FAIL /gm) ?? []).length;
  const skipped = /^SKIP /m.test(out);
  // A suite can die before printing anything — a bad import, a missing file. Without this it
  // contributes no failures and the summary cheerfully reports zero.
  const crashed = res.status !== 0 && fail === 0;

  results.push({ label, pass, fail, skipped, crashed, code: res.status, out });

  const status = skipped ? 'SKIP'
    : crashed ? 'CRASHED — suite did not run'
    : res.status === 0 ? `${String(pass).padStart(3)} passed`
    : `${fail} FAILED of ${pass + fail}`;
  console.log(`${label.padEnd(16)} ${status}`);

  // only surface the detail when something is wrong; a green run stays quiet
  if (res.status !== 0 || skipped) {
    for (const line of out.split('\n')) {
      if (/^(FAIL|SKIP) /.test(line) || (res.status !== 0 && !/^PASS /.test(line) && line.trim())) {
        console.log(`  ${line}`);
      }
    }
  }
}

const totalPass = results.reduce((n, r) => n + r.pass, 0);
const totalFail = results.reduce((n, r) => n + r.fail, 0);
const failedSuites = results.filter(r => r.code !== 0);

console.log('─'.repeat(40));
const crashes = results.filter(r => r.crashed).length;
console.log(`${totalPass} passed, ${totalFail} failed, ${results.filter(r => r.skipped).length} skipped`
  + (crashes ? `, ${crashes} CRASHED` : ''));
process.exit(failedSuites.length ? 1 : 0);
