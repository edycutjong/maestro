import type { TraceEvent, TraceEventType } from '@edycutjong/croo-core';

export class TraceContext {
  private traceLog: TraceEvent[] = [];
  
  constructor(private orderId: string) {}

  public emitTrace = (type: TraceEventType, agent: string, data?: Record<string, unknown>): void => {
    const event: TraceEvent = { type, agent, timestamp: Date.now(), data };
    this.traceLog.push(event);
    console.log(`[maestro/trace][${this.orderId}] ${type} — ${agent}`, data ?? '');
  };

  public getTraceLog = (): TraceEvent[] => {
    return [...this.traceLog];
  };

  public createTraceEmitter = (): ((event: TraceEvent) => void) => {
    return (event: TraceEvent) => {
      this.traceLog.push(event);
      console.log(`[maestro/trace][${this.orderId}] ${event.type} — ${event.agent}`, event.data ?? '');
    };
  };
}
