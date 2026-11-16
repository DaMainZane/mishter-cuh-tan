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
  await build(clientOptions);
}
