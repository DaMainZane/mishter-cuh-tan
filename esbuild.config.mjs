import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, watch as fsWatch } from 'node:fs';

const watching = process.argv.includes('--watch');

// Static files (index.html etc.) and the client stylesheet. The client script is bundled below.
function copyStatic() {
  mkdirSync('dist/public', { recursive: true });
  cpSync('public', 'dist/public', { recursive: true });
  cpSync('src/client/styles.css', 'dist/public/app.css');
}

let child = null;
const startChild = () => {
  child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], { stdio: 'inherit' });
};
const restartServer = {
  name: 'restart-server',
  setup(b) {
    b.onEnd(result => {
      if (result.errors.length > 0) return;
      if (child && child.exitCode === null && !child.killed) {
        const prev = child;
        child = null;
        prev.once('exit', () => startChild());
        prev.kill('SIGTERM');
      } else {
        startChild();
      }
    });
  }
};

const serverOptions = {
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  packages: 'external', // express / socket.io stay in node_modules
  sourcemap: true,
  logLevel: 'info',
  plugins: watching ? [restartServer] : []
};

const browserNodeShimPlugin = {
  name: 'browser-node-shim',
  setup(b) {
    b.onResolve({ filter: /^(node:)?fs$/ }, () => ({
      path: 'fs',
      namespace: 'browser-node-shim'
    }));
    b.onResolve({ filter: /^(node:)?path$/ }, () => ({
      path: 'path',
      namespace: 'browser-node-shim'
    }));
    b.onLoad({ filter: /^fs$/, namespace: 'browser-node-shim' }, () => ({
      contents: `
        const PREFIX = 'hex_fs:';
        const store = new Map();
        const getItem = (k) => {
          try { return localStorage.getItem(PREFIX + k) ?? store.get(k) ?? null; } catch { return store.get(k) ?? null; }
        };
        const setItem = (k, v) => {
          store.set(k, String(v));
          try { localStorage.setItem(PREFIX + k, String(v)); } catch {}
        };
        const existsSync = (p) => getItem(p) !== null;
        const readFileSync = (p) => {
          const val = getItem(p);
          if (val === null) throw new Error('ENOENT: ' + p);
          return val;
        };
        const writeFileSync = (p, data) => setItem(p, data);
        const mkdirSync = () => {};
        const readdirSync = (dir) => {
          const clean = String(dir).replace(/\\/+$/, '') + '/';
          const out = new Set();
          for (const k of store.keys()) {
            if (k.startsWith(clean)) out.add(k.slice(clean.length).split('/')[0]);
          }
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const rawKey = localStorage.key(i) || '';
              if (rawKey.startsWith(PREFIX + clean)) {
                out.add(rawKey.slice((PREFIX + clean).length).split('/')[0]);
              }
            }
          } catch {}
          return [...out];
        };
        const promises = {
          mkdir: async () => {},
          appendFile: async () => {}
        };
        export default { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, promises };
        export { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, promises };
      `,
      loader: 'js'
    }));
    b.onLoad({ filter: /^path$/, namespace: 'browser-node-shim' }, () => ({
      contents: `
        const join = (...parts) => parts.filter(Boolean).join('/').replace(/\\/+/g, '/');
        export default { join, resolve: join };
        export { join, join as resolve };
      `,
      loader: 'js'
    }));
  }
};

const hostOptions = {
  entryPoints: ['src/server/p2pHost.ts'],
  outfile: 'dist/public/host.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: 'globalThis.process = globalThis.process || { cwd: () => "/", env: {} };'
  },
  plugins: [browserNodeShimPlugin]
};

const clientOptions = {
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info'
};

copyStatic();

if (watching) {
  const hostCtx = await context(hostOptions);
  await hostCtx.rebuild();
  await hostCtx.watch();
  const clientCtx = await context(clientOptions);
  await clientCtx.rebuild();
  await clientCtx.watch();
  const serverCtx = await context(serverOptions);
  await serverCtx.watch();
  const recopy = () => {
    try { copyStatic(); } catch (e) { console.error(e); }
  };
  fsWatch('public', { recursive: true }, recopy);
  fsWatch('src/client/styles.css', recopy);
  const cleanup = () => {
    if (child && child.exitCode === null && !child.killed) {
      child.once('exit', () => process.exit(0));
      child.kill('SIGTERM');
      setTimeout(() => process.exit(0), 300).unref();
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
} else {
  await build(serverOptions);
  await build(hostOptions);
  await build(clientOptions);
}
