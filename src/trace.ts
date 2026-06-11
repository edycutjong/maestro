/**
 * Maestro — Trace emitter for the node-graph UI.
 *
 * Records every step of the pipeline as a TraceEvent that the
 * Next.js UI reads to render the live node-graph.
 */

import type { TraceEvent, TraceEventType } from 'croo-core';

/** In-memory trace log for the current run. */
const traceLog: TraceEvent[] = [];

/**
 * Emit a trace event and store it in the log.
 */
export function emitTrace(
  type: TraceEventType,
  agent: string,
  data?: Record<string, unknown>,
): void {
  const event: TraceEvent = {
    type,
    agent,
    timestamp: Date.now(),
    data,
  };

  traceLog.push(event);
  console.log(`[maestro/trace] ${type} — ${agent}`, data ?? '');
}

/**
 * Get the full trace log for the current run.
 */
export function getTraceLog(): TraceEvent[] {
  return [...traceLog];
}

/**
 * Clear the trace log (between runs).
 */
export function clearTraceLog(): void {
  traceLog.length = 0;
}

/**
 * Create a TraceEmitter function bound to this module.
 * Used as the `trace` parameter in `hire()`.
 */
export function createTraceEmitter(): (event: TraceEvent) => void {
  return (event: TraceEvent) => {
    traceLog.push(event);
    console.log(`[maestro/trace] ${event.type} — ${event.agent}`, event.data ?? '');
  };
}
