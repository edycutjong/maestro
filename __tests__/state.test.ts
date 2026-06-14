import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsPromises from 'fs/promises';
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

  it('initDataDir creates the data directory if missing', async () => {
    const accessMock = vi.spyOn(fsPromises, 'access').mockRejectedValueOnce(new Error('ENOENT'));
    const mkdirMock = vi.spyOn(fsPromises, 'mkdir').mockResolvedValueOnce(undefined);
    
    await initDataDir();
    
    expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('data'), { recursive: true });
    
    accessMock.mockRestore();
    mkdirMock.mockRestore();
  });

  it('loadState returns null if no state exists', async () => {
    const state = await loadState(TEST_ORDER);
    expect(state).toBeNull();
  });

  it('saveState persists state to disk and loadState reads it', async () => {
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

    await saveState(mockState);
    
    expect(fs.existsSync(statePath)).toBe(true);

    const loaded = await loadState(TEST_ORDER);
    expect(loaded).toEqual(mockState);
  });

  it('clearState removes the state file', async () => {
    await saveState({ orderId: TEST_ORDER } as PipelineState);
    expect(fs.existsSync(statePath)).toBe(true);
    
    await clearState(TEST_ORDER);
    await clearState(TEST_ORDER);
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it('handles readFile throwing an error gracefully', async () => {
    const mockState: PipelineState = { orderId: 'err_test' } as PipelineState;
    await saveState(mockState);
    
    // Setup mock
    const readMock = vi.spyOn(fsPromises, 'readFile').mockRejectedValueOnce(new Error('Read error'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const loaded = await loadState('err_test');
    expect(loaded).toBeNull();
    expect(errorLog).toHaveBeenCalled();

    readMock.mockRestore();
    errorLog.mockRestore();
    await clearState('err_test');
  });

  it('handles writeFile throwing an error gracefully', async () => {
    const writeMock = vi.spyOn(fsPromises, 'writeFile').mockRejectedValueOnce(new Error('Write error'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await saveState({ orderId: 'write_err_test' } as PipelineState);
    expect(errorLog).toHaveBeenCalled();

    writeMock.mockRestore();
    errorLog.mockRestore();
  });

  it('handles unlink throwing an error gracefully', async () => {
    await saveState({ orderId: 'unlink_err_test' } as PipelineState);
    
    const unlinkMock = vi.spyOn(fsPromises, 'unlink').mockRejectedValueOnce(new Error('Unlink error'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await clearState('unlink_err_test');
    expect(errorLog).toHaveBeenCalled();

    unlinkMock.mockRestore();
    errorLog.mockRestore();
    await clearState('unlink_err_test'); // actual cleanup
  });

  it('sweepStaleState removes old state files but keeps new ones', async () => {
    const { sweepStaleState } = await import('../src/state.js');
    const oldFile = path.join(process.cwd(), 'data', 'old.json');
    const newFile = path.join(process.cwd(), 'data', 'new.json');
    const oldTextFile = path.join(process.cwd(), 'data', 'old.txt');
    
    if (!fs.existsSync(path.dirname(oldFile))) fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, '{}');
    fs.writeFileSync(newFile, '{}');
    fs.writeFileSync(oldTextFile, 'text');
    
    // mock stat to return old for old.json and old.txt, and new for new.json
    vi.spyOn(fsPromises, 'stat').mockImplementation(async (filePath) => {
      if (filePath === oldFile || filePath === oldTextFile) {
        return { mtimeMs: 0 } as unknown as fs.Stats;
      }
      return { mtimeMs: Date.now() } as unknown as fs.Stats;
    });

    await sweepStaleState(1000);
    
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.existsSync(oldTextFile)).toBe(true); // skips non .json
    
    vi.restoreAllMocks();
    if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
    if (fs.existsSync(oldTextFile)) fs.unlinkSync(oldTextFile);
  });
  
  it('sweepStaleState handles readdir throwing an error', async () => {
    const { sweepStaleState } = await import('../src/state.js');
    vi.spyOn(fsPromises, 'readdir').mockRejectedValueOnce(new Error('readdir error'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    await sweepStaleState(1000);
    expect(errorLog).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('throws on invalid orderId type or format', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(await loadState({} as unknown as string)).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to load state'), expect.any(Error));
    
    expect(await loadState('**!*')).toBeNull();
    
    errorLog.mockRestore();
  });
});
