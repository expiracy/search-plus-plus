import * as vscode from 'vscode';
import { DEFAULT_SECTIONS } from './providers/types';
import { getEnabledSections } from './utils';

export async function migrateEverythingSettings(): Promise<void> {
  for (const [scope, target] of [
    ['globalValue', vscode.ConfigurationTarget.Global],
    ['workspaceValue', vscode.ConfigurationTarget.Workspace],
  ] as const) {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const previous = config.inspect('everywhere.sections')?.[scope];
    if (previous === undefined) continue;
    const selected = getEnabledSections(previous);
    const label = (section: string) => section[0].toUpperCase() + section.slice(1);
    if (config.inspect('everything.sources')?.[scope] === undefined) {
      await config.update('everything.sources', Object.fromEntries(DEFAULT_SECTIONS.map(section =>
        [label(section), selected.includes(section)])), target);
    }
    if (config.inspect('everything.order')?.[scope] === undefined) {
      await config.update('everything.order', [...new Set([...selected, ...DEFAULT_SECTIONS])].map(label), target);
    }
    await config.update('everywhere.sections', undefined, target);
  }
}
