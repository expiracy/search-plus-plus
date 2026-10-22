import { cp, readFile, rm, writeFile } from 'node:fs/promises';

/** Assembles the GitHub Pages site in _site/ from site/ and media/, stamped with the package version. */
const root = new URL('../', import.meta.url);
const out = new URL('_site/', root);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

await rm(out, { recursive: true, force: true });
await cp(new URL('site/', root), out, { recursive: true });
await cp(new URL('media/', root), new URL('media/', out), { recursive: true });

const index = new URL('index.html', out);
await writeFile(index, (await readFile(index, 'utf8')).replaceAll('{{version}}', version));
console.log(`Built the search++ ${version} site in _site/.`);
