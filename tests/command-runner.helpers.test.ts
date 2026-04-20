/**
 * Tests for the pure helper functions in command-runner.service.ts:
 *   - PROMPT_PATTERNS / endsWithPrompt
 *   - MORE_PATTERN / MORE_PATTERN_ALT / containsMorePrompt
 *   - stripCommandEcho
 *
 * These run without a browser or serial device.
 */

import { describe, it, expect } from 'vitest';
import {
  PROMPT_PATTERNS,
  MORE_PATTERN,
  MORE_PATTERN_ALT,
  endsWithPrompt,
  containsMorePrompt,
  stripCommandEcho,
} from '../src/services/command-runner.service';
import * as F from './fixtures/prompts';

// ---------------------------------------------------------------------------
// PROMPT_PATTERNS — each pattern should match the prompt it targets
// ---------------------------------------------------------------------------

describe('PROMPT_PATTERNS', () => {
  it('matches operational mode prompt (> suffix)', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_OP_SIMPLE))).toBe(true);
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_OP_DASHES))).toBe(true);
  });

  it('matches configuration mode prompt (# suffix)', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_CONFIG))).toBe(true);
  });

  it('matches shell prompt (% suffix)', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_SHELL))).toBe(true);
  });

  it('matches login: prompt', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_LOGIN))).toBe(true);
  });

  it('matches Password: prompt (case-insensitive)', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_PASSWORD))).toBe(true);
    expect(PROMPT_PATTERNS.some((p) => p.test(F.PROMPT_PASSWORD_LOWER))).toBe(true);
  });

  it('does not match plain output text', () => {
    expect(PROMPT_PATTERNS.some((p) => p.test(F.NOT_A_PROMPT_PLAIN))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// endsWithPrompt — checks trimmed buffer tail
// ---------------------------------------------------------------------------

describe('endsWithPrompt', () => {
  it('returns true for a buffer ending with an operational prompt', () => {
    expect(endsWithPrompt(F.PROMPT_OP_WITH_OUTPUT)).toBe(true);
  });

  it('returns true for a buffer ending with a config prompt', () => {
    expect(endsWithPrompt(F.PROMPT_CONFIG_WITH_OUTPUT)).toBe(true);
  });

  it('returns true when there is trailing whitespace after the prompt', () => {
    expect(endsWithPrompt(F.PROMPT_OP_SIMPLE + '   ')).toBe(true);
  });

  it('returns false when output ends mid-line (no prompt yet)', () => {
    expect(endsWithPrompt(F.NOT_A_PROMPT_MID_LINE)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(endsWithPrompt('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MORE_PATTERN / MORE_PATTERN_ALT — pagination markers
// ---------------------------------------------------------------------------

describe('MORE_PATTERN', () => {
  it('matches ---more---', () => {
    expect(MORE_PATTERN.test(F.MORE_STANDARD)).toBe(true);
  });

  it('matches ---(more 42%)---', () => {
    expect(MORE_PATTERN.test(F.MORE_WITH_PERCENT)).toBe(true);
  });

  it('does not match plain output', () => {
    expect(MORE_PATTERN.test('show version output')).toBe(false);
  });
});

describe('MORE_PATTERN_ALT', () => {
  it('matches --(more)--', () => {
    expect(MORE_PATTERN_ALT.test(F.MORE_ALT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// containsMorePrompt
// ---------------------------------------------------------------------------

describe('containsMorePrompt', () => {
  it('detects standard more marker embedded in output', () => {
    const buf = 'line1\nline2\n' + F.MORE_STANDARD;
    expect(containsMorePrompt(buf)).toBe(true);
  });

  it('detects alt more marker', () => {
    expect(containsMorePrompt(F.MORE_ALT)).toBe(true);
  });

  it('returns false for normal output', () => {
    expect(containsMorePrompt(F.NOT_A_PROMPT_PLAIN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripCommandEcho
// ---------------------------------------------------------------------------

describe('stripCommandEcho', () => {
  it('removes the echoed command from the start of output', () => {
    const raw = 'show version\r\nJunos: 21.4R3\r\nuser@switch> ';
    const result = stripCommandEcho(raw, 'show version');
    expect(result).not.toContain('show version');
    expect(result).toContain('Junos: 21.4R3');
  });

  it('removes the trailing prompt line', () => {
    const raw = 'show version\r\nJunos: 21.4R3\r\nuser@switch> ';
    const result = stripCommandEcho(raw, 'show version');
    expect(result).not.toContain('user@switch>');
  });

  it('removes the trailing config prompt line', () => {
    const raw = 'show interfaces\r\nge-0/0/0 up\r\nroot@switch# ';
    const result = stripCommandEcho(raw, 'show interfaces');
    expect(result).toBe('ge-0/0/0 up');
  });

  it('trims surrounding blank lines', () => {
    const raw = 'cmd\n\nsome output\n\n';
    const result = stripCommandEcho(raw, 'cmd');
    expect(result).toBe('some output');
  });

  it('returns the raw output unchanged when command is not found in the buffer', () => {
    // This can happen if the echo was consumed by a previous partial read
    const raw = 'Junos: 21.4R3\r\nuser@switch> ';
    const result = stripCommandEcho(raw, 'show version');
    // Command not found — still strips trailing prompt
    expect(result).not.toContain('user@switch>');
    expect(result).toContain('Junos: 21.4R3');
  });

  it('removes a garbled echoed command when serial echo duplicates tokens', () => {
    const raw = 'showshow interfaces interfaces terse terse\r\nge-0/0/0 up up\r\nroot@switch> ';
    const result = stripCommandEcho(raw, 'show interfaces terse');
    expect(result).toBe('ge-0/0/0 up up');
  });

  it('handles empty raw input gracefully', () => {
    expect(stripCommandEcho('', 'show version')).toBe('');
  });
});
