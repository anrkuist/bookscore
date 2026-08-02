import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { BaseDir, FileSystem } from '@/types/system';

export class NodeTestFileSystem {
  constructor(private rootDir: string) {}

  resolvePath(fp: string, base: BaseDir) {
    return {
      baseDir: 0,
      basePrefix: async () => this.rootDir,
      fp,
      base,
    };
  }

  getURL(pathStr: string) {
    return `file://${path.join(this.rootDir, pathStr)}`;
  }

  async getBlobURL(pathStr: string): Promise<string> {
    return this.getURL(pathStr);
  }

  async getImageURL(pathStr: string): Promise<string> {
    return this.getURL(pathStr);
  }

  async openFile(pathStr: string): Promise<File> {
    const fullPath = path.join(this.rootDir, pathStr);
    const buf = await fsPromises.readFile(fullPath);
    return new File([buf], path.basename(pathStr));
  }

  async copyFile(srcPath: string, _srcBase: BaseDir, dstPath: string): Promise<void> {
    const src = path.join(this.rootDir, srcPath);
    const dst = path.join(this.rootDir, dstPath);
    await fsPromises.mkdir(path.dirname(dst), { recursive: true });
    await fsPromises.copyFile(src, dst);
  }

  async readFile(
    pathStr: string,
    _base: BaseDir,
    mode?: 'text' | 'binary',
  ): Promise<string | ArrayBuffer> {
    const fullPath = path.join(this.rootDir, pathStr);
    if (mode === 'binary') {
      const buf = await fsPromises.readFile(fullPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    return fsPromises.readFile(fullPath, 'utf8');
  }

  async writeFile(
    pathStr: string,
    _base: BaseDir,
    data: string | ArrayBuffer | Uint8Array | File,
  ): Promise<void> {
    const fullPath = path.join(this.rootDir, pathStr);
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof data === 'string') {
      await fsPromises.writeFile(fullPath, data, 'utf8');
    } else if (data instanceof ArrayBuffer || data?.constructor?.name === 'ArrayBuffer') {
      await fsPromises.writeFile(fullPath, Buffer.from(data as ArrayBuffer));
    } else if ('buffer' in data && data.buffer) {
      const view = data as Uint8Array;
      await fsPromises.writeFile(
        fullPath,
        Buffer.from(view.buffer, view.byteOffset, view.byteLength),
      );
    }
  }

  async exists(pathStr: string, _base: BaseDir): Promise<boolean> {
    const fullPath = path.join(this.rootDir, pathStr);
    try {
      await fsPromises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async remove(pathStr: string, _base: BaseDir): Promise<void> {
    const fullPath = path.join(this.rootDir, pathStr);
    await fsPromises.rm(fullPath, { recursive: true, force: true });
  }

  async deleteFile(pathStr: string, _base: BaseDir): Promise<void> {
    return this.remove(pathStr, _base);
  }
}

export function createTestFileSystem(rootDir: string): FileSystem {
  return new NodeTestFileSystem(rootDir) as unknown as FileSystem;
}
