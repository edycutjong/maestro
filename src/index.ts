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
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { activeTraces } from './trace.js';

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

  // Start HTTP Server to serve UI and traces
  const port = process.env.PORT || 3002;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const uiPath = path.join(__dirname, '../ui/index.html');

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'maestro' }));
      return;
    }

    if (parsedUrl.pathname === '/trace') {
      const orderId = parsedUrl.searchParams.get('orderId');
      if (!orderId) {
        res.writeHead(400);
        return res.end('Missing orderId parameter');
      }
      
      const trace = activeTraces.get(orderId);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify(trace ?? []));
    }

    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      fs.readFile(uiPath, 'utf-8', (err, content) => {
        if (err) {
          res.writeHead(500);
          return res.end('Failed to load UI index.html');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`[Lifecycle] 🩺 Health & UI server bound to port ${port}`);
  });

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('\n[maestro] Caught termination signal. Halting inbound connections...');
    if (stream && typeof (stream as { close?: () => void }).close === 'function') {
      (stream as { close: () => void }).close();
    }

    if (server && typeof server.close === 'function') {
      server.close();
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

  // RELIABILITY GUARD: Catch fatal Node.js errors and route them through the graceful drain
  process.on('uncaughtException', (err) => {
    console.error('[maestro] 🚨 Uncaught Exception detected. Initiating emergency drain...', err);
    shutdown().catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[maestro] 🚨 Unhandled Promise Rejection detected. Initiating emergency drain...', reason);
    shutdown().catch(() => process.exit(1));
  });

  console.log('[maestro] Ready — waiting for orchestration orders...');
}

main().catch((err) => {
  console.error('[maestro] Fatal error:', err);
  process.exit(1);
});

