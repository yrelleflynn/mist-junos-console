/**
 * junos-highlight.service.ts — Lightweight Junos config/diff syntax highlighter
 *
 * Tokenizes Junos set-format config output (plain and `show | compare` diff)
 * and emits HTML with semantic CSS classes. Supports named colour schemes via
 * a container class so consumers can swap palettes without touching the markup.
 *
 * Usage:
 *   import { highlightJunosBlock } from './junos-highlight.service';
 *   container.innerHTML = highlightJunosBlock(text);               // default scheme
 *   container.innerHTML = highlightJunosBlock(text, 'terminal');   // dark terminal
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TokenKind =
  | 'keyword'    // set / delete / deactivate / activate / rename
  | 'section'    // top-level config hierarchy word (protocols, interfaces, vlans…)
  | 'interface'  // ge-0/0/0, xe-1/2/3, ae0, et-0/0/0, irb, lo0, etc.
  | 'ip'         // IPv4 / IPv6 address or prefix
  | 'mac'        // xx:xx:xx:xx:xx:xx  or  xx-xx-xx-xx-xx-xx
  | 'string'     // quoted string
  | 'comment'    // line starting with #
  | 'plain';     // everything else

export type LineKind =
  | 'add'     // lines starting with +  (but not +++ header)
  | 'del'     // lines starting with -  (but not --- header)
  | 'header'  // [edit …] or +++ / --- unified-diff headers
  | 'plain';  // unchanged / non-diff lines

export interface HighlightToken {
  kind: TokenKind;
  text: string;
}

export interface HighlightedLine {
  kind: LineKind;
  /** Raw line text (including leading +/- for diff lines). */
  raw: string;
  /** Tokenised spans — ready to join into innerHTML. */
  tokens: HighlightToken[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Token regex
//
// Named capture groups map 1-to-1 with TokenKind values.
// Groups are tested in priority order; first match wins.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_RE = new RegExp(
  [
    // quoted strings (single or double)
    String.raw`(?<string>"[^"]*"|'[^']*')`,
    // MAC address  xx:xx:xx:xx:xx:xx  or  xx-xx-xx-xx-xx-xx
    String.raw`(?<mac>[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}|[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})`,
    // IPv6 address / prefix  (simplified — covers common forms)
    String.raw`(?<ip>(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d+)?|(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:\/\d+)?)`,
    // interface names  ge-0/0/0  xe-1/0/1  ae0  et-0/0/0  irb.0  lo0  me0  vme  bme
    String.raw`(?<interface>(?:ge|xe|et|fe|so|at|lt|st0|ae|irb|lo|me|vme|bme|reth|mam|fab|em)(?:\d+)?(?:[.\-/]\d+)*)`,
    // Junos top-level section keywords (common set-format hierarchy tokens)
    String.raw`(?<section>protocols|interfaces|vlans|routing\-instances|routing\-options|policy\-options|firewall|snmp|system|groups|apply\-groups|forwarding\-options|class\-of\-service|access|virtual\-chassis|chassis)(?=\s|$)`,
    // CLI action keywords (must come after section to avoid false matches)
    String.raw`(?<keyword>^(?:set|delete|deactivate|activate|rename|replace|protect|unprotect)\b)`,
    // plain word token (catches the rest)
    String.raw`(?<plain>\S+)`,
  ].join('|'),
  'gd',
);

// ─────────────────────────────────────────────────────────────────────────────
// classifyJunosLine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the diff line kind for a raw line from `show | compare` output.
 *
 * - Lines starting with `[edit` or `+++`/`---` (unified headers) → `header`
 * - Lines starting with `+` (but not `+++`) → `add`
 * - Lines starting with `-` (but not `---`) → `del`
 * - Everything else → `plain`
 */
