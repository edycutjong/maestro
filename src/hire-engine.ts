/**
 * Maestro — Hiring engine.
 *
 * Executes the pipeline by hiring each agent SEQUENTIALLY.
 * Never parallel payOrder — AA nonce collisions will crash the demo.
 *
 * Tracks budget per step and maintains a full audit trail.
 */

import { hire } from 'croo-core';
import type { AuditEntry } from 'croo-core';
import type { PipelineStep, PipelineContext } from './planner.js';
import { emitTrace, createTraceEmitter } from './trace.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentClient = any;

export interface HireEngineResult {
  /** Accumulated results from all steps. */
  results: Record<string, unknown>;
  /** Full audit trail of sub-orders. */
  audit: AuditEntry[];
  /** Total USDC spent on sub-orders. */
  totalSpent: number;
  /** Total time for the entire pipeline. */
  totalMs: number;
}

/**
 * Execute the pipeline by hiring each agent sequentially.
 *
 * @param client - An initialized CROO AgentClient
 * @param pipeline - The pipeline steps from buildPipeline()
 * @param context - The initial pipeline context (topic, threshold, etc.)
 * @param budgetUsdc - Maximum USDC to spend across all steps
 */
export async function executePipeline(
  client: AgentClient,
  pipeline: PipelineStep[],
  context: PipelineContext,
  budgetUsdc: number,
): Promise<HireEngineResult> {
  const audit: AuditEntry[] = [];
  let totalSpent = 0;
  const startMs = Date.now();
  const traceEmitter = createTraceEmitter();

  emitTrace('pipeline_start', 'Maestro', { topic: context.topic });

  for (const step of pipeline) {
    // Check conditional — skip if the step's condition isn't met
    if (step.conditional && !step.conditional(context)) {
      console.log(`[maestro/hire] Skipping step "${step.name}" (condition not met)`);
      continue;
    }

    // Check budget
    if (totalSpent >= budgetUsdc) {
      console.warn(`[maestro/hire] Budget exhausted (${totalSpent}/${budgetUsdc} USDC) — stopping pipeline`);
      emitTrace('pipeline_error', 'Maestro', { error: 'budget_exhausted', spent: totalSpent });
      break;
    }

    console.log(`[maestro/hire] Step "${step.name}" — hiring ${step.agent}...`);

    const requirement = step.buildRequirement(context);

    const auditEntry: AuditEntry = {
      step: step.name,
      agent: step.agent,
      orderId: '',
      amount: '',
      status: 'pending',
      startedAt: Date.now(),
    };

    try {
      emitTrace('hire_start', step.agent, { step: step.name });

      const result = await hire(
        client,
        { serviceId: step.serviceId, requirement },
        traceEmitter,
      );

      auditEntry.orderId = result.orderId;
      auditEntry.amount = result.amountPaid ?? '0';
      auditEntry.txHash = result.txHash;
      auditEntry.status = 'completed';
      auditEntry.completedAt = Date.now();

      totalSpent += parseFloat(result.amountPaid ?? '0');

      // Store the result for downstream steps
      context.results[step.name] = result.delivery;

      console.log(
        `[maestro/hire] Step "${step.name}" completed — ` +
        `orderId=${result.orderId}, paid=${result.amountPaid}, ${result.durationMs}ms`,
      );
    } catch (err) {
      auditEntry.status = 'failed';
      auditEntry.completedAt = Date.now();

      emitTrace('hire_failed', step.agent, {
        step: step.name,
        error: String(err),
      });

      console.error(`[maestro/hire] Step "${step.name}" FAILED:`, err);

      // For research step failure, abort the whole pipeline
      if (step.name === 'research') {
        throw new Error(`Critical step "${step.name}" failed: ${err}`);
      }
      // For non-critical steps, continue with degraded output
    }

    audit.push(auditEntry);
  }

  // Check quality gate result
  const gradeResult = context.results.grade as { score?: number } | undefined;
  if (gradeResult) {
    const shouldEscalate = context.forceEscalation || (gradeResult.score ?? 100) < context.qualityThreshold;
    emitTrace('gate_check', 'Maestro', {
      score: gradeResult.score,
      threshold: context.qualityThreshold,
      forceEscalation: context.forceEscalation,
      escalated: shouldEscalate,
    });
  }

  emitTrace('pipeline_done', 'Maestro', {
    totalSpent,
    totalMs: Date.now() - startMs,
    steps: audit.length,
  });

  return {
    results: context.results,
    audit,
    totalSpent,
    totalMs: Date.now() - startMs,
  };
}
