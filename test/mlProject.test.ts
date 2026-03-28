import { describe, test, expect, vi, beforeAll } from 'vitest';
import path from 'path';

// Simulates an ML project (like ppg-sleep-stage-classifier) with:
// - Multiple nested .gitignore files
// - Large output/checkpoint files in gitignored directories
// - Regression test: gitignored dirs like outputs/ must be discoverable in "everything mode"

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/ml-project').replace(/\\/g, '/');

// --- .gitignore file definitions ---

const GITIGNORE_FILES: Array<{ path: string; content: string }> = [
  {
    path: '.gitignore',
    content: [
      '# Model outputs & checkpoints',
      'outputs/',
      '',
      '# Raw data (large)',
      'data/raw/',
      '',
      '# Model weights',
      '*.ckpt',
      '*.pt',
      '*.h5',
      '',
      '# Python',
      '__pycache__/',
      '*.pyc',
      '',
      '# Environment',
      '.env',
    ].join('\n'),
  },
  {
    path: 'src/.gitignore',
    content: '*.log\n',
  },
  {
    path: 'notebooks/.gitignore',
    content: '.ipynb_checkpoints/\n',
  },
];

// --- File definitions ---

const TRACKED_FILES = [
  'README.md',
  'requirements.txt',
  'setup.py',
  'config.yaml',
  'src/train.py',
  'src/evaluate.py',
  'src/models/resnet.py',
  'src/models/transformer.py',
  'src/data/loader.py',
  'src/data/preprocess.py',
  'src/utils/metrics.py',
  'src/utils/logging.py',
  'notebooks/exploration.ipynb',
  'notebooks/analysis.ipynb',
  'scripts/run_training.sh',
  'scripts/download_data.sh',
  'data/processed/features.csv',
  'data/splits/train.txt',
  'data/splits/val.txt',
];

const IGNORED_FILES = [
  '.env',
  // Large checkpoint/model files in outputs/
  'outputs/checkpoints/epoch_10.ckpt',
  'outputs/checkpoints/epoch_20.ckpt',
  'outputs/checkpoints/best.ckpt',
  'outputs/logs/training.log',
  'outputs/logs/eval.log',
  'outputs/predictions/test_preds.csv',
  'outputs/models/final_model.pt',
  'outputs/models/exported.h5',
  // Raw data files
  'data/raw/subject_001.edf',
  'data/raw/subject_002.edf',
  'data/raw/annotations.csv',
  // Python caches
  '__pycache__/train.cpython-311.pyc',
  'src/__pycache__/models.cpython-311.pyc',
  // Notebook checkpoints
  'notebooks/.ipynb_checkpoints/exploration-checkpoint.ipynb',
  // Nested gitignore pattern
  'src/debug.log',
];

const ALL_FILES = [
  ...TRACKED_FILES,
  ...IGNORED_FILES,
  ...GITIGNORE_FILES.map(g => g.path),
];

// --- Mock vscode ---

