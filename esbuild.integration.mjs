import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: {
    runTest: 'integration/runTest.ts',
    suite: 'integration/suite.ts',
    runShots: 'integration/runShots.ts',
    shots: 'integration/shots.ts',
    runHero: 'integration/runHero.ts',
    hero: 'integration/hero.ts',
  },
  bundle: true,
  outdir: 'out-integration',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: false,
  logLevel: 'info',
});