export function classifyJunosLine(line: string): LineKind {
  if (line.startsWith('[edit') || line.startsWith('+++') || line.startsWith('---')) {
    return 'header';
  }
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'plain';
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenizeJunosLine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokenise a single Junos config line into typed spans.
 *
 * The leading `+` / `-` on diff lines is emitted as a `plain` token so that
 * colour theming for the prefix character comes from the line-kind CSS class
 * rather than the token class.
 *
 * Lines starting with `#` are returned as a single `comment` token.
 */
export function tokenizeJunosLine(line: string): HighlightToken[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    return [{ kind: 'comment', text: line }];
  }

  const tokens: HighlightToken[] = [];
  TOKEN_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(line)) !== null) {
    // Fill any gap between last match and this one as plain text
    if (match.index > lastIndex) {
      const gap = line.slice(lastIndex, match.index);
      tokens.push({ kind: 'plain', text: gap });
    }

    // Identify which named group fired
    const groups = match.groups ?? {};
    let kind: TokenKind = 'plain';
    for (const k of Object.keys(groups) as TokenKind[]) {
      if (groups[k] !== undefined) {
        kind = k;
        break;
      }
    }

    tokens.push({ kind, text: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Trailing text not captured by any token
  if (lastIndex < line.length) {
    tokens.push({ kind: 'plain', text: line.slice(lastIndex) });
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// highlightJunosLine
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a line into a `HighlightedLine` (classify + tokenise). */
export function highlightJunosLine(line: string): HighlightedLine {
  return {
    kind: classifyJunosLine(line),
    raw: line,
    tokens: tokenizeJunosLine(line),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML escape
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// renderHighlightedLines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an array of `HighlightedLine` objects to an HTML string.
 *
 * Each line becomes a `<div class="junos-line junos-line-{kind}">` containing
 * `<span class="junos-token-{kind}">` elements.  Whitespace tokens are emitted
 * without a span to keep the DOM lean.
 */
export function renderHighlightedLines(lines: HighlightedLine[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    const spans = line.tokens
      .map((t) => {
        const escaped = escHtml(t.text);
        // Don't wrap pure-whitespace tokens — keeps output readable
        if (t.kind === 'plain' && /^\s+$/.test(t.text)) return escaped;
        return `<span class="junos-token-${t.kind}">${escaped}</span>`;
      })
      .join('');
    parts.push(`<div class="junos-line junos-line-${line.kind}">${spans}</div>`);
  }
  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSI terminal output  (for xterm.js / raw terminal output)
//
// Maps semantic token kinds and diff line kinds to ANSI escape codes so
// Junos config can be written to an xterm.js terminal with colour.
//
// Diff line state takes precedence over token colours — the entire line is
// coloured with the diff hue, with keyword tokens a slightly brighter variant.
// ─────────────────────────────────────────────────────────────────────────────

const ANSI_RESET = '\x1b[0m';
const ANSI_DIM   = '\x1b[2m';

/**
 * Map a token kind to its ANSI colour code (for use on plain/unchanged lines).
 * Returns empty string for `plain` to avoid unnecessary escape codes.
 */
function ansiTokenColor(kind: TokenKind): string {
  switch (kind) {
    case 'keyword':   return '\x1b[94m';   // bright blue
    case 'section':   return '\x1b[95m';   // bright magenta
    case 'interface': return '\x1b[92m';   // bright green
    case 'ip':        return '\x1b[93m';   // bright yellow
    case 'mac':       return '\x1b[33m';   // yellow
    case 'string':    return '\x1b[96m';   // bright cyan
    case 'comment':   return ANSI_DIM;     // dim (inherits fg)
    case 'plain':     return '';           // no override
    default:          return '';
  }
}

/**
 * Render a single `HighlightedLine` as an ANSI-escaped terminal string.
 *
 * - `add`/`del`/`header` lines: the whole line gets one diff colour; keyword
 *   tokens get a brighter variant of the same hue for subtle structure.
 * - `plain` lines: each token gets its own colour.
 */
function ansiRenderLine(line: HighlightedLine): string {
  if (line.tokens.length === 0) return '';

  // Diff lines: use a single line-level colour; keywords get a brighter shade.
  // The rest of the tokens stay at the line colour so diff state is dominant.
  if (line.kind === 'add' || line.kind === 'del' || line.kind === 'header') {
    const lineColor =
      line.kind === 'add'    ? '\x1b[32m'   // green
      : line.kind === 'del'  ? '\x1b[31m'   // red
      : '\x1b[1;35m';                        // bold magenta (header)
    const keywordBright =
      line.kind === 'add'   ? '\x1b[92m'    // bright green
      : line.kind === 'del' ? '\x1b[91m'    // bright red
      : '\x1b[1;95m';                        // bold bright magenta (header)

    const parts: string[] = [];
    for (const t of line.tokens) {
      const color = t.kind === 'keyword' ? keywordBright : lineColor;
      parts.push(color + t.text);
    }
    return parts.join('') + ANSI_RESET;
  }

  // Plain lines: per-token colours
  const parts: string[] = [];
  let lastColor = '';
  for (const t of line.tokens) {
    const color = ansiTokenColor(t.kind);
    if (color !== lastColor) {
      parts.push(color || ANSI_RESET);
      lastColor = color;
    }
    parts.push(t.text);
  }
  if (lastColor) parts.push(ANSI_RESET);
  return parts.join('');
}

/**
 * Convert a multi-line Junos config or diff block to ANSI-escaped terminal output.
 *
 * Safe to pass directly to `xterm.js` Terminal.writeln() / write().
 * Returns an empty string for empty / whitespace-only input.
 *
 * @param text  Raw Junos output text (may contain `show | compare` diff lines).
 */
export function junosLinesToAnsi(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split('\n')
    .map((raw) => ansiRenderLine(highlightJunosLine(raw)))
    .join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// highlightJunosBlock  (main entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Highlight a multi-line Junos config or diff block.
 *
 * Returns a `<pre>` element string with scheme class applied.
 * `scheme` defaults to `'default'`.
 *
 * @param text   Raw Junos output (may be empty — returns empty string).
 * @param scheme One of `'default' | 'terminal' | 'soft'`  (CSS scheme class).
 */
export function highlightJunosBlock(text: string, scheme: string = 'default'): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const lines = trimmed.split('\n').map(highlightJunosLine);
  const inner = renderHighlightedLines(lines);
  return `<pre class="junos-highlight-block junos-scheme-${escHtml(scheme)}">${inner}</pre>`;
}
