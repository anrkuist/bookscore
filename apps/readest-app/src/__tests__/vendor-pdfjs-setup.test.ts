import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PDF.js vendor setup (#37)', () => {
  const appDir = path.resolve(__dirname, '../../');
  const tauriConfPath = path.join(appDir, 'src-tauri/tauri.conf.json');
  const pkgPath = path.join(appDir, 'package.json');
  const vendorPdfjsDir = path.join(appDir, 'public/vendor/pdfjs');

  it('validates Tauri beforeDevCommand and pnpm predev/prebuild lifecycle routing', () => {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Tauri dev lifecycle starts by running beforeDevCommand
    expect(tauriConf.build?.beforeDevCommand).toBe('pnpm dev');

    // pnpm dev resolves lifecycle hook predev before executing dev
    expect(pkg.scripts?.dev).toBe('dotenv -e .env.tauri -- next dev');
    expect(pkg.scripts?.predev).toBe('pnpm setup-pdfjs');
    expect(pkg.scripts?.prebuild).toBe('pnpm setup-pdfjs');
  });

  it('generates pdf.min.mjs and required PDF.js vendor assets from a controlled missing state', () => {
    const targetFile = path.join(vendorPdfjsDir, 'pdf.min.mjs');
    const backupFile = path.join(vendorPdfjsDir, 'pdf.min.mjs.bak');

    let backedUp = false;
    if (fs.existsSync(targetFile)) {
      fs.renameSync(targetFile, backupFile);
      backedUp = true;
    }

    try {
      expect(fs.existsSync(targetFile)).toBe(false);

      // Run vendor setup script from controlled missing state
      execSync('pnpm setup-pdfjs', { cwd: appDir, stdio: 'pipe' });

      // Assert pdf.min.mjs and companion vendor assets were generated and are non-empty
      const requiredFiles = [
        'pdf.min.mjs',
        'pdf.worker.min.mjs',
        'annotation_layer_builder.css',
        'text_layer_builder.css',
      ];

      for (const file of requiredFiles) {
        const filePath = path.join(vendorPdfjsDir, file);
        expect(fs.existsSync(filePath), `Expected ${file} to be generated`).toBe(true);
        const stat = fs.statSync(filePath);
        expect(stat.size, `Expected ${file} to be non-empty`).toBeGreaterThan(0);
      }
    } finally {
      if (backedUp && fs.existsSync(backupFile)) {
        if (fs.existsSync(targetFile)) {
          fs.rmSync(backupFile);
        } else {
          fs.renameSync(backupFile, targetFile);
        }
      }
    }
  }, 30000);
});
