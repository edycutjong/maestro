import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable } from '@edycutjong/croo-core';
import { buildPipeline } from './planner.js';
import type { PipelineContext } from './planner.js';
import { executePipeline } from './hire-engine.js';
import { TraceContext } from './trace.js';
import { composeAndUploadBrief } from './composer.js';
import { recordTreasuryYield } from './treasury.js';

// ─── Input / Output Types ──────────────────────────────────────────

interface MaestroInput {
  topic: string;
  qualityThreshold?: number;
  forceEscalation?: boolean;
}

interface MaestroOutput {
  brief: string;
  score: number;
  approvedBy?: string;
  profitUsdc: string; // <-- ADD THIS
  estimatedValuationUsdc: string; // <-- ADD THIS
  audit: Array<{
    step: string;
    agent: string;
    orderId: string;
    amount: string;
    txHash?: string;
    status: string;
  }>;
  pdfKey?: string;
}

// ─── Configuration ─────────────────────────────────────────────────

function getServiceIds() {
  return {
    workerServiceId: process.env.WORKER_SERVICE_ID ?? 'svc_research_worker',
    workerFallbackServiceId: process.env.WORKER_FALLBACK_SERVICE_ID ?? 'svc_fallback_worker',
    litmusServiceId: process.env.LITMUS_SERVICE_ID ?? 'svc_litmus_grader',
    summonServiceId: process.env.SUMMON_SERVICE_ID ?? 'svc_summon_human',
  };
}

function isMaestroInput(data: unknown): data is MaestroInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof data === 'object' && data !== null && typeof (data as any).topic === 'string';
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

const INVALID_PAYLOAD = 'Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.';

/**
 * Load and validate the buyer's MaestroInput from the order's negotiation.
 * The Order does not carry the requirement — it lives on the negotiation as a
 * JSON `requirements` string (see croo-core `hire()`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadInput(client: CrooAgentClient, order: any): Promise<MaestroInput> {
  let raw: string;
  try {
    const negotiation = await client.getNegotiation(order.negotiationId);
    raw = negotiation?.requirements ?? '';
  } catch (err) {
    throw new Error(`Invalid payload: failed to load negotiation ${order.negotiationId}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(INVALID_PAYLOAD);
  }

  if (!isMaestroInput(parsed)) {
    throw new Error(INVALID_PAYLOAD);
  }
  return parsed;
}

// ─── Provider ──────────────────────────────────────────────────────

// IDEMPOTENCY GUARD: Track active orders to prevent double-spend from duplicate webhooks
const activeOrders = new Set<string>();
export const getActiveOrderCount = (): number => activeOrders.size;

export interface CrooAgentClient {
  uploadFile?: (fileName: string, body: Buffer | string | Blob) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any; 
}

/**
 * Start the Maestro provider loop.
 */
