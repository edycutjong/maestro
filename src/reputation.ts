import { promises as fs } from 'fs';
import path from 'path';

const REP_FILE = path.join(process.cwd(), 'data', 'reputation_ledger.json');

export interface VendorReputation {
  totalHires: number;
  failures: number;
  averageScore: number;
  averageCost: number; // <-- 🛡️ NEW: Track vendor pricing
  blacklisted: boolean;
}

export async function readLedger(): Promise<Record<string, VendorReputation>> {
  try {
    const raw = await fs.readFile(REP_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}

async function writeLedger(ledger: Record<string, VendorReputation>): Promise<void> {
  const dir = path.dirname(REP_FILE);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const tempPath = `${REP_FILE}.tmp.json`;
  await fs.writeFile(tempPath, JSON.stringify(ledger, null, 2), 'utf8');
  await fs.rename(tempPath, REP_FILE);
}

export async function updateReputation(serviceId: string, score: number | null, failed: boolean, cost: number = 0): Promise<void> {
  const ledger = await readLedger();
  if (!ledger[serviceId]) {
    ledger[serviceId] = { totalHires: 0, failures: 0, averageScore: 100, averageCost: cost, blacklisted: false };
  }
  
  const rep = ledger[serviceId];
  rep.totalHires += 1;
  if (failed) rep.failures += 1;
  
  if (score !== null) {
    rep.averageScore = Math.round((rep.averageScore * (rep.totalHires - 1) + score) / rep.totalHires);
  }
  
  if (cost > 0) {
    rep.averageCost = Math.round(((rep.averageCost * (rep.totalHires - 1) + cost) / rep.totalHires) * 1_000_000) / 1_000_000;
  }

  if (!rep.blacklisted && (rep.failures >= 3 || rep.averageScore < 60)) {
    rep.blacklisted = true;
    console.warn(`[maestro/immune-system] 🚨 VENDOR SLASHED: Provider ${serviceId} blacklisted.`);
  }

  await writeLedger(ledger);
}

export async function sortProvidersByEfficiency(serviceIds: string[]): Promise<string[]> {
  const ledger = await readLedger();
  const trusted = serviceIds.filter(id => !ledger[id]?.blacklisted);
  
  if (trusted.length === 0) {
    console.error(`[maestro/immune-system] 🛑 CRITICAL: All providers blacklisted. Engaging override.`);
    return serviceIds; 
  }

  // 🧠 RATIONAL ECONOMIC ACTOR: Sort by Yield-to-Quality Ratio (YQR)
  return trusted.sort((a, b) => {
    const repA = ledger[a];
    const repB = ledger[b];
    if (!repA && !repB) return 0;
    if (!repA) return -1; // Prioritize exploration of new unknown agents
    if (!repB) return 1;
    
    // Prevent divide-by-zero if an agent is free
    const costA = repA.averageCost > 0 ? repA.averageCost : 0.001;
    const costB = repB.averageCost > 0 ? repB.averageCost : 0.001;
    const yqrA = repA.averageScore / costA;
    const yqrB = repB.averageScore / costB;
    
    return yqrB - yqrA; // Descending order
  });
}
