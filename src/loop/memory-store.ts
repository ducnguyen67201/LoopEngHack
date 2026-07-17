import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loopMemorySnapshotSchema, type LoopMemorySnapshot } from './contracts.js';

export interface LoopMemoryStore {
  load(): Promise<LoopMemorySnapshot | null>;
  save(snapshot: LoopMemorySnapshot): Promise<void>;
}

export class InMemoryLoopMemoryStore implements LoopMemoryStore {
  private snapshot: LoopMemorySnapshot | null = null;

  load(): Promise<LoopMemorySnapshot | null> {
    return Promise.resolve(this.snapshot === null ? null : structuredClone(this.snapshot));
  }

  save(snapshot: LoopMemorySnapshot): Promise<void> {
    this.snapshot = structuredClone(loopMemorySnapshotSchema.parse(snapshot));
    return Promise.resolve();
  }
}

export class FileLoopMemoryStore implements LoopMemoryStore {
  constructor(private readonly path: string) {
    if (path.trim() === '') throw new TypeError('Loop memory path must not be blank');
  }

  async load(): Promise<LoopMemorySnapshot | null> {
    try {
      const body = await readFile(this.path, 'utf8');
      return loopMemorySnapshotSchema.parse(JSON.parse(body));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(snapshot: LoopMemorySnapshot): Promise<void> {
    const parsed = loopMemorySnapshotSchema.parse(snapshot);
    const directory = dirname(this.path);
    const temporaryPath = `${this.path}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
