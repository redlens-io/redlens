import * as fs from 'fs';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * The screenshot suite, with RedLens Pro loaded alongside the free extension
 * when it is present.
 *
 * Four captures drive paid panels — the performance dashboard, the table
 * advisor, query monitoring and effective access — and a fifth, the maximized
 * CloudWatch row, depends on the first. Loading only the free package meant
 * those five could never be taken, so the manual carried whatever the last run
 * that happened to have Pro produced, and nothing said which ones were stale.
 *
 * `extensionDevelopmentPath` takes an array, which is how VS Code's own tests
 * load a dependent pair — the same thing the bridge smoke test does. Pro is
 * still optional: a workspace without it, or with it unbuilt, falls back to the
 * free package alone and the harness reports the captures it had to skip.
 */
async function main(): Promise<void> {
  const basePath = path.resolve(__dirname, '..');
  const proPath = path.resolve(basePath, '../pro');
  const withPro = fs.existsSync(path.join(proPath, 'dist', 'extension.js'));
  if (!withPro) {
    console.error('shots: RedLens Pro is not built — the paid captures will be skipped.');
  }

  await runTests({
    extensionDevelopmentPath: withPro ? [basePath, proPath] : basePath,
    extensionTestsPath: path.resolve(__dirname, 'shots.js'),
    launchArgs: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-workspace-trust', '--disable-extensions'],
  });
}

main().catch((err) => {
  console.error('Screenshot run failed:', err);
  process.exit(1);
});
