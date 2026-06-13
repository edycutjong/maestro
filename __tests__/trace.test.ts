import { describe, it, expect, vi } from 'vitest';
import { TraceContext } from '../src/trace.js';

describe('Maestro Trace', () => {
  it('emitTrace records an event and logs it', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const traceCtx = new TraceContext('test_order');
    
    traceCtx.emitTrace('pipeline_start', 'TestAgent', { topic: 'test' });
    
    const log = traceCtx.getTraceLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('pipeline_start');
    expect(log[0].agent).toBe('TestAgent');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[maestro/trace][test_order] pipeline_start — TestAgent'), { topic: 'test' });
    
    consoleSpy.mockRestore();
  });

  it('createTraceEmitter creates an emitter that logs events', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const traceCtx = new TraceContext('test_order');
    
    const emitter = traceCtx.createTraceEmitter();
    emitter({ type: 'hire_start', agent: 'Agent2', timestamp: Date.now(), data: { step: '1' } });
    
    const log = traceCtx.getTraceLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('hire_start');
    expect(log[0].agent).toBe('Agent2');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[maestro/trace][test_order] hire_start — Agent2'), { step: '1' });
    
    consoleSpy.mockRestore();
  });
});
