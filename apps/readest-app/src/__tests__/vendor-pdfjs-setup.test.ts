import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PDF.js vendor setup (#37)', () => {
  const appDir = path.resolve(__dirname, '../../');
  const vendorPdfjsDir = path.join(appDir, 'public/vendor/pdfjs');

  it('ensures @pdfjs target files exist in public/vendor/pdfjs', () => {
    const requiredFiles = [
      'pdf.min.mjs',
      'pdf.worker.min.mjs',
      'annotation_layer_builder.css',
      'text_layer_builder.css',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(vendorPdfjsDir, file);
      expect(fs.existsSync(filePath), `Expected ${file} to exist in public/vendor/pdfjs`).toBe(
        true,
      );
      const stat = fs.statSync(filePath);
      expect(stat.size, `Expected ${file} to be non-empty`).toBeGreaterThan(0);
    }
  });

  it('configures predev and prebuild hooks in package.json to generate vendor assets', () => {
    const pkgPath = path.join(appDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.scripts?.predev).toContain('setup-vendors');
    expect(pkg.scripts?.prebuild).toContain('setup-vendors');
  });
});
