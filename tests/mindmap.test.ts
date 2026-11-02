// MODULE: concept-map guard: ARCHITECTURE.md owns every src file listed in INDEX.md, and names no file that is gone (npm run mindmap:check)
// Runs scripts/mindmap.mjs --check, then runs it on small fixtures to prove each kind of problem is reported.
// Fix: add the file to its domain's ```owns block in ARCHITECTURE.md, or run `npm run index` when INDEX.md is stale.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve(process.cwd(), 'scripts', 'mindmap.mjs');

describe('ARCHITECTURE.md', () => {
  it('owns every src file in INDEX.md and names no file that is gone', () => {
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(run.stdout, 'mindmap.mjs output').toContain('ARCHITECTURE.md is aligned with INDEX.md');
    expect(run.status).toBe(0);
  });

  it('reports an unowned file, a double claim, a stale entry, a dead folder entry and a missing Docs row', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-'));
    try {
      const index = [
        '## Docs',
        '| File | What |',
        '| `README.md` | x |',
        '',
        '## `src/shared/` (pure engine)',
        '| File | What |',
        '|---|---|',
        '| `a.ts` | a |',
        '| `b.ts` | b |',
        '| `c.ts` | c |',
        '',
        '### `src/server/bots/`',
        '| `brain.ts` | brain |',
        '| `dialogue/index.ts` | chat |',
        ''
      ].join('\n');
      const arch = (body: string) => `# Architecture\n\n## 1. One\n\`\`\`owns\n${body}\n\`\`\`\n`;
      const runCheck = () =>
        spawnSync(
          process.execPath,
          [script, '--check', '--index', path.join(tmp, 'INDEX.md'), '--arch', path.join(tmp, 'ARCHITECTURE.md')],
          { encoding: 'utf8' }
        );
      const run = (body: string, indexText = index) => {
        fs.writeFileSync(path.join(tmp, 'INDEX.md'), indexText);
        fs.writeFileSync(path.join(tmp, 'ARCHITECTURE.md'), arch(body));
        return runCheck();
      };
      const docsRow = index.replace('| `README.md` | x |', '| `README.md` | x |\n| `ARCHITECTURE.md` | map |');

      // Everything owned, folder entries of both kinds, Docs row present: aligned.
      const ok = run('src/shared/*\nsrc/server/bots/**  # whole folder', docsRow);
      expect(ok.status, ok.stdout).toBe(0);
      expect(ok.stdout).toContain('aligned');

      // Unowned file, and the Docs row is missing.
      const unowned = run('src/shared/a.ts\nsrc/shared/b.ts\nsrc/server/bots/**');
      expect(unowned.status).toBe(1);
      expect(unowned.stdout).toContain('src/shared/c.ts: in INDEX.md but no domain');
      expect(unowned.stdout).toContain('no row for `ARCHITECTURE.md`');

      // A stale entry and a folder entry that matches nothing.
      const stale = run('src/shared/*\nsrc/server/bots/**\nsrc/shared/gone.ts\nsrc/nothing/*', docsRow);
      expect(stale.status).toBe(1);
      expect(stale.stdout).toContain('src/shared/gone.ts: owned by "One" but the file does not exist');
      expect(stale.stdout).toContain('src/nothing/*: owned by "One" but matches no file');

      // An exact entry beats a folder entry (no double claim), but the same exact entry in two domains is one.
      const twoDomains = `# A\n\n## 1. One\n\`\`\`owns\nsrc/shared/*\nsrc/server/bots/**\nsrc/shared/a.ts\n\`\`\`\n\n## 2. Two\n\`\`\`owns\nsrc/shared/a.ts\n\`\`\`\n`;
      fs.writeFileSync(path.join(tmp, 'INDEX.md'), docsRow);
      fs.writeFileSync(path.join(tmp, 'ARCHITECTURE.md'), twoDomains);
      const dup = runCheck();
      expect(dup.status).toBe(1);
      expect(dup.stdout).toContain('src/shared/a.ts: claimed by more than one domain');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
