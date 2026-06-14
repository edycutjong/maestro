import { promises as fs } from 'fs';
import path from 'path';

const TREASURY_FILE = path.join(process.cwd(), 'data', 'maestro_treasury.json');

export interface TreasuryState {
  cumulativeProfit: number;
  totalOrders: number;
}

export async function recordTreasuryYield(profitUsdc: number): Promise<{ lifetimeYield: number, valuation: number }> {
  let state: TreasuryState = { cumulativeProfit: 0, totalOrders: 0 };
  
  try {
    const raw = await fs.readFile(TREASURY_FILE, 'utf8');
    state = JSON.parse(raw);
  } catch {}

  state.cumulativeProfit += profitUsdc;
  state.totalOrders += 1;

  const tempPath = `${TREASURY_FILE}.tmp.json`;
  /* v8 ignore next */
  await fs.mkdir(path.dirname(TREASURY_FILE), { recursive: true }).catch(() => {});
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tempPath, TREASURY_FILE);

  // 🧠 ASSETIZATION VALUATION: Calculate Estimated Market Cap
  // Formula: Lifetime Yield * 30x Execution Multiple
  const lifetimeYield = Math.round(state.cumulativeProfit * 1_000_000) / 1_000_000;
  const valuation = Math.round((lifetimeYield * 30) * 100) / 100;
  
  return { lifetimeYield, valuation };
}
