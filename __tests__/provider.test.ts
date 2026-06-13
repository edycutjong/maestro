/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startMaestroProvider } from '../src/provider.js';
import * as core from '@edycutjong/croo-core';
import * as hireEngine from '../src/hire-engine.js';
import * as planner from '../src/planner.js';

vi.mock('@edycutjong/croo-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edycutjong/croo-core')>();
  return { ...actual, runProvider: vi.fn() };
});

vi.mock('../src/hire-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/hire-engine.js')>();
  return { ...actual, executePipeline: vi.fn() };
});

describe('Maestro Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the provider with the correct service ID', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    
    expect(core.runProvider).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        slaGuardMs: 1_500_000,
        serviceMatch: expect.any(Function),
        work: expect.any(Function),
      })
    );
    
    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    
    // Test serviceMatch
    expect(config.serviceMatch({ service_id: 'maestro-service', event: 'negotiation' } as any)).toBe(true);
    expect(config.serviceMatch({ service_id: 'other', event: 'negotiation' } as any)).toBe(false);
  });

  it('throws an error if topic is missing from requirement', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work({ id: 'o1', requirement: {} } as any))
      .rejects.toThrow('Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.');
  });

  it('executes pipeline and composes final brief', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 95, gaps: [] },
      },
      audit: [
        { step: 'research', agent: 'Worker', orderId: 'o1', amount: '1.0', txHash: 'tx1', status: 'completed', startedAt: 0 }
      ],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const result = await config.work({ id: 'o_master', requirement: { topic: 'Testing' }, amount: '2.0' } as any);
    
    expect(hireEngine.executePipeline).toHaveBeenCalledWith(
      mockClient,
      expect.any(Array),
      expect.objectContaining({ topic: 'Testing', qualityThreshold: 80 }),
      2.0,
      'o_master',
      expect.any(Object)
    );
    
    expect(result.type).toBe('schema');
    expect((result.data as any).score).toBe(95);
    expect((result.data as any).brief).toContain('Mock research draft');
    expect((result.data as any).brief).toContain('95/100');
    expect((result.data as any).audit).toHaveLength(1);
  });

  it('includes gaps and human approval in the brief if present', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 70, gaps: ['Gap1', 'Gap2'] },
        escalate: { approved: true, by: 'telegram:operator' }
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const result = await config.work({ id: 'o_master', requirement: { topic: 'Testing' }, amount: '2.0' } as any);
    
    expect((result.data as any).brief).toContain('Gap1');
    expect((result.data as any).brief).toContain('telegram:operator');
  });

  it('indicates below threshold in the brief if score < 80 and no human approval', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 70, gaps: [] },
        escalate: { approved: false }
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const result = await config.work({ id: 'o_master2', requirement: { topic: 'Testing' }, amount: '2.0' } as any);
    
    expect((result.data as any).brief).toContain('Rejected');
  });

  it('triggers fiduciary escrow refund if score is below CRITICAL_SCORE_THRESHOLD (40)', async () => {
    const mockClient = { id: 'client-id', uploadFile: vi.fn().mockResolvedValue('mock-pdf-key') };
    await startMaestroProvider(mockClient as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Terrible hallucinated draft' },
        grade: { score: 25, gaps: ['Completely fabricated metrics'] },
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    await expect(config.work({ id: 'o_master_refund', requirement: { topic: 'Testing' }, amount: '2.0' } as any))
      .rejects.toThrow('Fiduciary Refund Triggered');
  });
});
