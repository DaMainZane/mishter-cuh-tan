#!/usr/bin/env node
// Alignment check between ARCHITECTURE.md (the concept map) and INDEX.md (the file list).
//
//   npm run mindmap          report: files per domain, plus every problem found
//   npm run mindmap:check    same, and exit 1 when anything is out of line (CI form, run by tests/mindmap.test.ts)
//
// How it works
// - INDEX.md is read for every `src/` file (the sections headed `src/<dir>/`; the row name is joined to the heading's directory).
// - ARCHITECTURE.md lists the files each domain owns in fenced blocks marked ```owns, one entry per line:
//     src/shared/topology.ts      an exact file
//     src/client/*                every file directly in that folder
//     src/server/bots/**          every file under that folder, at any depth
//   A `#` starts a comment. The domain is the nearest `## ` heading above the block.
// - An exact entry beats a folder entry, so a domain can take one file out of a folder another domain owns whole.
// Problems it reports: a src file in INDEX that no domain owns, a file claimed twice, an entry that names a file that is not in INDEX
// (and says whether the file exists on disk), a folder entry that matches nothing, and ARCHITECTURE.md missing from the Docs table of INDEX.md.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = process.cwd();
const indexPath = path.resolve(root, opt('--index', 'INDEX.md'));
const archPath = path.resolve(root, opt('--arch', 'ARCHITECTURE.md'));
const srcRoot = path.dirname(indexPath);

function readIndexFiles(text) {
  const files = [];
  let dir = null;
  for (const raw of text.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+`([^`]+)`/.exec(raw);
    if (heading) {
      dir = heading[1].startsWith('src/') ? heading[1].replace(/\/?$/, '/') : null;
      continue;
    }
    if (/^#{1,3}\s/.test(raw)) {
      dir = null;
      continue;
    }
    if (!dir) continue;
    const row = /^\|\s*`([^`]+)`\s*\|/.exec(raw);
    if (row) files.push(dir + row[1]);
  }
  return files;
}

function readOwns(text) {
  const domains = [];
  let current = null;
  let inOwns = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!inOwns) {
      const h = /^##\s+(.*)$/.exec(line);
      if (h && !line.startsWith('###')) {
        current = { name: h[1].replace(/^\d+[.)]\s*/, '').trim(), entries: [] };
        domains.push(current);
        continue;
      }
      if (/^```owns\s*$/.test(line)) inOwns = true;
      continue;
    }
    if (/^```\s*$/.test(line)) {
      inOwns = false;
      continue;
    }
    const entry = line.replace(/#.*$/, '').trim();
    if (entry && current) current.entries.push(entry);
  }
  return domains.filter(d => d.entries.length > 0);
}

const problems = [];
const indexText = fs.readFileSync(indexPath, 'utf8');
const indexFiles = readIndexFiles(indexText);
const indexSet = new Set(indexFiles);

if (!fs.existsSync(archPath)) {
  console.log(`ARCHITECTURE.md not found at ${archPath}`);
  process.exit(check ? 1 : 0);
}
const domains = readOwns(fs.readFileSync(archPath, 'utf8'));

const exactClaims = new Map();
for (const d of domains) {
  for (const e of d.entries) {
    if (e.endsWith('/*') || e.endsWith('/**')) continue;
    if (!exactClaims.has(e)) exactClaims.set(e, []);
    exactClaims.get(e).push(d.name);
  }
}

const owner = new Map();
for (const [file, names] of exactClaims) {
  if (!indexSet.has(file)) {
    const onDisk = fs.existsSync(path.resolve(srcRoot, file));
    problems.push(
      onDisk
        ? `${file}: owned by "${names[0]}" but missing from INDEX.md (run npm run index)`
        : `${file}: owned by "${names[0]}" but the file does not exist`
    );
    continue;
  }
  if (names.length > 1) problems.push(`${file}: claimed by more than one domain (${names.join(', ')})`);
  owner.set(file, names[0]);
}

for (const d of domains) {
  for (const e of d.entries) {
    const deep = e.endsWith('/**');
    if (!deep && !e.endsWith('/*')) continue;
    const prefix = e.slice(0, e.length - (deep ? 2 : 1));
    const matched = indexFiles.filter(f => f.startsWith(prefix) && (deep || !f.slice(prefix.length).includes('/')));
    if (matched.length === 0) problems.push(`${e}: owned by "${d.name}" but matches no file in INDEX.md`);
    for (const f of matched) {
      if (exactClaims.has(f)) continue;
      if (owner.has(f) && owner.get(f) !== d.name) {
        problems.push(`${f}: claimed by two folder entries (${owner.get(f)}, ${d.name})`);
        continue;
      }
      owner.set(f, d.name);
    }
  }
}

for (const f of indexFiles) {
  if (!owner.has(f)) problems.push(`${f}: in INDEX.md but no domain in ARCHITECTURE.md owns it`);
}
if (!indexText.includes('`ARCHITECTURE.md`')) problems.push('INDEX.md: the Docs table has no row for `ARCHITECTURE.md`');

const counts = new Map();
for (const d of domains) counts.set(d.name, 0);
for (const name of owner.values()) counts.set(name, (counts.get(name) ?? 0) + 1);

if (problems.length === 0) {
  console.log(`ARCHITECTURE.md is aligned with INDEX.md (${indexFiles.length} src files, ${domains.length} domains)`);
  if (!check) for (const [name, n] of counts) console.log(`  ${String(n).padStart(3)}  ${name}`);
  process.exit(0);
}
console.log(`ARCHITECTURE.md is out of line with INDEX.md (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
for (const p of problems) console.log(`  - ${p}`);
console.log('Fix: add the file to the domain that owns it in ARCHITECTURE.md (an ```owns block), or run `npm run index` if INDEX.md is stale.');
process.exit(check ? 1 : 0);
