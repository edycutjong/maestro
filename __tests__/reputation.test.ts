import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { updateReputation, sortProvidersByEfficiency, readLedger } from '../src/reputation.js';

const REP_FILE = path.join(process.cwd(), 'data', 'reputation_ledger.json');

describe('Maestro Reputation', () => {
  beforeEach(() => {
    if (fs.existsSync(REP_FILE)) fs.unlinkSync(REP_FILE);
  });
  afterEach(() => {
    if (fs.existsSync(REP_FILE)) fs.unlinkSync(REP_FILE);
  });

  it('updateReputation creates new entry with defaults', async () => {
    await updateReputation('svc1', null, false);
    const ledger = await readLedger();
    expect(ledger['svc1'].totalHires).toBe(1);
    expect(ledger['svc1'].failures).toBe(0);
    expect(ledger['svc1'].averageScore).toBe(100);
    expect(ledger['svc1'].averageCost).toBe(0);
    expect(ledger['svc1'].blacklisted).toBe(false);
  });

  it('updateReputation updates score and cost', async () => {
    await updateReputation('svc1', null, false); // hire 1, score 100, cost 0
    await updateReputation('svc1', 50, false, 10); // hire 2, score 50, cost 10
    const ledger = await readLedger();
    expect(ledger['svc1'].totalHires).toBe(2);
    expect(ledger['svc1'].averageScore).toBe(75);
    expect(ledger['svc1'].averageCost).toBe(5);
  });

  it('updateReputation blacklists provider after 3 failures', async () => {
    await updateReputation('svc_fail', null, true);
    await updateReputation('svc_fail', null, true);
    await updateReputation('svc_fail', null, true);
    const ledger = await readLedger();
    expect(ledger['svc_fail'].blacklisted).toBe(true);
  });

  it('updateReputation blacklists provider if score < 60', async () => {
    await updateReputation('svc_poor', 20, false);
    const ledger = await readLedger();
    expect(ledger['svc_poor'].blacklisted).toBe(true);
  });

  it('sortProvidersByEfficiency removes blacklisted providers and sorts by YQR', async () => {
    await updateReputation('svc_good', 90, false, 10); // YQR = 9
    await updateReputation('svc_best', 100, false, 5); // YQR = 20
    await updateReputation('svc_poor', 20, false, 10); // Blacklisted
    await updateReputation('svc_free', 80, false, 0); // Cost 0 -> 0.001 -> YQR = 80000

    const result = await sortProvidersByEfficiency(['svc_good', 'svc_best', 'svc_poor', 'svc_free', 'svc_unknown']);
    // svc_poor is removed.
    // svc_unknown has no rep -> prioritization rules say return -1 -> unknown first.
    // Order should be: svc_unknown, svc_free, svc_best, svc_good
    expect(result).toEqual(['svc_unknown', 'svc_free', 'svc_best', 'svc_good']);
  });

  it('sortProvidersByEfficiency returns original array if all are blacklisted', async () => {
    await updateReputation('svc_b1', 20, false);
    await updateReputation('svc_b2', 20, false);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sortProvidersByEfficiency(['svc_b1', 'svc_b2']);
    expect(result).toEqual(['svc_b1', 'svc_b2']);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('CRITICAL: All providers blacklisted'));
    vi.restoreAllMocks();
  });

  it('handles sorting multiple unknown providers and multiple free providers', async () => {
    await updateReputation('svc_free1', 100, false, 0);
    await updateReputation('svc_free2', 90, false, 0);
    const result = await sortProvidersByEfficiency(['svc_unknown1', 'svc_unknown2', 'svc_free1', 'svc_free2']);
    // unknowns come first, then sorted by YQR (100/0.001 vs 90/0.001)
    expect(result).toEqual(['svc_unknown1', 'svc_unknown2', 'svc_free1', 'svc_free2']);
  });

  it('handles fs.mkdir failure gracefully', async () => {
    const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(new Error('MKDIR_ERROR'));
    
    await updateReputation('svc_test_mkdir', null, false);
    
    expect(mkdirSpy).toHaveBeenCalled();
    const ledger = await readLedger();
    expect(ledger['svc_test_mkdir']).toBeDefined();
    
    mkdirSpy.mockRestore();
  });
});
