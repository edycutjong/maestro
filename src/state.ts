import { promises as fs } from 'fs';
import path from 'path';
import type { AuditEntry } from '@edycutjong/croo-core';

export interface PipelineState {
  orderId: string;
  topic: string;
  qualityThreshold: number;
  forceEscalation: boolean;
  totalSpent: number;
  results: Record<string, unknown>;
  audit: AuditEntry[];
  completedSteps: string[];
}

const DATA_DIR = path.join(process.cwd(), 'data');

function getSafePath(orderId: string): string {
  if (typeof orderId !== 'string') throw new Error('Invalid orderId type');
  // STRICT SANITIZATION: Mitigate Path Traversal
  const safeId = path.basename(orderId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid orderId format');
  return path.join(DATA_DIR, `${safeId}.json`);
}

export async function initDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

export async function loadState(orderId: string): Promise<PipelineState | null> {
  await initDataDir();
  try {
    const raw = await fs.readFile(getSafePath(orderId), 'utf8');
    return JSON.parse(raw) as PipelineState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[maestro/state] Failed to load state for ${orderId}:`, err);
    }
    return null;
  }
}

export async function saveState(state: PipelineState): Promise<void> {
  await initDataDir();
  const targetPath = getSafePath(state.orderId);
  const tempPath = `${targetPath}.tmp.json`;
  
  try {
    // ATOMIC WRITE: Write to temp file first, then swap atomically
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    console.error(`[maestro/state] Failed to save state for ${state.orderId}:`, err);
    // Cleanup dangling temp file if possible
    try { await fs.unlink(tempPath); } catch {}
  }
}

export async function clearState(orderId: string): Promise<void> {
  try {
    await fs.unlink(getSafePath(orderId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[maestro/state] Failed to clear state for ${orderId}:`, err);
    }
  }
}

export async function sweepStaleState(maxAgeMs: number = 86_400_000): Promise<void> {
  await initDataDir();
  try {
    const files = await fs.readdir(DATA_DIR);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(DATA_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath);
          console.log(`[maestro/state] Swept stale state file: ${file}`);
        }
      } catch {
        // Ignore individual file stat/unlink errors
      }
    }
  } catch (err) {
    console.error('[maestro/state] Failed to sweep stale state directory:', err);
  }
}
