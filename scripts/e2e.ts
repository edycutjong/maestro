/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { makeClient, hire } from '@edycutjong/croo-core';
import { startMaestroProvider, getTraceLog } from '../src/provider.js';

async function run() {
  console.log('🚀 Starting CROO Constellation E2E Mock Test\n');

  // 1. Initialize client in mock mode
  process.env.CROO_MOCK = 'true';
  process.env.CROO_API_KEY = 'croo_sk_mock_e2e_key';
  const client = makeClient(process.env.CROO_API_KEY);

  // 2. Start Maestro provider
  const maestroServiceId = 'svc_maestro_orchestrator';
  console.log('[e2e] Starting Maestro provider...');
  const maestroLoop = startMaestroProvider(client, maestroServiceId);

  // 3. Act as buyer: Place an order to Maestro
  console.log('\n[e2e] Buyer: Placing order to Maestro for "Zero-Knowledge Proofs in DAOs"...\n');
  const result = await hire(client, {
    serviceId: maestroServiceId,
    requirement: {
      topic: 'Zero-Knowledge Proofs in DAOs',
      qualityThreshold: 90,
      forceEscalation: false,
    },
    amount: '5.0',
  });

  // 4. Output results
  console.log('\n✅ Order Completed!');
  console.log(`Order ID: ${result.orderId}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Amount Paid: ${result.amountPaid} USDC`);
  
  console.log('\n📄 Final Brief Delivered:\n');
  console.log('==================================================');
  console.log((result.delivery as any).brief);
  console.log('==================================================\n');

  console.log('🔍 Maestro Trace Log:');
  const traceLog = getTraceLog();
  traceLog.forEach(t => console.log(`  [${new Date(t.timestamp).toISOString()}] ${t.event} (${t.agent})`));

  console.log('\n[e2e] Test complete. Exiting.');
  process.exit(0);
}

run().catch(err => {
  console.error('[e2e] Test failed:', err);
  process.exit(1);
});
