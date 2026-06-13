/**
 * Maestro — Provider module.
 *
 * Accepts orchestration orders, runs the fixed pipeline
 * (research → grade → [escalate] → compose), and delivers
 * the final vetted brief.
 */

import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable } from '@edycutjong/croo-core';
import { buildPipeline } from './planner.js';
import type { PipelineContext } from './planner.js';
import { executePipeline } from './hire-engine.js';
import { emitTrace, clearTraceLog } from './trace.js';
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
      const input = order.requirement as unknown as MaestroInput;
      if (!input?.topic) {
        throw new Error('Missing required field: topic');
      }

      console.log(`[maestro] Order ${order.id}: orchestrating pipeline for "${input.topic}"`);

      // Clear trace log for this run
      clearTraceLog(order.id);

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
      const result = await executePipeline(client, pipeline, context, budgetUsdc, order.id);

      // Compose the final brief using fallback results if they exist
      const finalResearch = result.results.fallback_research || result.results.research;
      const finalGrade = result.results.fallback_grade || result.results.grade;
      const researchDraft = (finalResearch as { draft?: string })?.draft;
      
      // Architecture: Strict Refund Enforcement
      if (!researchDraft || researchDraft.trim() === '') {
        throw new Error('PIPELINE_ABORTED: Critical research step failed. Escrow will be refunded.');
      }
      
      const gradeResult = finalGrade as { score?: number; gaps?: string[] } | undefined;
      const summonResult = result.results.escalate as { approved?: boolean; by?: string } | undefined;

      // Replace the local string composition with the new composer:
      const { brief, pdfKey } = await composeAndUploadBrief(
        client,
        order.id,
        input.topic,
        researchDraft,
        gradeResult?.score ?? 0,
        gradeResult?.gaps ?? [],
        summonResult
      );

      emitTrace(order.id, 'compose_done', 'Maestro', {
        briefLength: brief.length,
        score: gradeResult?.score,
        approved: summonResult?.approved,
      });

      const output: MaestroOutput = {
        brief,
        score: gradeResult?.score ?? 0,
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



/**
 * Get the trace log for the current/last run (for the UI).
 */
export { getTraceLog } from './trace.js';
