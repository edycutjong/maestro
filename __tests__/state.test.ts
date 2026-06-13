import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadState, saveState, clearState, initDataDir } from '../src/state.js';
import type { PipelineState } from '../src/state.js';

describe('Maestro State', () => {
  const TEST_ORDER = 'test_order_123';
  const statePath = path.join(process.cwd(), 'data', `${TEST_ORDER}.json`);

  beforeEach(() => {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  });

  it('initDataDir creates the data directory if missing', () => {
    initDataDir();
    expect(fs.existsSync(path.join(process.cwd(), 'data'))).toBe(true);
  });

  it('loadState returns null if no state exists', () => {
    const state = loadState(TEST_ORDER);
    expect(state).toBeNull();
  });

  it('saveState persists state to disk and loadState reads it', () => {
    const mockState: PipelineState = {
      orderId: TEST_ORDER,
      topic: 'test',
      qualityThreshold: 80,
      forceEscalation: false,
      totalSpent: 1.5,
      results: { research: { draft: 'text' } },
      audit: [],
      completedSteps: ['research'],
    };

    saveState(mockState);
    
    expect(fs.existsSync(statePath)).toBe(true);

    const loaded = loadState(TEST_ORDER);
    expect(loaded).toEqual(mockState);
  });

  it('clearState removes the state file', () => {
    saveState({ orderId: TEST_ORDER } as PipelineState);
    expect(fs.existsSync(statePath)).toBe(true);
    
    clearState(TEST_ORDER);
    clearState(TEST_ORDER);
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it('handles readFileSync throwing an error gracefully', () => {
    const mockState: PipelineState = { orderId: 'err_test' } as PipelineState;
    saveState(mockState);
    
    // Setup mock
    const readMock = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('Read error');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const loaded = loadState('err_test');
    expect(loaded).toBeNull();
    expect(errorLog).toHaveBeenCalled();

    readMock.mockRestore();
    errorLog.mockRestore();
    clearState('err_test');
  });

  it('handles writeFileSync throwing an error gracefully', () => {
    const writeMock = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('Write error');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    saveState({ orderId: 'write_err_test' } as PipelineState);
    expect(errorLog).toHaveBeenCalled();

    writeMock.mockRestore();
    errorLog.mockRestore();
  });

  it('handles unlinkSync throwing an error gracefully', () => {
    saveState({ orderId: 'unlink_err_test' } as PipelineState);
    
    const unlinkMock = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('Unlink error');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    clearState('unlink_err_test');
    expect(errorLog).toHaveBeenCalled();

    unlinkMock.mockRestore();
    errorLog.mockRestore();
    clearState('unlink_err_test'); // actual cleanup
  });
});
