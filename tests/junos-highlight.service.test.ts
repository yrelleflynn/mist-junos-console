import { describe, it, expect } from 'vitest';
import {
  classifyJunosLine,
  tokenizeJunosLine,
  highlightJunosLine,
  renderHighlightedLines,
  highlightJunosBlock,
  junosLinesToAnsi,
  type LineKind,
  type TokenKind,
} from '../src/services/junos-highlight.service';

// ─────────────────────────────────────────────────────────────────────────────
// classifyJunosLine
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyJunosLine()', () => {
  it('classifies a line starting with + as "add"', () => {
    expect(classifyJunosLine('+ set system host-name sw-new')).toBe<LineKind>('add');
  });

  it('classifies a line starting with - as "del"', () => {
    expect(classifyJunosLine('- set system host-name sw-old')).toBe<LineKind>('del');
  });

  it('classifies [edit ...] as "header"', () => {
    expect(classifyJunosLine('[edit system]')).toBe<LineKind>('header');
  });

  it('classifies a bare [edit] as "header"', () => {
    expect(classifyJunosLine('[edit]')).toBe<LineKind>('header');
  });

  it('classifies +++ unified header as "header"', () => {
    expect(classifyJunosLine('+++ /dev/null')).toBe<LineKind>('header');
  });

  it('classifies --- unified header as "header"', () => {
    expect(classifyJunosLine('--- /dev/null')).toBe<LineKind>('header');
  });

  it('classifies an unchanged set line as "plain"', () => {
    expect(classifyJunosLine('set system host-name sw-test')).toBe<LineKind>('plain');
  });

  it('classifies an empty string as "plain"', () => {
    expect(classifyJunosLine('')).toBe<LineKind>('plain');
  });

  it('classifies a delete command (no diff prefix) as "plain"', () => {
    expect(classifyJunosLine('delete protocols')).toBe<LineKind>('plain');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — keyword detection
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — keywords', () => {
  it('identifies "set" as a keyword token', () => {
    const tokens = tokenizeJunosLine('set system host-name sw-test');
    expect(tokens[0]).toEqual({ kind: 'keyword' as TokenKind, text: 'set' });
  });

  it('identifies "delete" as a keyword token', () => {
    const tokens = tokenizeJunosLine('delete protocols');
    expect(tokens[0]).toEqual({ kind: 'keyword' as TokenKind, text: 'delete' });
  });

  it('identifies "deactivate" as a keyword token', () => {
    const tokens = tokenizeJunosLine('deactivate interfaces ge-0/0/0');
    expect(tokens[0]).toEqual({ kind: 'keyword' as TokenKind, text: 'deactivate' });
  });

  it('does not produce a keyword token when "set" is not at the start', () => {
    const tokens = tokenizeJunosLine('something set other');
    const kinds = tokens.map((t) => t.kind);
    // 'set' in the middle should not be classified as keyword
    expect(kinds).not.toContain('keyword');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — section detection
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — sections', () => {
  it('identifies "protocols" as a section token', () => {
    const tokens = tokenizeJunosLine('set protocols ospf area 0');
    const sectionToken = tokens.find((t) => t.kind === 'section');
    expect(sectionToken?.text).toBe('protocols');
  });

  it('identifies "interfaces" as a section token', () => {
    const tokens = tokenizeJunosLine('set interfaces ge-0/0/0 unit 0');
    const sectionToken = tokens.find((t) => t.kind === 'section');
    expect(sectionToken?.text).toBe('interfaces');
  });

  it('identifies "vlans" as a section token', () => {
    const tokens = tokenizeJunosLine('set vlans v10 vlan-id 10');
    const sectionToken = tokens.find((t) => t.kind === 'section');
    expect(sectionToken?.text).toBe('vlans');
  });

  it('identifies "system" as a section token', () => {
    const tokens = tokenizeJunosLine('set system host-name foo');
    const sectionToken = tokens.find((t) => t.kind === 'section');
    expect(sectionToken?.text).toBe('system');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — interface detection
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — interfaces', () => {
  it('identifies ge-0/0/0 as an interface token', () => {
    const tokens = tokenizeJunosLine('set interfaces ge-0/0/0 unit 0 description uplink');
    const iface = tokens.find((t) => t.kind === 'interface');
    expect(iface?.text).toBe('ge-0/0/0');
  });

  it('identifies xe-0/0/1 as an interface token', () => {
    const tokens = tokenizeJunosLine('set interfaces xe-0/0/1 description core');
    const iface = tokens.find((t) => t.kind === 'interface');
    expect(iface?.text).toBe('xe-0/0/1');
  });

  it('identifies ae0 as an interface token', () => {
    const tokens = tokenizeJunosLine('set interfaces ae0 aggregated-ether-options');
    const iface = tokens.find((t) => t.kind === 'interface');
    expect(iface?.text).toBe('ae0');
  });

  it('identifies irb as an interface token', () => {
    const tokens = tokenizeJunosLine('set interfaces irb unit 10 family inet');
    const iface = tokens.find((t) => t.kind === 'interface');
    expect(iface?.text).toBe('irb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — IP address detection
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — IP addresses', () => {
  it('identifies a bare IPv4 address', () => {
    const tokens = tokenizeJunosLine('set system ntp server 192.168.1.1');
    const ip = tokens.find((t) => t.kind === 'ip');
    expect(ip?.text).toBe('192.168.1.1');
  });

  it('identifies an IPv4 prefix (CIDR)', () => {
    const tokens = tokenizeJunosLine('set interfaces irb unit 10 family inet address 10.0.0.1/24');
    const ip = tokens.find((t) => t.kind === 'ip');
    expect(ip?.text).toBe('10.0.0.1/24');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — MAC address detection
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — MAC addresses', () => {
  it('identifies a colon-separated MAC address', () => {
    const tokens = tokenizeJunosLine('set vlans v10 mac-limit 00:1a:2b:3c:4d:5e');
    const mac = tokens.find((t) => t.kind === 'mac');
    expect(mac?.text).toBe('00:1a:2b:3c:4d:5e');
  });

  it('identifies a hyphen-separated MAC address', () => {
    const tokens = tokenizeJunosLine('set forwarding-options mac 00-1a-2b-3c-4d-5e');
    const mac = tokens.find((t) => t.kind === 'mac');
    expect(mac?.text).toBe('00-1a-2b-3c-4d-5e');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — quoted strings
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — quoted strings', () => {
  it('identifies a double-quoted string', () => {
    const tokens = tokenizeJunosLine('set system host-name "my-switch"');
    const str = tokens.find((t) => t.kind === 'string');
    expect(str?.text).toBe('"my-switch"');
  });

  it('identifies a single-quoted string', () => {
    const tokens = tokenizeJunosLine("set policy-options policy-statement 'my-policy' term 1");
    const str = tokens.find((t) => t.kind === 'string');
    expect(str?.text).toBe("'my-policy'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — comments
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — comments', () => {
  it('returns a single comment token for a # line', () => {
    const tokens = tokenizeJunosLine('# This is a Mist-generated config');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe<TokenKind>('comment');
    expect(tokens[0].text).toBe('# This is a Mist-generated config');
  });

  it('returns a single comment token for a line starting with # after whitespace', () => {
    const tokens = tokenizeJunosLine('  # indented comment');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe<TokenKind>('comment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine — empty / whitespace
// ─────────────────────────────────────────────────────────────────────────────

describe('tokenizeJunosLine() — edge cases', () => {
  it('returns an empty array for an empty string', () => {
    expect(tokenizeJunosLine('')).toHaveLength(0);
  });

  it('does not throw for an all-whitespace line', () => {
    expect(() => tokenizeJunosLine('   ')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// highlightJunosLine
// ─────────────────────────────────────────────────────────────────────────────

describe('highlightJunosLine()', () => {
  it('returns an add line with correct kind and tokens', () => {
    const result = highlightJunosLine('+ set system host-name new-name');
    expect(result.kind).toBe<LineKind>('add');
    expect(result.raw).toBe('+ set system host-name new-name');
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it('returns a del line for a - prefixed line', () => {
    const result = highlightJunosLine('- delete protocols');
    expect(result.kind).toBe<LineKind>('del');
  });

  it('returns a header line for [edit]', () => {
    const result = highlightJunosLine('[edit]');
    expect(result.kind).toBe<LineKind>('header');
  });

  it('returns a plain line for a regular set command', () => {
    const result = highlightJunosLine('set system host-name sw-test');
    expect(result.kind).toBe<LineKind>('plain');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderHighlightedLines
// ─────────────────────────────────────────────────────────────────────────────

describe('renderHighlightedLines()', () => {
  it('wraps each line in a div with junos-line class', () => {
    const lines = [highlightJunosLine('set system host-name foo')];
    const html = renderHighlightedLines(lines);
    expect(html).toContain('class="junos-line junos-line-plain"');
  });

  it('applies junos-line-add for add lines', () => {
    const lines = [highlightJunosLine('+ set system host-name new')];
    const html = renderHighlightedLines(lines);
    expect(html).toContain('junos-line-add');
  });

  it('applies junos-line-del for del lines', () => {
    const lines = [highlightJunosLine('- set system host-name old')];
    const html = renderHighlightedLines(lines);
    expect(html).toContain('junos-line-del');
  });

  it('applies junos-line-header for [edit] lines', () => {
    const lines = [highlightJunosLine('[edit system]')];
    const html = renderHighlightedLines(lines);
    expect(html).toContain('junos-line-header');
  });

  it('HTML-escapes < and > in token text', () => {
    const lines = [highlightJunosLine('set system login message "<WARNING>"')];
    const html = renderHighlightedLines(lines);
    expect(html).not.toContain('<WARNING>');
    expect(html).toContain('&lt;WARNING&gt;');
  });

  it('emits span elements for keyword tokens', () => {
    const lines = [highlightJunosLine('set system host-name foo')];
    const html = renderHighlightedLines(lines);
    expect(html).toContain('junos-token-keyword');
  });

  it('returns an empty string for an empty array', () => {
    expect(renderHighlightedLines([])).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// highlightJunosBlock
// ─────────────────────────────────────────────────────────────────────────────

describe('highlightJunosBlock()', () => {
  it('returns empty string for an empty input', () => {
    expect(highlightJunosBlock('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(highlightJunosBlock('   \n  ')).toBe('');
  });

  it('wraps output in a <pre> element', () => {
    const result = highlightJunosBlock('set system host-name foo');
    expect(result.startsWith('<pre ')).toBe(true);
    expect(result.endsWith('</pre>')).toBe(true);
  });

  it('applies the default scheme class when no scheme is given', () => {
    const result = highlightJunosBlock('set system host-name foo');
    expect(result).toContain('junos-scheme-default');
  });

  it('applies a custom scheme class when specified', () => {
    const result = highlightJunosBlock('set system host-name foo', 'terminal');
    expect(result).toContain('junos-scheme-terminal');
  });

  it('applies the soft scheme class', () => {
    const result = highlightJunosBlock('set system host-name foo', 'soft');
    expect(result).toContain('junos-scheme-soft');
  });

  it('includes junos-highlight-block class', () => {
    const result = highlightJunosBlock('set system host-name foo');
    expect(result).toContain('junos-highlight-block');
  });

  it('renders add lines with junos-line-add class for diff output', () => {
    const diff = '[edit]\n+ set system host-name new\n- set system host-name old';
    const result = highlightJunosBlock(diff);
    expect(result).toContain('junos-line-add');
    expect(result).toContain('junos-line-del');
    expect(result).toContain('junos-line-header');
  });

  it('HTML-escapes & characters in block text', () => {
    const result = highlightJunosBlock('set system login message "a & b"');
    expect(result).not.toContain(' & ');
    expect(result).toContain('&amp;');
  });

  it('escapes scheme name to prevent XSS', () => {
    const result = highlightJunosBlock('set system host-name foo', '<script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// junosLinesToAnsi  (ANSI terminal output for xterm.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('junosLinesToAnsi()', () => {
  it('returns an empty string for empty input', () => {
    expect(junosLinesToAnsi('')).toBe('');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(junosLinesToAnsi('  \n  ')).toBe('');
  });

  it('returns a string containing ANSI escape codes for a set command', () => {
    const result = junosLinesToAnsi('set system host-name foo');
    expect(result).toContain('\x1b[');
  });

  it('uses green (\\x1b[32m) for add (+) diff lines — diff is dominant', () => {
    const result = junosLinesToAnsi('+ set system host-name new');
    // Green ANSI code must appear
    expect(result).toContain('\x1b[32m');
    // Blue keyword colour must NOT appear — diff takes precedence
    expect(result).not.toContain('\x1b[94m');
  });

  it('uses red (\\x1b[31m) for del (-) diff lines', () => {
    const result = junosLinesToAnsi('- set system host-name old');
    expect(result).toContain('\x1b[31m');
    expect(result).not.toContain('\x1b[94m');
  });

  it('uses bold magenta for [edit ...] header lines', () => {
    const result = junosLinesToAnsi('[edit system]');
    expect(result).toContain('\x1b[1;35m');
  });

  it('uses bright-blue keyword colour for "set" on a plain line', () => {
    const result = junosLinesToAnsi('set system host-name foo');
    expect(result).toContain('\x1b[94m'); // bright blue for keyword
  });

  it('ends with ANSI reset on add lines', () => {
    const result = junosLinesToAnsi('+ set system host-name new');
    expect(result).toContain('\x1b[0m');
  });

  it('handles multi-line diff blocks', () => {
    const diff = '[edit]\n+ set system host-name new\n- set system host-name old';
    const result = junosLinesToAnsi(diff);
    // All three lines should produce output
    const lines = result.split('\r\n');
    expect(lines.length).toBe(3);
    // Header is first
    expect(lines[0]).toContain('\x1b[1;35m');
    // Add line is second
    expect(lines[1]).toContain('\x1b[32m');
    // Del line is third
    expect(lines[2]).toContain('\x1b[31m');
  });

  it('preserves the text content within ANSI codes', () => {
    const result = junosLinesToAnsi('+ set system host-name new');
    // Strip all ANSI escape sequences and check the raw text survives
    const stripped = result.replace(/\x1b\[[^m]*m/g, '');
    expect(stripped).toBe('+ set system host-name new');
  });

  it('uses the line diff color for all tokens on add lines — diff takes precedence', () => {
    // On a "+ ..." line the entire line (including any sub-tokens) renders in
    // the diff-add green.  The keyword regex uses a ^ anchor so "set" after
    // the "+ " prefix is classified as plain, which is correct — the diff
    // state is what the reader should see first.
    const result = junosLinesToAnsi('+ set system host-name sw-new');
    expect(result).toContain('\x1b[32m');
    // Bright-blue keyword colour must NOT appear — diff colour wins
    expect(result).not.toContain('\x1b[94m');
  });

  it('uses the line diff color for all tokens on del lines — diff takes precedence', () => {
    const result = junosLinesToAnsi('- set system host-name sw-old');
    expect(result).toContain('\x1b[31m');
    expect(result).not.toContain('\x1b[94m');
  });

  it('applies bright green keyword color when a line starts with "set" (plain line)', () => {
    // On a plain (non-diff) line "set" IS at position 0 so it matches the
    // keyword regex and gets the bright-blue ANSI colour.
    const result = junosLinesToAnsi('set system host-name sw-test');
    expect(result).toContain('\x1b[94m'); // bright blue keyword on plain line
  });
});
