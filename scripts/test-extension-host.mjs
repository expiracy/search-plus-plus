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
  const executable = process.env.VSCODE_EXECUTABLE_PATH ?? (process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' : 'code');
  const environment = { ...process.env };
  const report = path.join(temporary, 'report.json');
  environment.SEARCH_PLUS_PLUS_HOST_REPORT = report;
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [
    '--new-window', '--wait', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    `--user-data-dir=${path.join(temporary, 'user-data')}`, `--extensions-dir=${path.join(temporary, 'extensions')}`,
    `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(root, 'dist/extensionHost.cjs')}`, workspace,
  ], { env: environment, stdio: 'inherit' });
  const timeout = setTimeout(() => { child.kill(); }, 60000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => resolve(code ?? 1));
    });
    if (process.exitCode === 0) {
      const result = JSON.parse(await readFile(report, 'utf8'));
      console.log(`VS Code ${result.version}: ${result.checks} passed.`);
    }
  } finally { clearTimeout(timeout); }
} finally { await rm(temporary, { recursive: true, force: true }); }
