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
import { startMaestroProvider, getActiveOrderCount } from './provider.js';
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

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('\n[maestro] Caught termination signal. Halting inbound connections...');
    if (stream && typeof (stream as { close?: () => void }).close === 'function') {
      (stream as { close: () => void }).close();
    }

    console.log(`[maestro] Draining ${getActiveOrderCount()} in-flight orders...`);
    const maxWaitMs = Date.now() + 45_000; // 45s hard ceiling for eviction
    
    while (getActiveOrderCount() > 0 && Date.now() < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (getActiveOrderCount() > 0) {
      console.error(`[maestro] ⚠️ Force quitting with ${getActiveOrderCount()} stranded orders.`);
      process.exit(1);
    } else {
      console.log('[maestro] Clean shutdown complete. Zero stranded orders.');
      process.exit(0);
    }
  };

  // Safely bind async shutdown to process events
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', () => { shutdown().catch(console.error); });
  process.on('SIGTERM', () => { shutdown().catch(console.error); });

  console.log('[maestro] Ready — waiting for orchestration orders...');
}

main().catch((err) => {
  console.error('[maestro] Fatal error:', err);
  process.exit(1);
});
