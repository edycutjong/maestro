/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startMaestroProvider, getActiveOrderCount } from '../src/provider.js';
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

/** SDK-shaped Order (camelCase, no inline requirement). */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'o1',
    negotiationId: 'n1',
    serviceId: 'maestro-service',
    price: '2.0',
    slaDeadline: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** Client whose negotiation carries `requirement`, plus a configurable uploadFile. */
function makeClient(requirement: unknown, opts: { uploadOk?: boolean } = {}) {
  const { uploadOk = true } = opts;
  return {
    id: 'client-id',
    getNegotiation: vi.fn().mockResolvedValue({
      negotiationId: 'n1',
      requirements: typeof requirement === 'string' ? requirement : JSON.stringify(requirement),
    }),
    uploadFile: uploadOk
      ? vi.fn().mockResolvedValue('mock-pdf-key')
      : vi.fn().mockRejectedValue(new Error('Upload failed')),
  };
}

describe('Maestro Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the provider with the correct service ID', async () => {
    const client = makeClient({ topic: 'x' });
    await startMaestroProvider(client as any, 'maestro-service');

    expect(core.runProvider).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        slaGuardMs: 1_500_000,
        serviceMatch: expect.any(Function),
        work: expect.any(Function),
      })
    );

    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    expect(config.serviceMatch({ service_id: 'maestro-service' } as any)).toBe(true);
    expect(config.serviceMatch({ service_id: 'other' } as any)).toBe(false);
  });

  it('throws if topic is missing from the negotiation requirements', async () => {
    const client = makeClient({});
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any))
      .rejects.toThrow('Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.');
  });

  it('throws if the negotiation requirements are not valid JSON', async () => {
    const client = makeClient('not-json');
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any))
      .rejects.toThrow('Invalid payload: Missing or malformed requirement object.');
  });

  it('throws if the negotiation cannot be loaded', async () => {
    const client = { id: 'c', getNegotiation: vi.fn().mockRejectedValue(new Error('boom')), uploadFile: vi.fn() };
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any)).rejects.toThrow('failed to load negotiation');
  });

  it('executes pipeline and composes final brief', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
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

    const result = await config.work(makeOrder({ orderId: 'o_master' }) as any);

    expect(hireEngine.executePipeline).toHaveBeenCalledWith(
      client,
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
    expect((result.data as any).pdfKey).toBe('mock-pdf-key');
  });

  it('includes gaps and human approval in the brief if present', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
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

    const result = await config.work(makeOrder({ orderId: 'o_master' }) as any);

    expect((result.data as any).brief).toContain('Gap1');
    expect((result.data as any).brief).toContain('telegram:operator');
  });

  it('indicates below threshold in the brief if score < 80 and human rejected', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
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

    const result = await config.work(makeOrder({ orderId: 'o_master2' }) as any);

    expect((result.data as any).brief).toContain('Rejected');
  });

  it('triggers fiduciary escrow refund if score is below CRITICAL_SCORE_THRESHOLD (40)', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
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

    await expect(config.work(makeOrder({ orderId: 'o_master_refund' }) as any))
      .rejects.toThrow('Fiduciary Refund Triggered');
  });

  it('handles PDF upload failure gracefully', async () => {
    const client = makeClient({ topic: 'Testing' }, { uploadOk: false });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 95, gaps: [] },
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const result = await config.work(makeOrder({ orderId: 'o_master3' }) as any);
    expect(result.type).toBe('schema');
    expect((result.data as any).pdfKey).toBeUndefined();
  });

  it('rejects concurrent duplicate orders (idempotency guard)', async () => {
    const client = makeClient({ topic: 'T' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return { results: { research: { draft: 'x' }, grade: { score: 90 } }, audit: [], totalSpent: 1.0, totalMs: 100 } as any;
    });

    const p1 = config.work(makeOrder({ orderId: 'o_idem' }) as any);
    const p2 = config.work(makeOrder({ orderId: 'o_idem' }) as any);

    await expect(p2).rejects.toThrow('Duplicate order execution rejected to prevent double-spend.');
    await p1;
  });

  it('throws an error for invalid order prices', async () => {
    const client = makeClient({ topic: 'T' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder({ orderId: 'o_amt', price: 'invalid' }) as any))
      .rejects.toThrow('Invalid order price');
    await expect(config.work(makeOrder({ orderId: 'o_amt2', price: '-5.0' }) as any))
      .rejects.toThrow('Invalid order price');
  });

  it('aborts and refunds on malformed delivery shapes', async () => {
    const client = makeClient({ topic: 'T' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: { research: 'not an object', grade: { score: 'not a number' } }, audit: [], totalSpent: 1.0, totalMs: 100
    } as any);

    await expect(config.work(makeOrder({ orderId: 'o_malformed' }) as any))
      .rejects.toThrow('PIPELINE_ABORTED: Critical research step failed');
  });

  it('aborts pipeline and refunds if research draft is missing or empty', async () => {
    const client = makeClient({ topic: 'T' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: { research: { draft: '' }, grade: { score: 90 } }, audit: [], totalSpent: 1.0, totalMs: 100
    });

    await expect(config.work(makeOrder({ orderId: 'o_empty' }) as any))
      .rejects.toThrow('PIPELINE_ABORTED: Critical research step failed');
  });

  it('handles invalid summon result shape gracefully', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 95, gaps: [] },
        escalate: 'not-an-object'
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const result = await config.work(makeOrder({ orderId: 'o_master_invalid_summon' }) as any);
    expect((result.data as any).brief).toContain('Not Required');
  });

  it('handles null/undefined negotiation or requirements gracefully (line 67 coverage)', async () => {
    const clientNullNegotiation = {
      id: 'c',
      getNegotiation: vi.fn().mockResolvedValue(null),
      uploadFile: vi.fn(),
    };
    await startMaestroProvider(clientNullNegotiation as any, 'maestro-service');
    const configNull = vi.mocked(core.runProvider).mock.calls[0][1];
    await expect(configNull.work(makeOrder() as any))
      .rejects.toThrow('Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.');

    const clientNoRequirements = {
      id: 'c',
      getNegotiation: vi.fn().mockResolvedValue({ negotiationId: 'n1' }),
      uploadFile: vi.fn(),
    };
    await startMaestroProvider(clientNoRequirements as any, 'maestro-service');
    const configNoReq = vi.mocked(core.runProvider).mock.calls[0][1];
    await expect(configNoReq.work(makeOrder() as any))
      .rejects.toThrow('Invalid payload: Missing or malformed requirement object. Expected MaestroInput schema.');
  });

  it('handles missing/invalid slaDeadline gracefully (lines 135-136 coverage)', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    vi.mocked(hireEngine.executePipeline).mockResolvedValueOnce({
      results: {
        research: { draft: 'Mock research draft' },
        grade: { score: 95, gaps: [] },
      },
      audit: [],
      totalSpent: 1.0,
      totalMs: 100,
    });

    const orderNoSla = makeOrder({ orderId: 'o_no_sla' });
    delete (orderNoSla as any).slaDeadline;

    const result = await config.work(orderNoSla as any);
    expect(result.type).toBe('schema');
    expect((result.data as any).score).toBe(95);
  });

  it('handles missing order price gracefully (line 150 coverage)', async () => {
    const client = makeClient({ topic: 'Testing' });
    await startMaestroProvider(client as any, 'maestro-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    const orderNoPrice = makeOrder({ orderId: 'o_no_price' });
    delete (orderNoPrice as any).price;

    await expect(config.work(orderNoPrice as any))
      .rejects.toThrow('Invalid order price');
  });

  it('tracks and returns the active order count', () => {
    expect(getActiveOrderCount()).toBe(0);
  });
});
