import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// The MCP server introduces itself to every client with this. Injected rather
// than written in the source so it cannot drift from the shipped extension —
// it did, for the whole of 0.x.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// Extension host bundle (vscode provided by the runtime).
const extensionCtx = await esbuild.context({
  ...common,
  entryPoints: { extension: 'src/extension.ts' },
  outdir: 'dist',
  // ssh2 lazy-requires these native speedups inside try/catch and works without
  // them; keep them external so esbuild does not choke on the optional bindings.
  external: ['vscode', 'pg-native', 'cpu-features', './crypto/build/Release/sshcrypto.node'],
});

// Embedded MCP server: separate stdio child process, no vscode dependency.
const mcpCtx = await esbuild.context({
  ...common,
  entryPoints: { 'mcp-server': 'mcp-server/index.ts' },
  outdir: 'dist',
  define: { __REDLENS_VERSION__: JSON.stringify(version) },
});

// Webview bundles: browser target, IIFE (loaded via <script nonce>).
const webviewCtx = await esbuild.context({
  ...common,
  entryPoints: { 'webview/grid': 'webview/grid/main.ts' },
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
});

if (watch) {
  await Promise.all([extensionCtx.watch(), mcpCtx.watch(), webviewCtx.watch()]);
} else {
  await extensionCtx.rebuild();
  await mcpCtx.rebuild();
  await webviewCtx.rebuild();
  await Promise.all([extensionCtx.dispose(), mcpCtx.dispose(), webviewCtx.dispose()]);
}
