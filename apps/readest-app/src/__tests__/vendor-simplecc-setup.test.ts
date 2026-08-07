import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = process.cwd();

describe('SimpleCC vendor setup', () => {
  const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('runs setup-simplecc before every Next.js lifecycle that resolves the alias', () => {
    const lifecycleScripts = ['predev', 'prebuild', 'predev-web', 'prebuild-web', 'prebuild-tauri'];

    for (const script of lifecycleScripts) {
      expect(pkg.scripts[script], `${script} must prepare the SimpleCC vendor`).toContain(
        'setup-simplecc',
      );
    }
  });
});
