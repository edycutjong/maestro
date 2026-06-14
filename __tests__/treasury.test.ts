import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { recordTreasuryYield } from '../src/treasury.js';

const TREASURY_FILE = path.join(process.cwd(), 'data', 'maestro_treasury.json');

describe('Maestro Treasury', () => {
  beforeEach(() => {
    if (fs.existsSync(TREASURY_FILE)) fs.unlinkSync(TREASURY_FILE);
  });
  afterEach(() => {
    if (fs.existsSync(TREASURY_FILE)) fs.unlinkSync(TREASURY_FILE);
  });

  it('recordTreasuryYield creates new ledger and calculates valuation', async () => {
    const { lifetimeYield, valuation } = await recordTreasuryYield(10.5);
    expect(lifetimeYield).toBe(10.5);
    expect(valuation).toBe(315); // 10.5 * 30
    const raw = fs.readFileSync(TREASURY_FILE, 'utf8');
    const state = JSON.parse(raw);
    expect(state.cumulativeProfit).toBe(10.5);
    expect(state.totalOrders).toBe(1);
  });

  it('recordTreasuryYield accumulates profit across orders', async () => {
    await recordTreasuryYield(10);
    const { lifetimeYield, valuation } = await recordTreasuryYield(5.25);
    expect(lifetimeYield).toBe(15.25);
    expect(valuation).toBe(457.5);
    const raw = fs.readFileSync(TREASURY_FILE, 'utf8');
    const state = JSON.parse(raw);
    expect(state.cumulativeProfit).toBe(15.25);
    expect(state.totalOrders).toBe(2);
  });
});
