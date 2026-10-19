import { mountSearchView } from './renderer';
import type { ClientMessage } from '../ui/protocol';
import '@vscode/codicons/dist/codicon.css';
import './search.css';
declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };
mountSearchView(document.getElementById('app')!, acquireVsCodeApi());