vi.doMock('vscode', async () => {
  const base: any = await import('./__mocks__/vscode');
  const rootUri = base.Uri.file(FIXTURE_ROOT);

  base.workspace.workspaceFolders = [{ uri: rootUri, name: 'ml-project', index: 0 }];

  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = FIXTURE_ROOT + '/';
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    if (normalized === FIXTURE_ROOT || normalized === FIXTURE_ROOT + '/.') {
      return 'ml-project';
    }
    return normalized;
  };

  base.workspace.findFiles = async (pattern: string) => {
    if (pattern === '**/.gitignore') {
      return GITIGNORE_FILES.map((g: any) => base.Uri.file(`${FIXTURE_ROOT}/${g.path}`));
    }
    if (pattern === '**/*') {
      return ALL_FILES.map((f: string) => base.Uri.file(`${FIXTURE_ROOT}/${f}`));
    }
    return [];
  };

  const gitignoreContents = new Map<string, string>();
  for (const g of GITIGNORE_FILES) {
    const fullPath = `${FIXTURE_ROOT}/${g.path}`;
    gitignoreContents.set(fullPath, g.content);
    gitignoreContents.set(fullPath.replace(/\//g, '\\'), g.content);
  }

  base.workspace.fs = {
    readFile: async (uri: any) => {
      const p = (uri.fsPath ?? uri.path).replace(/\\/g, '/');
      const content = gitignoreContents.get(p) ?? gitignoreContents.get(uri.fsPath) ?? '';
      return new TextEncoder().encode(content);
    },
    stat: async () => ({}),
  };

  base.workspace.getConfiguration = (section?: string) => ({
    get: <T>(_key: string, defaultVal: T): T => {
      if (section === 'files' || section === 'search') return {} as T;
      return defaultVal;
    },
  });

  return base;
});

const { Uri } = await import('./__mocks__/vscode');
const { GitIgnoreManager } = await import('../src/gitignore');
const { FileIndex } = await import('../src/index/fileIndex');
const { extractFolders } = await import('../src/providers/folderExtractor');
const { SearchMode } = await import('../src/providers/types');

describe('ML project: everything mode regression', () => {
  let gitIgnore: InstanceType<typeof GitIgnoreManager>;
  let index: InstanceType<typeof FileIndex>;

  beforeAll(async () => {
    gitIgnore = new GitIgnoreManager();
    await gitIgnore.load();
    index = new FileIndex(gitIgnore as any);
    const makeEntry = (relativePath: string) => ({ relativePath, uri: Uri.file(`${FIXTURE_ROOT}/${relativePath}`) });
    const filtered = [...TRACKED_FILES, ...GITIGNORE_FILES.map(g => g.path)].map(makeEntry);
    const unfiltered = ALL_FILES.map(makeEntry);
    index.buildFromEntries(filtered, unfiltered);
  });

  // ── GitIgnoreManager ──────────────────────────────────────────────────

  describe('GitIgnoreManager', () => {
    test('outputs/ directory contents are ignored', () => {
      expect(gitIgnore.isIgnored('outputs/checkpoints/epoch_10.ckpt')).toBe(true);
      expect(gitIgnore.isIgnored('outputs/checkpoints/best.ckpt')).toBe(true);
      expect(gitIgnore.isIgnored('outputs/logs/training.log')).toBe(true);
      expect(gitIgnore.isIgnored('outputs/predictions/test_preds.csv')).toBe(true);
      expect(gitIgnore.isIgnored('outputs/models/final_model.pt')).toBe(true);
      expect(gitIgnore.isIgnored('outputs/models/exported.h5')).toBe(true);
    });

    test('data/raw/ contents are ignored', () => {
      expect(gitIgnore.isIgnored('data/raw/subject_001.edf')).toBe(true);
      expect(gitIgnore.isIgnored('data/raw/subject_002.edf')).toBe(true);
      expect(gitIgnore.isIgnored('data/raw/annotations.csv')).toBe(true);
    });

    test('__pycache__/ contents are ignored', () => {
      expect(gitIgnore.isIgnored('__pycache__/train.cpython-311.pyc')).toBe(true);
      expect(gitIgnore.isIgnored('src/__pycache__/models.cpython-311.pyc')).toBe(true);
    });

    test('nested gitignore: src/*.log is ignored', () => {
      expect(gitIgnore.isIgnored('src/debug.log')).toBe(true);
    });

    test('nested gitignore: .ipynb_checkpoints/ is ignored', () => {
      expect(gitIgnore.isIgnored('notebooks/.ipynb_checkpoints/exploration-checkpoint.ipynb')).toBe(true);
    });

    test('.env is ignored', () => {
      expect(gitIgnore.isIgnored('.env')).toBe(true);
    });

    test('tracked source files are NOT ignored', () => {
      expect(gitIgnore.isIgnored('src/train.py')).toBe(false);
      expect(gitIgnore.isIgnored('src/models/resnet.py')).toBe(false);
      expect(gitIgnore.isIgnored('src/data/loader.py')).toBe(false);
      expect(gitIgnore.isIgnored('notebooks/exploration.ipynb')).toBe(false);
      expect(gitIgnore.isIgnored('data/processed/features.csv')).toBe(false);
      expect(gitIgnore.isIgnored('data/splits/train.txt')).toBe(false);
      expect(gitIgnore.isIgnored('scripts/run_training.sh')).toBe(false);
      expect(gitIgnore.isIgnored('config.yaml')).toBe(false);
    });

  });

  // ── FileIndex: everything mode ────────────────────────────────────────

  describe('FileIndex: everything mode', () => {
    test('fileCount only includes tracked files + gitignore files', () => {
      const expected = TRACKED_FILES.length + GITIGNORE_FILES.length;
      expect(index.fileCount).toBe(expected);
    });

    test('excludeGitIgnored=true: no outputs/ files', () => {
      const results = index.find('', 1000, true);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.every(p => !p.startsWith('outputs/'))).toBe(true);
    });

    test('excludeGitIgnored=false: outputs/ files are present', () => {
      const results = index.find('', 1000, false);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.some(p => p.startsWith('outputs/'))).toBe(true);
      expect(paths.some(p => p.includes('.ckpt'))).toBe(true);
      expect(paths.some(p => p.includes('.pt'))).toBe(true);
    });

    test('excludeGitIgnored=false: data/raw/ files are present', () => {
      const results = index.find('', 1000, false);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.some(p => p.startsWith('data/raw/'))).toBe(true);
    });

    test('excludeGitIgnored=true: data/raw/ files are excluded', () => {
      const results = index.find('', 1000, true);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.every(p => !p.startsWith('data/raw/'))).toBe(true);
    });

    test('find("outputs") with excludeGitIgnored=false returns matches', () => {
      const results = index.find('outputs', 200, false);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.some(p => p.startsWith('outputs/'))).toBe(true);
    });

    test('find("outputs") with excludeGitIgnored=true returns no outputs', () => {
      const results = index.find('outputs', 200, true);
      const paths = results.map(r => r.item.relativePath);
      expect(paths.every(p => !p.startsWith('outputs/'))).toBe(true);
    });

    test('filter("outputs") with excludeGitIgnored=false returns matches', () => {
      const results = index.filter('outputs', 200, false);
      expect(results.some(r => r.relativePath.startsWith('outputs/'))).toBe(true);
    });

    test('filter("outputs") with excludeGitIgnored=true returns nothing from outputs/', () => {
      const results = index.filter('outputs', 200, true);
      expect(results.every(r => !r.relativePath.startsWith('outputs/'))).toBe(true);
    });
  });

  // ── Folder extraction: everything mode ────────────────────────────────

  describe('Folder extraction: everything mode', () => {
    test('excludeGitIgnored=false: outputs and its subdirs are discoverable', () => {
      const results = index.find('', 1000, false);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, '', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).toContain('outputs');
      expect(folderPaths).toContain('outputs/checkpoints');
      expect(folderPaths).toContain('outputs/models');
      expect(folderPaths).toContain('outputs/logs');
      expect(folderPaths).toContain('outputs/predictions');
    });

    test('excludeGitIgnored=false: data/raw is discoverable', () => {
      const results = index.find('', 1000, false);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, '', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).toContain('data/raw');
    });

    test('excludeGitIgnored=true: outputs/ folders are hidden', () => {
      const results = index.find('', 1000, true);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, '', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).not.toContain('outputs');
      expect(folderPaths).not.toContain('outputs/checkpoints');
      expect(folderPaths).not.toContain('outputs/models');
    });

    test('excludeGitIgnored=true: data/raw is hidden', () => {
      const results = index.find('', 1000, true);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, '', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).not.toContain('data/raw');
    });

    test('tracked folders appear in both modes', () => {
      for (const excludeGitIgnored of [true, false]) {
        const results = index.find('', 1000, excludeGitIgnored);
        const entries = results.map(r => r.item);
        const folders = extractFolders(entries, '', SearchMode.Folder);
        const folderPaths = folders.map((f: any) => f.description);

        expect(folderPaths).toContain('src');
        expect(folderPaths).toContain('src/models');
        expect(folderPaths).toContain('src/data');
        expect(folderPaths).toContain('src/utils');
        expect(folderPaths).toContain('notebooks');
        expect(folderPaths).toContain('scripts');
        expect(folderPaths).toContain('data');
        expect(folderPaths).toContain('data/processed');
        expect(folderPaths).toContain('data/splits');
      }
    });

    test('folder search for "outputs" with excludeGitIgnored=false finds it', () => {
      const results = index.find('', 1000, false);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, 'outputs', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).toContain('outputs');
      expect(folderPaths).toContain('outputs/checkpoints');
      expect(folderPaths).toContain('outputs/models');
    });

    test('folder search for "outputs" with excludeGitIgnored=true finds nothing', () => {
      const results = index.find('', 1000, true);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, 'outputs', SearchMode.Folder);

      expect(folders).toHaveLength(0);
    });
  });
});
