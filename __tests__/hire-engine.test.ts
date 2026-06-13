/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePipeline } from '../src/hire-engine.js';
import * as core from '@edycutjong/croo-core';
import * as state from '../src/state.js';
import type { PipelineStep } from '../src/planner.js';
import { TraceContext } from '../src/trace.js';

vi.mock('@edycutjong/croo-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edycutjong/croo-core')>();
  return { ...actual, hire: vi.fn() };
});

vi.mock('../src/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state.js')>();
  return { ...actual, loadState: vi.fn(), saveState: vi.fn(), clearState: vi.fn() };
});

describe('Maestro Hire Engine', () => {
  const mockClient = { id: 'client-id' };
  let traceCtx: TraceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(state.loadState).mockResolvedValue(null);
    traceCtx = new TraceContext('master_order');
    vi.stubGlobal('setTimeout', (cb: any) => cb());
  });

  it('executes a pipeline sequentially and tracks budget', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'step1', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({ req: 1 }) },
      { name: 'step2', agent: 'Agent2', serviceId: 'svc2', buildRequirement: () => ({ req: 2 }) },
    ];

    vi.mocked(core.hire)
      .mockResolvedValueOnce({ orderId: 'o1', amountPaid: '1.0', txHash: 'tx1', durationMs: 100, delivery: { res: 1 } } as any)
      .mockResolvedValueOnce({ orderId: 'o2', amountPaid: '0.5', txHash: 'tx2', durationMs: 100, delivery: { res: 2 } } as any);

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    expect(core.hire).toHaveBeenCalledTimes(2);
    expect(result.totalSpent).toBe(1.5);
    expect(result.audit).toHaveLength(2);
    expect(result.audit[0].status).toBe('completed');
    expect(result.results.step1).toEqual({ res: 1 });
    expect(result.results.step2).toEqual({ res: 2 });
    expect(state.saveState).toHaveBeenCalledTimes(2);
    expect(state.clearState).toHaveBeenCalledWith('master_order');
  });

  it('skips conditional steps if condition is false', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'step1', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
      { name: 'step2', agent: 'Agent2', serviceId: 'svc2', conditional: () => false, buildRequirement: () => ({}) },
    ];

    vi.mocked(core.hire).mockResolvedValueOnce({ orderId: 'o1', amountPaid: '1.0', durationMs: 100, delivery: {} } as any);

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    expect(core.hire).toHaveBeenCalledTimes(1);
    expect(result.audit).toHaveLength(1);
  });

  it('stops if budget is exhausted', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'step1', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
      { name: 'step2', agent: 'Agent2', serviceId: 'svc2', buildRequirement: () => ({}) },
    ];

    vi.mocked(core.hire).mockResolvedValueOnce({ orderId: 'o1', amountPaid: '5.0', durationMs: 100, delivery: {} } as any);

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    expect(core.hire).toHaveBeenCalledTimes(1);
    expect(result.audit).toHaveLength(1);
    expect(result.totalSpent).toBe(5.0);
  });

  it('throws and aborts on critical step failure (research)', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'research', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
      { name: 'step2', agent: 'Agent2', serviceId: 'svc2', buildRequirement: () => ({}) },
    ];

    vi.mocked(core.hire).mockRejectedValue(new Error('Agent offline'));

    await expect(executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx))
      .rejects.toThrow('Critical step "research" failed');

    expect(core.hire).toHaveBeenCalledTimes(3); 
  });

  it('continues and records failed audit on non-critical step failure', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'grade', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
    ];

    vi.mocked(core.hire).mockRejectedValue(new Error('Agent offline'));

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    expect(result.audit[0].status).toBe('failed');
    expect(state.saveState).toHaveBeenCalled();
  });

  it('resumes from existing state if loaded', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'step1', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
      { name: 'step2', agent: 'Agent2', serviceId: 'svc2', buildRequirement: () => ({}) },
    ];

    vi.mocked(state.loadState).mockResolvedValue({
      orderId: 'master_order',
      topic: 'test',
      qualityThreshold: 80,
      forceEscalation: false,
      totalSpent: 1.0,
      results: { step1: { done: true } },
      audit: [{ step: 'step1', status: 'completed', amount: '1.0' } as any],
      completedSteps: ['step1'],
    });

    vi.mocked(core.hire).mockResolvedValueOnce({ orderId: 'o2', amountPaid: '0.5', durationMs: 100, delivery: { done: true } } as any);

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    expect(core.hire).toHaveBeenCalledTimes(1);
    expect(result.totalSpent).toBe(1.5);
    expect(result.audit).toHaveLength(2);
  });

  it('emits gate_check trace if grade result is present', async () => {
    const pipeline: PipelineStep[] = [
      { name: 'grade', agent: 'Agent1', serviceId: 'svc1', buildRequirement: () => ({}) },
    ];

    vi.mocked(core.hire).mockResolvedValueOnce({ orderId: 'o1', amountPaid: '1.0', durationMs: 100, delivery: { score: 75 } } as any);

    const result = await executePipeline(mockClient as any, pipeline, { topic: 'test', qualityThreshold: 80, forceEscalation: false, results: {} }, 5.0, 'master_order', traceCtx);

    const log = traceCtx.getTraceLog();
    const gateCheck = log.find(e => e.type === 'gate_check');
    expect(gateCheck).toBeDefined();
    expect(gateCheck?.data).toMatchObject({ score: 75, threshold: 80, escalated: true });
  });
});
