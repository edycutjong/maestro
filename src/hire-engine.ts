import { hire } from '@edycutjong/croo-core';
import type { AuditEntry } from '@edycutjong/croo-core';
import type { PipelineStep, PipelineContext } from './planner.js';
import { loadState, saveState, clearState } from './state.js';
import type { TraceContext } from './trace.js';

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

export async function executePipeline(
  client: AgentClient,
  pipeline: PipelineStep[],
  context: PipelineContext,
  budgetUsdc: number,
  maestroOrderId: string,
  traceCtx: TraceContext // INJECT DEPENDENCY
): Promise<HireEngineResult> {
  let audit: AuditEntry[] = [];
  let totalSpent = 0;
  const startMs = Date.now();
  const traceEmitter = traceCtx.createTraceEmitter();
  let completedSteps: string[] = [];

  // Await Async State
  const existingState = await loadState(maestroOrderId);
  if (existingState) {
    console.log(`[maestro/hire] Resuming pipeline for order ${maestroOrderId}...`);
    audit = existingState.audit;
    totalSpent = existingState.totalSpent;
    context.results = existingState.results;
    completedSteps = existingState.completedSteps;
    traceCtx.emitTrace('pipeline_resume', 'Maestro', { topic: context.topic, resumedSteps: completedSteps });
  } else {
    traceCtx.emitTrace('pipeline_start', 'Maestro', { topic: context.topic });
  }

  for (const step of pipeline) {
    if (step.conditional && !step.conditional(context)) continue;
    if (completedSteps.includes(step.name)) continue;

    if (totalSpent >= budgetUsdc) {
      console.warn(`[maestro/hire] Budget exhausted — stopping pipeline`);
      traceCtx.emitTrace('pipeline_error', 'Maestro', { error: 'budget_exhausted', spent: totalSpent });
      break;
    }

    const requirement = step.buildRequirement(context);
    const auditEntry: AuditEntry = {
      step: step.name, agent: step.agent, orderId: '', amount: '', status: 'pending', startedAt: Date.now(),
    };

    try {
      traceCtx.emitTrace('hire_start', step.agent, { step: step.name });

      let result;
      let retries = 3;
      // Implement Exponential Backoff for Network Resilience
      while (retries > 0) {
        try {
          result = await hire(client, { serviceId: step.serviceId, requirement }, traceEmitter);
          break; // Success, exit retry loop
        } catch (err) {
          retries--;
          if (retries === 0) throw err;
          await new Promise(r => setTimeout(r, Math.pow(2, 3 - retries) * 1000));
        }
      }

      auditEntry.orderId = result!.orderId;
      auditEntry.amount = result!.amountPaid ?? '0';
      auditEntry.txHash = result!.txHash;
      auditEntry.status = 'completed';
      auditEntry.completedAt = Date.now();

      totalSpent += parseFloat(result!.amountPaid ?? '0');
      context.results[step.name] = result!.delivery;

    } catch (err) {
      auditEntry.status = 'failed';
      auditEntry.completedAt = Date.now();
      traceCtx.emitTrace('hire_failed', step.agent, { step: step.name, error: String(err) });
      if (step.name === 'research') throw new Error(`Critical step "${step.name}" failed: ${err}`);
    }

    audit.push(auditEntry);
    if (auditEntry.status === 'completed') completedSteps.push(step.name);
    
    // Await Async State
    await saveState({
      orderId: maestroOrderId, topic: context.topic, qualityThreshold: context.qualityThreshold, forceEscalation: context.forceEscalation, totalSpent, results: context.results, audit, completedSteps,
    });
  }

  // Type Safe narrowing
  const rawGrade = context.results.grade;
  const isObj = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null;
  const score = isObj(rawGrade) && typeof rawGrade.score === 'number' ? rawGrade.score : undefined;
  
  if (score !== undefined) {
    const shouldEscalate = context.forceEscalation || score < context.qualityThreshold;
    traceCtx.emitTrace('gate_check', 'Maestro', { score, threshold: context.qualityThreshold, forceEscalation: context.forceEscalation, escalated: shouldEscalate });
  }

  traceCtx.emitTrace('pipeline_done', 'Maestro', { totalSpent, totalMs: Date.now() - startMs, steps: audit.length });
  
  // Await Async State
  await clearState(maestroOrderId);

  return { results: context.results, audit, totalSpent, totalMs: Date.now() - startMs };
}
