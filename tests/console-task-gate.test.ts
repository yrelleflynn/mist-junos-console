import { describe, expect, it } from 'vitest';

import { ConsoleTaskGate } from '../src/app/runtime/console-task-gate';

describe('ConsoleTaskGate', () => {
  it('acquires a task when the console is free', () => {
    const gate = new ConsoleTaskGate();

    expect(gate.tryAcquire('identify', 'user', 'identify switch')).toBe(true);
    expect(gate.getBlockingTask()).toEqual({ kind: 'user', label: 'identify switch' });
  });

  it('allows re-entrant acquisition by the same owner until fully released', () => {
    const gate = new ConsoleTaskGate();

    expect(gate.tryAcquire('cloud-refresh', 'background', 'cloud status refresh')).toBe(true);
    expect(gate.tryAcquire('cloud-refresh', 'background', 'cloud status refresh')).toBe(true);

    gate.release('cloud-refresh');
    expect(gate.getBlockingTask()).toEqual({ kind: 'background', label: 'cloud status refresh' });

    gate.release('cloud-refresh');
    expect(gate.getBlockingTask()).toBeNull();
  });

  it('blocks a different owner while a task is active', () => {
    const gate = new ConsoleTaskGate();

    expect(gate.tryAcquire('identify', 'user', 'identify switch')).toBe(true);
    expect(gate.tryAcquire('catalog', 'user', 'all catalog checks')).toBe(false);
    expect(gate.getBlockingTask('catalog')).toEqual({ kind: 'user', label: 'identify switch' });
  });

  it('surfaces external blockers ahead of local ownership', () => {
    const gate = new ConsoleTaskGate((ownerId) => (
      ownerId?.startsWith('config-sync')
        ? null
        : { kind: 'exclusive', label: 'staged config sync' }
    ));

    expect(gate.tryAcquire('identify', 'user', 'identify switch')).toBe(false);
    expect(gate.getBlockingTask()).toEqual({ kind: 'exclusive', label: 'staged config sync' });
    expect(gate.tryAcquire('config-sync-preview', 'exclusive', 'config sync preview')).toBe(true);
  });

  it('reports the current owner kind for background work checks', () => {
    const gate = new ConsoleTaskGate();

    expect(gate.getOwnerKind()).toBeNull();
    expect(gate.tryAcquire('cloud-refresh', 'background', 'cloud status refresh')).toBe(true);
    expect(gate.getOwnerKind()).toBe('background');
    gate.release('cloud-refresh');
    expect(gate.getOwnerKind()).toBeNull();
  });
});
