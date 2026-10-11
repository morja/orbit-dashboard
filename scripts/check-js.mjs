/*
 * Frontend checks without dependencies: `npm run check` or `node scripts/check-js.mjs`.
 * 1. Every module in static/js parses.
 * 2. Every literal passed to t() or tHtml() has a German translation.
 * 3. German entries that no source file mentions are reported as unused.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = (folder, extension) => readdirSync(join(root, folder), { recursive: true })
  .filter((name) => name.endsWith(extension))
  .map((name) => join(root, folder, name));

let failed = false;

const modules = files('static/js', '.js');
for (const file of modules) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr.trim());
  }
}

const { default: german } = await import(join(root, 'static/js/locales/de.js'));

// String literals in single or double quotes, with escaped quotes resolved.
const literals = (source) => [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)]
  .map((match) => (match[1] ?? match[2]).replace(/\\(.)/g, '$1'));

const missing = new Set();
const sources = [];
for (const file of modules.filter((name) => !name.includes('locales'))) {
  const source = readFileSync(file, 'utf8');
  sources.push(source);
  for (const match of source.matchAll(/\bt(?:Html)?\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) {
    const key = literals(match[1])[0];
    if (!(key in german)) missing.add(`${relative(root, file)}: ${key}`);
  }
}

// Static page text, and messages that the Python backend sends to the page.
for (const file of ['static/index.html', 'server.py', 'orbit_config.py', 'remote_probe.py', 'local_services.py']) sources.push(readFileSync(join(root, file), 'utf8'));
const allSources = sources.join('\n');
const unused = Object.keys(german).filter((key) => !key.includes('{') && !allSources.includes(key) && !allSources.includes(key.replace(/'/g, "\\'")));

if (missing.size) {
  failed = true;
  console.error('Missing German translations:\n  ' + [...missing].join('\n  '));
}
if (unused.length) console.warn('German entries not found in the sources (check before removing):\n  ' + unused.join('\n  '));
console.log(`${modules.length} modules checked${failed ? ' with errors' : ', translations complete'}.`);
process.exitCode = failed ? 1 : 0;
