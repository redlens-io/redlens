import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  await runTests({
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.resolve(__dirname, 'hero.js'),
    launchArgs: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-workspace-trust', '--disable-extensions'],
  });
}

main().catch((err) => {
  console.error('Hero run failed:', err);
  process.exit(1);
});
