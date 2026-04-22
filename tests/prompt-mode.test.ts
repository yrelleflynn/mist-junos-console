import { describe, expect, it } from 'vitest';

import { classifyPromptMode } from '../src/app/runtime/prompt-mode';

describe('classifyPromptMode', () => {
  it('detects a login prompt', () => {
    expect(classifyPromptMode('login: ')).toBe('login');
  });

  it('detects a password prompt', () => {
    expect(classifyPromptMode('Password: ')).toBe('password');
  });

  it('detects an operational prompt', () => {
    expect(classifyPromptMode('root@switch> ')).toBe('operational');
  });

  it('detects a config prompt', () => {
    expect(classifyPromptMode('root@switch# ')).toBe('config');
  });

  it('detects a shell prompt', () => {
    expect(classifyPromptMode('root@switch% ')).toBe('shell');
  });

  it('detects prompts preceded by a config context banner', () => {
    expect(classifyPromptMode('{master}\nroot@switch> ')).toBe('operational');
    expect(classifyPromptMode('{master}\nroot@switch# ')).toBe('config');
    expect(classifyPromptMode('{master}\nroot@switch% ')).toBe('shell');
  });

  it('returns unknown for non-prompt output', () => {
    expect(classifyPromptMode('show version\nJunos: 23.4R2-S6.6')).toBe('unknown');
  });
});
