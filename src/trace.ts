/**
 * Maestro — Trace emitter for the node-graph UI.
 *
 * Records every step of the pipeline as a TraceEvent that the
 * Next.js UI reads to render the live node-graph.
 */

import type { TraceEvent, TraceEventType } from '@edycutjong/croo-core';

/** In-memory trace log mapped by Maestro Order ID to prevent cross-request corruption. */
const traceLogs = new Map<string, TraceEvent[]>();

export function emitTrace(
  orderId: string,
  type: TraceEventType,
  agent: string,
  data?: Record<string, unknown>,
): void {
  const event: TraceEvent = { type, agent, timestamp: Date.now(), data };
  
  if (!traceLogs.has(orderId)) traceLogs.set(orderId, []);
  traceLogs.get(orderId)!.push(event);
  
  console.log(`[maestro/trace][${orderId}] ${type} — ${agent}`, data ?? '');
}

export function getTraceLog(orderId: string): TraceEvent[] {
  return traceLogs.get(orderId) ? [...traceLogs.get(orderId)!] : [];
}

export function clearTraceLog(orderId: string): void {
  traceLogs.delete(orderId);
}

export function createTraceEmitter(orderId: string): (event: TraceEvent) => void {
  return (event: TraceEvent) => {
    if (!traceLogs.has(orderId)) traceLogs.set(orderId, []);
    traceLogs.get(orderId)!.push(event);
    console.log(`[maestro/trace][${orderId}] ${event.type} — ${event.agent}`, event.data ?? '');
  };
}
