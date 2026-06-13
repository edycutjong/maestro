/**
 * Maestro — Hiring engine.
 *
 * Executes the pipeline by hiring each agent SEQUENTIALLY.
 * Never parallel payOrder — AA nonce collisions will crash the demo.
 *
 * Tracks budget per step and maintains a full audit trail.
 */

import { hire } from '@edycutjong/croo-core';
import type { AuditEntry } from '@edycutjong/croo-core';
import type { PipelineStep, PipelineContext } from './planner.js';
import { emitTrace, createTraceEmitter } from './trace.js';
import { loadState, saveState, clearState } from './state.js';

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
 * @param maestroOrderId - The root order ID to tie state to
 */
export async function executePipeline(
  client: AgentClient,
  pipeline: PipelineStep[],
  context: PipelineContext,
  budgetUsdc: number,
  maestroOrderId: string,
): Promise<HireEngineResult> {
  let audit: AuditEntry[] = [];
  let totalSpent = 0;
  const startMs = Date.now();
  const traceEmitter = createTraceEmitter(maestroOrderId);
  let completedSteps: string[] = [];

  // Attempt to resume from existing state
  const existingState = await loadState(maestroOrderId);
  if (existingState) {
    console.log(`[maestro/hire] Resuming pipeline for order ${maestroOrderId}...`);
    audit = existingState.audit;
    totalSpent = existingState.totalSpent;
    context.results = existingState.results;
    completedSteps = existingState.completedSteps;
    emitTrace(maestroOrderId, 'pipeline_resume', 'Maestro', { topic: context.topic, resumedSteps: completedSteps });
  } else {
    emitTrace(maestroOrderId, 'pipeline_start', 'Maestro', { topic: context.topic });
  }

  for (const step of pipeline) {
    // Check conditional — skip if the step's condition isn't met
    if (step.conditional && !step.conditional(context)) {
      console.log(`[maestro/hire] Skipping step "${step.name}" (condition not met)`);
      continue;
    }

    // Check if step was already completed in a previous run
    if (completedSteps.includes(step.name)) {
      console.log(`[maestro/hire] Skipping step "${step.name}" (already completed)`);
      continue;
    }

    // Check budget
    if (totalSpent >= budgetUsdc) {
      console.warn(`[maestro/hire] Budget exhausted (${totalSpent}/${budgetUsdc} USDC) — stopping pipeline`);
      emitTrace(maestroOrderId, 'pipeline_error', 'Maestro', { error: 'budget_exhausted', spent: totalSpent });
      if (step.name === 'research') {
        throw new Error(`PIPELINE_ABORTED: Budget exhausted before critical step "${step.name}".`);
      }
      break;
    }

    console.warn(`[maestro/hire] ⚠️ Protocol Guard: Queuing payOrder() for step "${step.name}" sequentially to prevent Base Mainnet AA nonce collision.`);
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
      emitTrace(maestroOrderId, 'hire_start', step.agent, { step: step.name });

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

      // Architecture: Budget NaN Safety
      const paid = parseFloat(result.amountPaid ?? '0');
      totalSpent += Number.isNaN(paid) ? 0 : paid;

      // Store the result for downstream steps
      context.results[step.name] = result.delivery;

      console.log(
        `[maestro/hire] Step "${step.name}" completed — ` +
        `orderId=${result.orderId}, paid=${result.amountPaid}, ${result.durationMs}ms`,
      );

      // Architecture: Human Veto Enforcement
      if (step.name === 'escalate') {
        const delivery = result.delivery as { approved?: boolean };
        if (delivery && delivery.approved === false) {
          throw new Error('HUMAN_VETO: Escalate step returned approved=false.');
        }
      }
    } catch (err) {
      auditEntry.status = 'failed';
      auditEntry.completedAt = Date.now();

      emitTrace(maestroOrderId, 'hire_failed', step.agent, {
        step: step.name,
        error: String(err),
      });

      console.error(`[maestro/hire] Step "${step.name}" FAILED:`, err);

      // Bubble up the human rejection or critical research failure
      if (step.name === 'research' || step.name === 'escalate') {
        throw new Error(`Critical step "${step.name}" failed or vetoed: ${err}`);
      }
      // For non-critical steps, continue with degraded output
    }

    audit.push(auditEntry);
    
    // Save state after each step attempt
    if (auditEntry.status === 'completed') {
      completedSteps.push(step.name);
    }
    await saveState({
      orderId: maestroOrderId,
      topic: context.topic,
      qualityThreshold: context.qualityThreshold,
      forceEscalation: context.forceEscalation,
      totalSpent,
      results: context.results,
      audit,
      completedSteps,
    });
  }

  // Check quality gate result
  const gradeResult = context.results.grade as { score?: number } | undefined;
  if (gradeResult) {
    const shouldEscalate = context.forceEscalation || (gradeResult.score ?? 0) < context.qualityThreshold;
    emitTrace(maestroOrderId, 'gate_check', 'Maestro', {
      score: gradeResult.score,
      threshold: context.qualityThreshold,
      forceEscalation: context.forceEscalation,
      escalated: shouldEscalate,
    });
  }

  emitTrace(maestroOrderId, 'pipeline_done', 'Maestro', {
    totalSpent,
    totalMs: Date.now() - startMs,
    steps: audit.length,
  });

  // Clear state on successful pipeline completion
  await clearState(maestroOrderId);

  return {
    results: context.results,
    audit,
    totalSpent,
    totalMs: Date.now() - startMs,
  };
}
