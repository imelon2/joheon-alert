import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NotifiedLog, Snapshot } from './types.js';

export const SNAPSHOT_PATH = 'state/ipo.json';
export const NOTIFIED_PATH = 'state/notified.json';

export async function readSnapshot(path = SNAPSHOT_PATH): Promise<Snapshot> {
  return (await readJson<Snapshot>(path)) ?? { updatedAt: '', items: {} };
}

export async function readNotified(path = NOTIFIED_PATH): Promise<NotifiedLog> {
  return (await readJson<NotifiedLog>(path)) ?? { sent: [] };
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`${path} 읽기 실패 (손상된 JSON?): ${String(err)}`);
  }
}
