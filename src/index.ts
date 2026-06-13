/**
 * Maestro — Entry point.
 *
 * Required env vars:
 * - CROO_SDK_KEY
 * - MAESTRO_SERVICE_ID
 * - WORKER_SERVICE_ID, LITMUS_SERVICE_ID, SUMMON_SERVICE_ID
 *
 * Optional:
 * - CROO_MOCK=true — offline mock mode
 */

import { makeClient, isMockMode } from '@edycutjong/croo-core';
import { startMaestroProvider } from './provider.js';
import { sweepStaleState } from './state.js';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  🎼 Maestro — Agent Orchestrator         ║');
  console.log('║  Research → Grade → Human → Deliver      ║');
  console.log(`║  Mode: ${isMockMode() ? '🧪 MOCK' : '🔴 LIVE (Base Mainnet)'}              ║`);
  console.log('╚══════════════════════════════════════════╝');

  // PREVENT DISK LEAKS: Sweep zombie state files from prior terminated processes
  console.log('[maestro] Sweeping stale pipeline states...');
  await sweepStaleState(86_400_000); // 24 hours

  const sdkKey = process.env.CROO_SDK_KEY;
  const serviceId = process.env.MAESTRO_SERVICE_ID;

  if (!sdkKey && !isMockMode()) {
    console.error('Missing CROO_SDK_KEY. Set it or use CROO_MOCK=true.');
    process.exit(1);
  }

  if (!serviceId) {
    console.error('Missing MAESTRO_SERVICE_ID.');
    process.exit(1);
  }

  const client = isMockMode() ? {} : makeClient(sdkKey!);
  const stream = await startMaestroProvider(client, serviceId);

  const shutdown = () => {
    console.log('\n[maestro] Shutting down...');
    if (stream && typeof (stream as { close?: () => void }).close === 'function') {
      (stream as { close: () => void }).close();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[maestro] Ready — waiting for orchestration orders...');
}

main().catch((err) => {
  console.error('[maestro] Fatal error:', err);
  process.exit(1);
});
