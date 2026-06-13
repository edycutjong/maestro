import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable } from '@edycutjong/croo-core';
import { buildPipeline } from './planner.js';
import type { PipelineContext } from './planner.js';
import { executePipeline } from './hire-engine.js';
import { TraceContext } from './trace.js';
import { composeAndUploadBrief } from './composer.js';

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

// ─── Provider ──────────────────────────────────────────────────────

/**
 * Start the Maestro provider loop.
 */
export async function startMaestroProvider(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  serviceId: string,
): Promise<unknown> {
  const serviceIds = getServiceIds();
  const pipeline = buildPipeline(serviceIds);

  return runProvider<unknown>(client, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serviceMatch: (event: any) => {
      return event.service_id === serviceId;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    work: async (order: any): Promise<Deliverable<unknown>> => {
      if (!isMaestroInput(order.requirement)) {
         throw new Error('Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.');
      }
      const input = order.requirement;

      console.log(`[maestro] Order ${order.id}: orchestrating pipeline for "${input.topic}"`);

      const traceCtx = new TraceContext(order.id);

      // Build pipeline context
      const context: PipelineContext = {
        topic: input.topic,
        qualityThreshold: input.qualityThreshold ?? 80,
        forceEscalation: input.forceEscalation ?? false,
        results: {},
      };

      // Security: Prevent NaN budget bypasses
      let budgetUsdc = parseFloat(order.amount ?? '2.0');
      if (Number.isNaN(budgetUsdc)) budgetUsdc = 2.0;

      // Execute the pipeline (sequential hires)
      const result = await executePipeline(client, pipeline, context, budgetUsdc, order.id, traceCtx);

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
        
      const gradeScore = isRecord(finalGrade) && typeof finalGrade.score === 'number' ? finalGrade.score : 0;
      const gradeGaps = isRecord(finalGrade) && Array.isArray(finalGrade.gaps) ? (finalGrade.gaps as string[]) : [];
      
      const rawSummon = result.results.escalate;
      const summonResult = isRecord(rawSummon) ? rawSummon as { approved?: boolean; by?: string } : undefined;

      // Replace the local string composition with the new composer:
      const { brief, pdfKey } = await composeAndUploadBrief(
        client,
        order.id,
        input.topic,
        researchDraft,
        gradeScore,
        gradeGaps,
        summonResult
      );

      traceCtx.emitTrace('compose_done', 'Maestro', {
        briefLength: brief.length,
        score: gradeScore,
        approved: summonResult?.approved,
      });

      const output: MaestroOutput = {
        brief,
        score: gradeScore,
        approvedBy: summonResult?.by,
        audit: result.audit.map(a => ({
          step: a.step, agent: a.agent, orderId: a.orderId,
          amount: a.amount, txHash: a.txHash, status: a.status,
        })),
        pdfKey,
      };

      return { type: 'schema', data: output };
    },

    slaGuardMs: 120_000, // 2 min guard (pipeline takes time)
  });
}
