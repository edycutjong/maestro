import fs from 'fs';
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

export function initDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(orderId: string): PipelineState | null {
  initDataDir();
  const statePath = path.join(DATA_DIR, `${orderId}.json`);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw) as PipelineState;
  } catch (err) {
    console.error(`[maestro/state] Failed to load state for ${orderId}:`, err);
    return null;
  }
}

export function saveState(state: PipelineState): void {
  initDataDir();
  const statePath = path.join(DATA_DIR, `${state.orderId}.json`);
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error(`[maestro/state] Failed to save state for ${state.orderId}:`, err);
  }
}

export function clearState(orderId: string): void {
  const statePath = path.join(DATA_DIR, `${orderId}.json`);
  if (fs.existsSync(statePath)) {
    try {
      fs.unlinkSync(statePath);
    } catch (err) {
      console.error(`[maestro/state] Failed to clear state for ${orderId}:`, err);
    }
  }
}
