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
  try {
    await fs.writeFile(getSafePath(state.orderId), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error(`[maestro/state] Failed to save state for ${state.orderId}:`, err);
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
