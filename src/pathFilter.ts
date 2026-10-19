import * as vscode from 'vscode';
import picomatch from 'picomatch';

export type PathFilter = (uri: vscode.Uri) => boolean;

/** Compile once per request; providers apply the predicate before their result limit. */
export function compilePathFilter(pattern: string, useRegex: boolean, roots: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []): PathFilter | undefined {
  pattern = pattern.trim();
  if (!pattern) return undefined;
  const expression = useRegex ? new RegExp(pattern) : undefined;
  const includes = expression ? [] : splitIncludes(pattern.replace(/\\/g, '/')).map(include => {
    const anchored = include.startsWith('./');
    const path = include.replace(/^\.\//, '').replace(/\/$/, '');
    const prefix = anchored ? '' : '**/';
    const match = picomatch([`${prefix}${path}`, `${prefix}${path}/**`], {
      dot: true, nonegate: true, noext: true,
      nocase: process.platform === 'win32' || process.platform === 'darwin',
    });
    const qualified = anchored && roots.length > 1 && roots.some(root => path === root.name || path.startsWith(root.name + '/'));
    return { match, qualified };
  });
  const sortedRoots = [...roots].sort((a, b) => b.uri.path.length - a.uri.path.length);
  return uri => {
    const root = sortedRoots.find(root => {
      const base = root.uri.path.replace(/\/$/, '');
      return uri.scheme === root.uri.scheme && uri.authority === root.uri.authority
        && (uri.path === base || uri.path.startsWith(base + '/'));
    });
    if (!root) return false;
    const relative = uri.path.slice(root.uri.path.replace(/\/$/, '').length).replace(/^\//, '');
    if (expression) return expression.test(relative);
    return includes.some(({ match, qualified }) => match(qualified ? `${root.name}/${relative}` : relative));
  };
}

function splitIncludes(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if ('{['.includes(value[i])) depth++;
    else if ('}]'.includes(value[i])) depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}
