import * as path from 'path';
import { runTests } from '@vscode/test-electron';

// Downloads a real VS Code (stable) and launches it headless with this repo as
// --extensionDevelopmentPath, then executes integration/suite.ts inside it.
// Run via scripts/vm-itest.cmd (Docker + xvfb on the VM Lab) — never natively.
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite.js');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-workspace-trust',
      '--disable-extensions',
    ],
  });
}

main().catch((err) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
