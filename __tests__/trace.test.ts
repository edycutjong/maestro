import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitTrace, getTraceLog, clearTraceLog, createTraceEmitter } from '../src/trace.js';

describe('Maestro Trace', () => {
  beforeEach(() => {
    clearTraceLog('test_order');
  });

  it('emitTrace records an event and logs it', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    emitTrace('test_order', 'pipeline_start', 'TestAgent', { topic: 'test' });
    
    const log = getTraceLog('test_order');
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('pipeline_start');
    expect(log[0].agent).toBe('TestAgent');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[maestro/trace][test_order] pipeline_start — TestAgent'), { topic: 'test' });
    
    consoleSpy.mockRestore();
  });

  it('createTraceEmitter creates an emitter that logs events', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const emitter = createTraceEmitter('test_order');
    emitter({ type: 'hire_start', agent: 'Agent2', timestamp: Date.now(), data: { step: '1' } });
    
    const log = getTraceLog('test_order');
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('hire_start');
    expect(log[0].agent).toBe('Agent2');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[maestro/trace][test_order] hire_start — Agent2'), { step: '1' });
    
    consoleSpy.mockRestore();
  });
});
