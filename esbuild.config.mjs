import * as esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', '@vscode/ripgrep'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

const webviewOptions = {
  entryPoints: ['src/webview/search.ts'],
  bundle: true,
  outfile: 'dist/webview/search.js',
  platform: 'browser',
  target: 'chrome128',
  loader: { '.ttf': 'file' },
  sourcemap: !isProduction,
  minify: isProduction,
};

for (const options of [buildOptions, webviewOptions]) {
  if (isWatch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else await esbuild.build(options);
}

const notices = [
  ['@vscode/codicons', 'LICENSE'], ['picomatch', 'LICENSE'],
  ['fzf', 'license.txt'], ['ignore', 'LICENSE-MIT'],
];
let noticeText = 'Third-party components bundled with search++\n';
for (const [name, license] of notices) {
  const base = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${base}/package.json`, 'utf8'));
  const source = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
  noticeText += `\n${name} ${metadata.version}\nSource: ${source}\n`;
  if (name === '@vscode/codicons') noticeText += 'Copyright Microsoft Corporation. Icons unchanged; CSS bundled and minified.\n';
  noticeText += await readFile(`${base}/${license}`, 'utf8');
  noticeText += '\n';
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', noticeText);
console.log(isWatch ? '[search++] Watching for changes...' : '[search++] Build complete.');
