import { hire } from '@edycutjong/croo-core';
import type { AuditEntry } from '@edycutjong/croo-core';
import type { PipelineStep, PipelineContext } from './planner.js';
import { loadState, saveState, clearState } from './state.js';
import type { TraceContext } from './trace.js';
import { updateReputation, sortProvidersByEfficiency } from './reputation.js';

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

    // FINANCIAL GUARD: Do not hire if SLA is nearing expiration (60s buffer)
    if (context.absoluteDeadline && Date.now() + 60_000 > context.absoluteDeadline) {
      console.error(`[maestro/hire] 🛑 SLA critical limit reached for ${maestroOrderId}. Aborting outbound hires to prevent capital drain.`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traceCtx.emitTrace('pipeline_warn' as any, 'Maestro', { warning: 'sla_limit_reached', step: step.name });
      break; // Break the loop, salvage partial results, and compose what we have
    }

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

      const rawTargetIds = Array.isArray(step.serviceId) ? step.serviceId : [step.serviceId];
      
      // 🧠 FREE-MARKET OPTIMIZER: Rank vendors by capital efficiency (YQR)
      const targetServiceIds = await sortProvidersByEfficiency(rawTargetIds);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastErr: any = null;
      let successfulSvcId: string | null = null;

      // SERVICE-MESH CASCADE ROUTER: Iterate through redundant providers
      for (const currentSvcId of targetServiceIds) {
        if (!currentSvcId) continue;

        let retries = 3;
        while (retries > 0 && !result) {
          try {
            const timeRemaining = context.absoluteDeadline ? context.absoluteDeadline - Date.now() - 45_000 : 300_000;
            if (timeRemaining <= 0) throw new Error('Insufficient SLA time remaining to hire sub-agent.');

            let timer: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Sub-agent execution timed out`)), timeRemaining);
              if (timer?.unref) timer.unref(); 
            });

            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              traceCtx.emitTrace('hire_attempt' as any, step.agent, { target: currentSvcId, step: step.name });
              result = await Promise.race([
                hire(client, { serviceId: currentSvcId, requirement }, traceEmitter),
                timeoutPromise
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          } catch (err) {
            lastErr = err;
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, Math.pow(2, 3 - retries) * 1000));
          }
        }

        if (result) {
          successfulSvcId = currentSvcId;
          if (currentSvcId !== targetServiceIds[0]) {
             auditEntry.agent = `${step.agent} (Failover Node)`;
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             traceCtx.emitTrace('failover_success' as any, step.agent, { backupServiceId: currentSvcId });
          }
          break; // Success! Exit the cascade mesh loop.
        } else {
          console.warn(`[maestro/hire] Provider ${currentSvcId} failed completely. Cascading to next backup in mesh...`);
          // 🛡️ IMMUNE SYSTEM: Record network/SLA failure
          await updateReputation(currentSvcId, null, true);
        }
      }

      if (!result) {
        auditEntry.status = 'failed';
        auditEntry.completedAt = Date.now();
        traceCtx.emitTrace('hire_failed', step.agent, { step: step.name, error: String(lastErr) });
        audit.push(auditEntry);
        await saveState({
          orderId: maestroOrderId, topic: context.topic, qualityThreshold: context.qualityThreshold, forceEscalation: context.forceEscalation, totalSpent, results: context.results, audit, completedSteps,
        });
        if (step.name === 'research') throw new Error(`Critical step "${step.name}" failed across all failover nodes: ${lastErr}`);
        continue;
      }

      auditEntry.orderId = result!.orderId;
      auditEntry.txHash = result!.txHash;
      auditEntry.status = 'completed';
      auditEntry.completedAt = Date.now();

      // ZERO-TRUST FINANCIAL GUARD: Validate sub-agent reported cost
      const rawPaid = result!.amountPaid ?? '0';
      const paidFloat = parseFloat(rawPaid);

      if (Number.isNaN(paidFloat) || paidFloat < 0) {
        throw new Error(`[maestro/security] Sub-agent returned invalid amountPaid: ${rawPaid}`);
      }

      auditEntry.amount = paidFloat.toString();

      // Track the vendor and capital efficiency for the research step
      if (step.name === 'research' || step.name === 'fallback_research') {
        context.vendorIdUsed = successfulSvcId!;
        context.vendorCostUsed = paidFloat;
      }

      // USDC PRECISION: Clamp to 6 decimals to prevent IEEE-754 float drift
      totalSpent = Math.round((totalSpent + paidFloat) * 1_000_000) / 1_000_000;
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
    // 🧠 QUALITY & COST ORACLE: Update ledger with Score AND Cost
    if (context.vendorIdUsed) {
      await updateReputation(context.vendorIdUsed, score, false, context.vendorCostUsed);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traceCtx.emitTrace('vendor_rated' as any, 'Maestro', { 
        vendor: context.vendorIdUsed, 
        score, 
        cost: context.vendorCostUsed 
      });
    }

    const shouldEscalate = context.forceEscalation || score < context.qualityThreshold;
    traceCtx.emitTrace('gate_check', 'Maestro', { score, threshold: context.qualityThreshold, forceEscalation: context.forceEscalation, escalated: shouldEscalate });
  }

  traceCtx.emitTrace('pipeline_done', 'Maestro', { totalSpent, totalMs: Date.now() - startMs, steps: audit.length });
  
  // Await Async State
  await clearState(maestroOrderId);

  return { results: context.results, audit, totalSpent, totalMs: Date.now() - startMs };
}
