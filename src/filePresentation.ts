import path from 'path';
import * as vscode from 'vscode';

/** Match Quick Open's filename, parent folder, and themed resource icon. */
export function filePresentation(displayPath: string, uri: vscode.Uri) {
  const paths = displayPath.includes('\\') || /^[A-Za-z]:[/\\]/.test(displayPath) ? path.win32 : path.posix;
  const directory = paths.dirname(displayPath);
  return {
    label: paths.basename(displayPath) || displayPath,
    description: directory === '.' ? '' : directory,
    iconPath: vscode.ThemeIcon.File,
    resourceUri: uri,
  };
}