export async function startMaestroProvider(
  client: CrooAgentClient,
  serviceId: string,
): Promise<unknown> {
  const serviceIds = getServiceIds();
  const pipeline = buildPipeline(serviceIds);

  // The runtime client is a real SDK AgentClient (or a mock in tests); our
  // loose CrooAgentClient surface is a structural subset, so cast at the seam.
  return runProvider<unknown>(client as unknown as Parameters<typeof runProvider>[0], {
    /* v8 ignore next 4 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serviceMatch: (event: any) => {
      return event.service_id === serviceId;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    work: async (order: any): Promise<Deliverable<unknown>> => {
      if (activeOrders.has(order.orderId)) {
        console.warn(`[maestro] Idempotency guard triggered: Order ${order.orderId} is already being processed.`);
        throw new Error('Duplicate order execution rejected to prevent double-spend.');
      }
      activeOrders.add(order.orderId);

      try {
        // The buyer's payload lives on the negotiation as a JSON `requirements`
        // string — the Order itself does not carry it. Fetch and parse it.
        const input = await loadInput(client, order);

      console.log(`[maestro] Order ${order.orderId}: orchestrating pipeline for "${input.topic}"`);

      const traceCtx = new TraceContext(order.orderId);

      // SLA: derive the working deadline from the order's real on-chain SLA
      // (1m buffer), falling back to 24m only if the field is absent.
      const slaDeadlineMs = order.slaDeadline ? new Date(order.slaDeadline).getTime() : NaN;
      const absoluteDeadline = Number.isNaN(slaDeadlineMs)
        ? Date.now() + 1_440_000
        : slaDeadlineMs - 60_000;

      // Build pipeline context
      const context: PipelineContext = {
        topic: input.topic,
        qualityThreshold: input.qualityThreshold ?? 80,
        forceEscalation: input.forceEscalation ?? false,
        absoluteDeadline,
        results: {},
      };

      // STRICT FINANCIAL GUARD: Prevent NaN bypass exploit
      const rawPrice = order.price ?? '';
      const budgetUsdc = parseFloat(rawPrice);
      if (Number.isNaN(budgetUsdc) || budgetUsdc <= 0) {
        throw new Error(`[maestro/security] Invalid order price. Expected positive numeric string, got: ${rawPrice}`);
      }

      // Execute the pipeline (sequential hires)
      const result = await executePipeline(client, pipeline, context, budgetUsdc, order.orderId, traceCtx);

      // Compose the final brief using fallback results if they exist
      const finalResearch = result.results.fallback_research || result.results.research;
      const finalGrade = result.results.fallback_grade || result.results.grade;
      
      // Safe Extraction without blind casting
      const researchDraft = isRecord(finalResearch) && typeof finalResearch.draft === 'string'
        ? finalResearch.draft 
        : 'No research available';
        
      // Architecture: Strict Refund Enforcement
      if (!researchDraft || researchDraft.trim() === '' || researchDraft === 'No research available') {
        throw new Error('PIPELINE_ABORTED: Critical research step failed. Escrow will be refunded.');
      }
        
      /* v8 ignore next */
      const gradeScore = isRecord(finalGrade) && typeof finalGrade.score === 'number' ? finalGrade.score : 0;
      const gradeGaps = isRecord(finalGrade) && Array.isArray(finalGrade.gaps) ? (finalGrade.gaps as string[]) : [];

      // --- NEW: THE FIDUCIARY ESCALATION PATH ---
      const CRITICAL_SCORE_THRESHOLD = 40;
      console.log(`[maestro] Quality Gate received Litmus Score: ${gradeScore}/100`);

      if (gradeScore < CRITICAL_SCORE_THRESHOLD && !input.forceEscalation) {
        console.error(`[maestro] 🚨 INTEGRITY FAULT: Draft quality (${gradeScore}) is below critical threshold.`);
        console.error(`[maestro] 🚨 Aborting pipeline to protect human buyer. Initiating CAPVault Escrow Refund.`);

        // Throwing this error allows the croo-core runProvider wrapper to catch it
        // and autonomously fire client.rejectOrder(order.orderId, String(err))
        throw new Error(
          `Fiduciary Refund Triggered: Subcontractor delivered a severely substandard payload ` +
          `(Litmus Score: ${gradeScore}/100). Maestro has autonomously halted the pipeline ` +
          `and refunded your USDC escrow to protect your capital.`
        );
      }

      
      const rawSummon = result.results.escalate;
      const summonResult = isRecord(rawSummon) ? rawSummon as { approved?: boolean; by?: string } : undefined;

      // AUTONOMOUS BUSINESS ECONOMICS (P&L)
      const profitUsdcRaw = budgetUsdc - result.totalSpent;
      const profitUsdc = Math.round(profitUsdcRaw * 1_000_000) / 1_000_000;
      
      // 🧠 ASSETIZATION: Calculate Live Enterprise Valuation
      const { lifetimeYield, valuation } = await recordTreasuryYield(profitUsdc);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traceCtx.emitTrace('treasury_yield' as any, 'Maestro', { budget: budgetUsdc, spent: result.totalSpent, marginRetained: profitUsdc, valuation });

      // Compose the brief and upload it as a verifiable PDF asset. The composer
      // uploads once and degrades gracefully (pdfKey is undefined on failure).
      const { brief, pdfKey } = await composeAndUploadBrief(
        client,
        order.orderId,
        input.topic,
        researchDraft,
        gradeScore,
        gradeGaps,
        summonResult,
        result.audit,
        profitUsdc,
        lifetimeYield,
        valuation
      );

      traceCtx.emitTrace('compose_done', 'Maestro', {
        briefLength: brief.length,
        score: gradeScore,
        approved: summonResult?.approved,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traceCtx.emitTrace((pdfKey ? 'upload_done' : 'upload_error') as any, 'Maestro', { pdfKey });

      const output: MaestroOutput = {
        brief,
        score: gradeScore,
        approvedBy: summonResult?.by,
        profitUsdc: profitUsdc.toString(), // <-- ADD THIS
        estimatedValuationUsdc: valuation.toString(), // <-- ADD THIS
        audit: result.audit.map(a => ({
          step: a.step, agent: a.agent, orderId: a.orderId,
          amount: a.amount, txHash: a.txHash, status: a.status,
        })),
        pdfKey, // Dynamically populated or gracefully undefined
      };

      return { type: 'schema', data: output };
      } finally {
        // Guarantee lock release even on failure
        activeOrders.delete(order.orderId);
      }
    },

    slaGuardMs: 1_500_000, // Increase SLA to 25 minutes to accommodate human-in-the-loop (Summon)
  });
}
