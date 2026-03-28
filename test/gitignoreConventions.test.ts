import { describe, test, expect, vi, beforeAll } from 'vitest';
import path from 'path';

// Simulates a polyglot monorepo with 7 nested .gitignore files exercising:
// - Directory patterns (node_modules/, build/, dist/)
// - Wildcard extension patterns (*.log, *.pyc, *.map)
// - Exact filename patterns (.env, .DS_Store, Thumbs.db)
// - Negation patterns (!requirements.txt, !guide.pdf, !schema.csv, !example.tfvars)
// - Character range patterns ([Dd]ebug/, [Rr]elease/)
// - Comments and blank lines
// - Windows backslash normalization

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/conventions-project').replace(/\\/g, '/');

// --- .gitignore file definitions ---

const GITIGNORE_FILES: Array<{ path: string; content: string }> = [
  {
    path: '.gitignore',
    content: [
      '# Dependencies',
      'node_modules/',
      '',
      '# Build output',
      'build/',
      'dist/',
      '',
      '# Environment',
      '.env',
      '',
      '# Logs',
      '*.log',
      '',
      '# OS generated',
      '.DS_Store',
      'Thumbs.db',
      '',
      '# Coverage',
      'coverage/',
      '',
      '# Python bytecode',
      '__pycache__/',
      '*.pyc',
      '',
      '# Compiled objects',
      '*.o',
      '*.so',
    ].join('\n'),
  },
  {
    path: 'frontend/.gitignore',
    content: [
      '# Source maps (recursive)',
      '**/*.map',
      '',
      '# Next.js build',
      '.next/',
      '',
      '# Storybook build',
      'storybook-static/',
    ].join('\n'),
  },
  {
    path: 'backend/.gitignore',
    content: [
      '# Virtual environment',
      'venv/',
      '',
      '# Type checker cache',
      '.mypy_cache/',
      '',
      '# Egg info',
      '*.egg-info/',
      '',
      '# Ignore text files except requirements',
      '*.txt',
      '!requirements.txt',
    ].join('\n'),
  },
  {
    path: 'services/.gitignore',
    content: [
      '# .NET build artifacts',
      'bin/',
      'obj/',
      '',
      '# Case-insensitive debug/release',
      '[Dd]ebug/',
      '[Rr]elease/',
    ].join('\n'),
  },
  {
    path: 'infra/.gitignore',
    content: [
      '# Terraform',
      '.terraform/',
      '*.tfstate',
      '*.tfstate.backup',
      '*.tfvars',
      '!example.tfvars',
    ].join('\n'),
  },
  {
    path: 'docs/.gitignore',
    content: [
      '# Generated site',
      '_site/',
      '',
      '# PDFs except guide',
      '*.pdf',
      '!guide.pdf',
    ].join('\n'),
  },
  {
    path: 'data/.gitignore',
    content: [
      '# Large data files',
      '*.csv',
      '*.parquet',
      '!schema.csv',
      '',
      '# Raw data dumps',
      'raw/',
    ].join('\n'),
  },
];

// --- File definitions ---

const TRACKED_FILES = [
  'package.json',
  '.env.example',
  'README.md',
  'frontend/src/App.tsx',
  'frontend/src/index.ts',
  'frontend/src/components/Header.tsx',
  'frontend/src/components/Footer.tsx',
  'frontend/package.json',
  'backend/src/main.py',
  'backend/src/models.py',
  'backend/src/utils/helpers.py',
  'backend/requirements.txt',
  'services/api/Program.cs',
  'services/worker/Worker.cs',
  'services/shared/Types.cs',
  'infra/main.tf',
  'infra/variables.tf',
  'infra/example.tfvars',
  'docs/README.md',
  'docs/guide.pdf',
  'data/schema.csv',
  'data/migrations/001_init.sql',
  'scripts/deploy.sh',
  'scripts/setup.sh',
];

