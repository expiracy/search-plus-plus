export function extractReleaseNotes(changelog, version) {
  const source = changelog.replace(/\r\n?/g, '\n');
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  const index = headings.findIndex(heading => heading[1].trim().split(/\s+/)[0] === version);
  if (index < 0) throw new Error(`No changelog section for ${version}. Add release notes before publishing.`);
  const start = headings[index].index + headings[index][0].length;
  const end = headings[index + 1]?.index ?? source.length;
  const notes = source.slice(start, end).trim();
  if (!notes) throw new Error(`Changelog section for ${version} is empty. Add release notes before publishing.`);
  return notes + '\n';
}
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  process.stdout.write(extractReleaseNotes(changelog, process.env.RELEASE_VERSION ?? process.argv[2]));
}
