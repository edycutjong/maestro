import fsSync from 'fs';
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

export async function initDataDir(): Promise<void> {
  if (!fsSync.existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

export async function loadState(orderId: string): Promise<PipelineState | null> {
  await initDataDir();
  const statePath = path.join(DATA_DIR, `${orderId}.json`);
  if (!fsSync.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return JSON.parse(raw) as PipelineState;
  } catch (err) {
    console.error(`[maestro/state] Failed to load state for ${orderId}:`, err);
    return null;
  }
}

export async function saveState(state: PipelineState): Promise<void> {
  await initDataDir();
  const statePath = path.join(DATA_DIR, `${state.orderId}.json`);
  try {
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error(`[maestro/state] Failed to save state for ${state.orderId}:`, err);
  }
}

export async function clearState(orderId: string): Promise<void> {
  const statePath = path.join(DATA_DIR, `${orderId}.json`);
  if (fsSync.existsSync(statePath)) {
    try {
      await fs.unlink(statePath);
    } catch (err) {
      console.error(`[maestro/state] Failed to clear state for ${orderId}:`, err);
    }
  }
}