const IGNORED_FILES = [
  '.env',
  'debug.log',
  'access.log',
  '.DS_Store',
  'Thumbs.db',
  'node_modules/lodash/index.js',
  'node_modules/react/index.js',
  'build/output.js',
  'build/esm/index.js',
  'dist/bundle.js',
  'dist/assets/style.css',
  'coverage/lcov.info',
  'coverage/report.html',
  '__pycache__/test.cpython-311.pyc',
  'main.pyc',
  'utils.o',
  'libshared.so',
  'frontend/.next/static/chunk.js',
  'frontend/.next/server/page.js',
  'frontend/src/app.js.map',
  'frontend/storybook-static/main.js',
  'backend/venv/lib/pkg.txt',
  'backend/.mypy_cache/cache.json',
  'backend/myapp.egg-info/PKG-INFO',
  'backend/notes.txt',
  'services/bin/api.dll',
  'services/obj/project.assets.json',
  'services/Debug/services.dll',
  'services/debug/services.dll',
  'services/Release/services.dll',
  'services/release/services.dll',
  'infra/.terraform/providers/aws.zip',
  'infra/terraform.tfstate',
  'infra/terraform.tfstate.backup',
  'infra/secret.tfvars',
  'docs/_site/index.html',
  'docs/report.pdf',
  'data/users.csv',
  'data/orders.parquet',
  'data/raw/dump.sql',
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

  base.workspace.workspaceFolders = [{ uri: rootUri, name: 'conventions-project', index: 0 }];

  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = FIXTURE_ROOT + '/';
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    if (normalized === FIXTURE_ROOT || normalized === FIXTURE_ROOT + '/.') {
      return 'conventions-project';
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

describe('Gitignore conventions: multi-gitignore monorepo', () => {
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

  // ── Root .gitignore patterns ──────────────────────────────────────────

  describe('root .gitignore patterns', () => {
    test('directory patterns: node_modules/, build/, dist/, coverage/, __pycache__/', () => {
      expect(gitIgnore.isIgnored('node_modules/lodash/index.js')).toBe(true);
      expect(gitIgnore.isIgnored('node_modules/react/index.js')).toBe(true);
      expect(gitIgnore.isIgnored('build/output.js')).toBe(true);
      expect(gitIgnore.isIgnored('build/esm/index.js')).toBe(true);
      expect(gitIgnore.isIgnored('dist/bundle.js')).toBe(true);
      expect(gitIgnore.isIgnored('dist/assets/style.css')).toBe(true);
      expect(gitIgnore.isIgnored('coverage/lcov.info')).toBe(true);
      expect(gitIgnore.isIgnored('__pycache__/test.cpython-311.pyc')).toBe(true);
    });

    test('wildcard extension patterns: *.log, *.pyc, *.o, *.so', () => {
      expect(gitIgnore.isIgnored('debug.log')).toBe(true);
      expect(gitIgnore.isIgnored('access.log')).toBe(true);
      expect(gitIgnore.isIgnored('main.pyc')).toBe(true);
      expect(gitIgnore.isIgnored('utils.o')).toBe(true);
      expect(gitIgnore.isIgnored('libshared.so')).toBe(true);
    });

    test('exact filename patterns: .env, .DS_Store, Thumbs.db', () => {
      expect(gitIgnore.isIgnored('.env')).toBe(true);
      expect(gitIgnore.isIgnored('.DS_Store')).toBe(true);
      expect(gitIgnore.isIgnored('Thumbs.db')).toBe(true);
    });

    test('.env.example is NOT ignored (different filename)', () => {
      expect(gitIgnore.isIgnored('.env.example')).toBe(false);
    });

    test('source files are not affected by root patterns', () => {
      expect(gitIgnore.isIgnored('package.json')).toBe(false);
      expect(gitIgnore.isIgnored('README.md')).toBe(false);
      expect(gitIgnore.isIgnored('scripts/deploy.sh')).toBe(false);
    });
  });

  // ── Nested .gitignore: frontend ───────────────────────────────────────

  describe('frontend/.gitignore patterns', () => {
    test('*.map ignores source maps', () => {
      expect(gitIgnore.isIgnored('frontend/src/app.js.map')).toBe(true);
    });

    test('.next/ ignores Next.js build output', () => {
      expect(gitIgnore.isIgnored('frontend/.next/static/chunk.js')).toBe(true);
      expect(gitIgnore.isIgnored('frontend/.next/server/page.js')).toBe(true);
    });

    test('storybook-static/ ignores Storybook build', () => {
      expect(gitIgnore.isIgnored('frontend/storybook-static/main.js')).toBe(true);
    });

    test('frontend source files are not ignored', () => {
      expect(gitIgnore.isIgnored('frontend/src/App.tsx')).toBe(false);
      expect(gitIgnore.isIgnored('frontend/src/index.ts')).toBe(false);
      expect(gitIgnore.isIgnored('frontend/src/components/Header.tsx')).toBe(false);
      expect(gitIgnore.isIgnored('frontend/package.json')).toBe(false);
    });
  });

  // ── Nested .gitignore: backend (with negation) ───────────────────────

  describe('backend/.gitignore patterns', () => {
    test('venv/ ignores virtual environment', () => {
      expect(gitIgnore.isIgnored('backend/venv/lib/pkg.txt')).toBe(true);
    });

    test('.mypy_cache/ ignores type checker cache', () => {
      expect(gitIgnore.isIgnored('backend/.mypy_cache/cache.json')).toBe(true);
    });

    test('*.egg-info/ ignores egg info directories', () => {
      expect(gitIgnore.isIgnored('backend/myapp.egg-info/PKG-INFO')).toBe(true);
    });

    test('*.txt ignores text files in backend', () => {
      expect(gitIgnore.isIgnored('backend/notes.txt')).toBe(true);
    });

    test('backend source files are not ignored', () => {
      expect(gitIgnore.isIgnored('backend/src/main.py')).toBe(false);
      expect(gitIgnore.isIgnored('backend/src/models.py')).toBe(false);
      expect(gitIgnore.isIgnored('backend/src/utils/helpers.py')).toBe(false);
    });
  });

  // ── Nested .gitignore: services (character ranges) ───────────────────

  describe('services/.gitignore: character range patterns', () => {
    test('bin/ and obj/ ignore build artifacts', () => {
      expect(gitIgnore.isIgnored('services/bin/api.dll')).toBe(true);
      expect(gitIgnore.isIgnored('services/obj/project.assets.json')).toBe(true);
    });

    test('[Dd]ebug/ matches uppercase Debug', () => {
      expect(gitIgnore.isIgnored('services/Debug/services.dll')).toBe(true);
    });

    test('[Dd]ebug/ matches lowercase debug', () => {
      expect(gitIgnore.isIgnored('services/debug/services.dll')).toBe(true);
    });

    test('[Rr]elease/ matches uppercase Release', () => {
      expect(gitIgnore.isIgnored('services/Release/services.dll')).toBe(true);
    });

    test('[Rr]elease/ matches lowercase release', () => {
      expect(gitIgnore.isIgnored('services/release/services.dll')).toBe(true);
    });

    test('services source files are not ignored', () => {
      expect(gitIgnore.isIgnored('services/api/Program.cs')).toBe(false);
      expect(gitIgnore.isIgnored('services/worker/Worker.cs')).toBe(false);
      expect(gitIgnore.isIgnored('services/shared/Types.cs')).toBe(false);
    });
  });

  // ── Negation patterns ────────────────────────────────────────────────

  describe('negation patterns (!pattern)', () => {
    test('backend: !requirements.txt negates *.txt', () => {
      expect(gitIgnore.isIgnored('backend/requirements.txt')).toBe(false);
      expect(gitIgnore.isIgnored('backend/notes.txt')).toBe(true);
    });

    test('infra: !example.tfvars negates *.tfvars', () => {
      expect(gitIgnore.isIgnored('infra/example.tfvars')).toBe(false);
      expect(gitIgnore.isIgnored('infra/secret.tfvars')).toBe(true);
    });

    test('docs: !guide.pdf negates *.pdf', () => {
      expect(gitIgnore.isIgnored('docs/guide.pdf')).toBe(false);
      expect(gitIgnore.isIgnored('docs/report.pdf')).toBe(true);
    });

    test('data: !schema.csv negates *.csv', () => {
      expect(gitIgnore.isIgnored('data/schema.csv')).toBe(false);
      expect(gitIgnore.isIgnored('data/users.csv')).toBe(true);
    });
  });

  // ── Infra / Terraform patterns ───────────────────────────────────────

  describe('infra/.gitignore: Terraform patterns', () => {
    test('.terraform/ directory is ignored', () => {
      expect(gitIgnore.isIgnored('infra/.terraform/providers/aws.zip')).toBe(true);
    });

    test('*.tfstate and *.tfstate.backup are ignored', () => {
      expect(gitIgnore.isIgnored('infra/terraform.tfstate')).toBe(true);
      expect(gitIgnore.isIgnored('infra/terraform.tfstate.backup')).toBe(true);
    });

    test('Terraform source files are not ignored', () => {
      expect(gitIgnore.isIgnored('infra/main.tf')).toBe(false);
      expect(gitIgnore.isIgnored('infra/variables.tf')).toBe(false);
    });
  });

  // ── Data patterns ────────────────────────────────────────────────────

  describe('data/.gitignore patterns', () => {
    test('*.parquet files are ignored', () => {
      expect(gitIgnore.isIgnored('data/orders.parquet')).toBe(true);
    });

    test('raw/ directory is ignored', () => {
      expect(gitIgnore.isIgnored('data/raw/dump.sql')).toBe(true);
    });

    test('migrations are not ignored', () => {
      expect(gitIgnore.isIgnored('data/migrations/001_init.sql')).toBe(false);
    });
  });

  // ── Comments and blank lines ─────────────────────────────────────────

  describe('comments and blank lines', () => {
    test('comment lines are not applied as patterns', () => {
      // None of the # comment text should act as an ignore rule
      expect(gitIgnore.isIgnored('frontend/src/App.tsx')).toBe(false);
      expect(gitIgnore.isIgnored('package.json')).toBe(false);
    });

    test('blank lines do not create catch-all patterns', () => {
      expect(gitIgnore.isIgnored('README.md')).toBe(false);
      expect(gitIgnore.isIgnored('scripts/deploy.sh')).toBe(false);
    });
  });

  // ── isIgnored post-filter ──────────────────────────────────────────

  describe('isIgnored post-filter', () => {
    test('gitignore directory patterns are caught by isIgnored', () => {
      expect(gitIgnore.isIgnored('build/output.js')).toBe(true);
      expect(gitIgnore.isIgnored('dist/bundle.js')).toBe(true);
      expect(gitIgnore.isIgnored('coverage/report.html')).toBe(true);
      expect(gitIgnore.isIgnored('frontend/.next/cache.js')).toBe(true);
      expect(gitIgnore.isIgnored('backend/venv/lib/site.py')).toBe(true);
      expect(gitIgnore.isIgnored('infra/.terraform/state.json')).toBe(true);
    });
  });

  // ── FileIndex integration ────────────────────────────────────────────

  describe('FileIndex integration', () => {
    test('fileCount only includes tracked files and .gitignore files', () => {
      const expectedCount = TRACKED_FILES.length + GITIGNORE_FILES.length;
      expect(index.fileCount).toBe(expectedCount);
    });

    test('find() with excludeGitIgnored=true returns no ignored files', () => {
      const results = index.find('', 1000, true);
      const paths = results.map(r => r.item.relativePath);

      for (const ignoredFile of IGNORED_FILES) {
        expect(paths).not.toContain(ignoredFile);
      }
    });

    test('find() with excludeGitIgnored=false can return ignored files', () => {
      const results = index.find('', 1000, false);
      const paths = results.map(r => r.item.relativePath);

      expect(paths.some(p => p.startsWith('build/'))).toBe(true);
      expect(paths.some(p => p.startsWith('node_modules/'))).toBe(true);
    });

    test('negated files appear in filtered results', () => {
      const results = index.find('', 1000, true);
      const paths = results.map(r => r.item.relativePath);

      expect(paths).toContain('backend/requirements.txt');
      expect(paths).toContain('infra/example.tfvars');
      expect(paths).toContain('docs/guide.pdf');
      expect(paths).toContain('data/schema.csv');
    });

    test('non-negated siblings of negated files are still ignored', () => {
      const results = index.find('', 1000, true);
      const paths = results.map(r => r.item.relativePath);

      expect(paths).not.toContain('backend/notes.txt');
      expect(paths).not.toContain('infra/secret.tfvars');
      expect(paths).not.toContain('docs/report.pdf');
      expect(paths).not.toContain('data/users.csv');
    });
  });

  // ── Windows backslash paths ──────────────────────────────────────────

  describe('Windows backslash paths', () => {
    test('root patterns work with backslashes', () => {
      expect(gitIgnore.isIgnored('node_modules\\lodash\\index.js')).toBe(true);
      expect(gitIgnore.isIgnored('build\\output.js')).toBe(true);
      expect(gitIgnore.isIgnored('scripts\\deploy.sh')).toBe(false);
    });

    test('nested patterns work with backslashes', () => {
      expect(gitIgnore.isIgnored('frontend\\.next\\static\\chunk.js')).toBe(true);
      expect(gitIgnore.isIgnored('backend\\venv\\lib\\pkg.txt')).toBe(true);
      expect(gitIgnore.isIgnored('services\\bin\\api.dll')).toBe(true);
    });

    test('negated files work with backslashes', () => {
      expect(gitIgnore.isIgnored('backend\\requirements.txt')).toBe(false);
      expect(gitIgnore.isIgnored('docs\\guide.pdf')).toBe(false);
      expect(gitIgnore.isIgnored('data\\schema.csv')).toBe(false);
    });
  });
});
