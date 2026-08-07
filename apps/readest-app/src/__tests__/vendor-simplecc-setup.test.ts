import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(__dirname, '../..');

describe('SimpleCC vendor setup', () => {
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('prepares SimpleCC before Tauri starts the Next.js dev server', () => {
    const tauriConf = JSON.parse(readFileSync(join(appRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
    const lifecycle = `${pkg.scripts.predev} && ${pkg.scripts.dev}`;

    expect(tauriConf.build?.beforeDevCommand).toBe('pnpm dev');
    expect(pkg.scripts.dev).toContain('next dev');
    expect(lifecycle.indexOf('setup-simplecc')).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf('setup-simplecc')).toBeLessThan(lifecycle.indexOf('next dev'));

    for (const script of ['prebuild', 'predev-web', 'prebuild-web', 'prebuild-tauri']) {
      expect(pkg.scripts[script], `${script} must prepare the SimpleCC vendor`).toContain(
        'setup-simplecc',
      );
    }
  });

  it('copies the module and WASM into an isolated missing vendor directory', () => {
    const copyScript = pkg.scripts['copy-simplecc']!;
    const [sourceGlob] = copyScript.match(/"([^"]+)"/) ?? [];
    if (!sourceGlob) throw new Error(`No source glob in copy-simplecc: ${copyScript}`);

    const source = sourceGlob.slice(1, -1);
    const tempRoot = mkdtempSync(join(tmpdir(), 'readest-simplecc-'));
    const tempVendor = join(tempRoot, 'simplecc');

    try {
      expect(existsSync(tempVendor)).toBe(false);
      execFileSync('pnpm', ['exec', 'cpx', source, tempVendor], {
        cwd: appRoot,
        stdio: 'pipe',
      });

      for (const file of ['simplecc_wasm.js', 'simplecc_wasm_bg.wasm']) {
        const filePath = join(tempVendor, file);
        expect(existsSync(filePath), `Expected ${file} to be copied`).toBe(true);
        expect(statSync(filePath).size, `Expected ${file} to be non-empty`).toBeGreaterThan(0);
      }

      expect(readdirSync(tempVendor)).toEqual(
        expect.arrayContaining(['simplecc_wasm.js', 'simplecc_wasm_bg.wasm']),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
