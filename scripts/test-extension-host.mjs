import { build } from 'esbuild';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'search-plus-plus-host-'));
try {
  await build({ entryPoints: [path.join(root, 'test/extensionHost.ts')], outfile: path.join(root, 'dist/extensionHost.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode', '@vscode/ripgrep'] });
  const workspace = path.join(temporary, 'workspace');
  await cp(path.join(root, 'test/fixtures/mock-project'), workspace, { recursive: true });
  const environment = { ...process.env };
  const report = path.join(temporary, 'report.json');
  environment.SEARCH_PLUS_PLUS_HOST_REPORT = report;
  delete environment.ELECTRON_RUN_AS_NODE;
  const launchArgs = [
    '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-gpu',
    `--user-data-dir=${path.join(temporary, 'user-data')}`, `--extensions-dir=${path.join(temporary, 'extensions')}`,
  ];
  if (process.env.VSCODE_VERSION) {
    const { runTests } = await import('@vscode/test-electron');
    await runTests({
      version: process.env.VSCODE_VERSION,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'dist/extensionHost.cjs'),
      extensionTestsEnv: environment,
      launchArgs: [workspace, ...launchArgs],
    });
  } else {
    const executable = process.env.VSCODE_EXECUTABLE_PATH ?? (process.platform === 'darwin'
      ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'code');
    const child = spawn(executable, [
      '--new-window', '--wait', ...launchArgs,
      `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(root, 'dist/extensionHost.cjs')}`, workspace,
    ], { env: environment, stdio: 'inherit' });
    const timeout = setTimeout(() => { child.kill(); }, 60000);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => resolve(code ?? 1));
      });
    } finally { clearTimeout(timeout); }
  }
  if (!process.exitCode) {
    const result = JSON.parse(await readFile(report, 'utf8'));
    console.log(`VS Code ${result.version}: ${result.checks} passed.`);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
