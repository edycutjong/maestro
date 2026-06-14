/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Maestro — End-to-end smoke demo (offline / mock mode).
 *
 * Drives a full orchestration through the real provider `work()` function:
 * research → grade → (fallback) → human escalation → compose → upload.
 * Sub-agent hires return croo-core mock fixtures, so no USDC is spent and no
 * network/WebSocket is opened.
 */
import { startMaestroProvider } from '../src/provider.js';

async function run() {
  console.log('🚀 CROO Constellation — Maestro E2E (mock mode)\n');

  process.env.CROO_MOCK = 'true';

  const topic = 'Zero-Knowledge Proofs in DAOs';
  const requirement = { topic, qualityThreshold: 80, forceEscalation: false };

  // Stub client: in mock mode croo-core's hire() returns fixtures and never
  // touches this client, but work() reads the negotiation requirements and
  // uploads the final brief through it.
  const uploads: string[] = [];
  const client: any = {
    getNegotiation: async (negotiationId: string) => ({
      negotiationId,
      requirements: JSON.stringify(requirement),
    }),
    uploadFile: async (fileName: string) => {
      const key = `mock://artifact/${fileName}`;
      uploads.push(key);
      return key;
    },
  };

  const maestroServiceId = 'svc_maestro_orchestrator';
  console.log(`[e2e] Starting Maestro provider, placing order for "${topic}"...\n`);

  const stream: any = await startMaestroProvider(client, maestroServiceId);

  // Simulate a paid order flowing into the provider's work() loop.
  await stream.simulateOrder({
    orderId: 'demo_order_1',
    negotiationId: 'demo_neg_1',
    serviceId: maestroServiceId,
    price: '5.0',
    slaDeadline: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  });

  console.log('\n✅ E2E complete — Maestro orchestrated the full pipeline end-to-end.');
  console.log(`📎 Artifacts uploaded: ${uploads.length ? uploads.join(', ') : '(none)'}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('[e2e] Test failed:', err);
  process.exit(1);
});
