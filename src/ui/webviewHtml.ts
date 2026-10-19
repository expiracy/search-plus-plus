import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function webviewHtml(webview: vscode.Webview, resources: vscode.Uri): string {
  const nonce = randomBytes(18).toString('base64');
  const css = attribute(webview.asWebviewUri(vscode.Uri.joinPath(resources, 'search.css')).toString());
  const script = attribute(webview.asWebviewUri(vscode.Uri.joinPath(resources, 'search.js')).toString());
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${attribute(webview.cspSource)}; font-src ${attribute(webview.cspSource)}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${css}"><title>search++</title></head>
    <body><main id="app"></main><script nonce="${nonce}" src="${script}" defer></script></body></html>`;
}
function attribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
