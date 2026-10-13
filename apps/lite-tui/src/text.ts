/**
 * Display-width-aware text utilities for the Lite TUI.
 *
 * Every measurement is in terminal columns, not JavaScript string length, so
 * CJK text and ANSI-styled strings align in the same grid as the Full TUI.
 */

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ANSI_SGR = /\x1b\[[0-9;]*m/gu;
const CLUSTERED_TEXT = /[\p{Mark}\p{Default_Ignorable_Code_Point}\p{Regional_Indicator}\p{Emoji_Modifier}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u;
const ZERO_WIDTH = /[\p{Mark}\p{Default_Ignorable_Code_Point}\p{Control}]/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

interface TerminalUnit { text: string; width: number }

function graphemeWidth(text: string): number {
  const first = text.codePointAt(0) ?? 0;
  if (text.length === 1 && first < 0x80) return first < 0x20 || first === 0x7f ? 0 : 1;
  // A flag, modifier or ZWJ sequence occupies one emoji cell pair. Text-style
  // symbols remain narrow unless their presentation selector requests emoji.
  if (!text.includes("\ufe0e") && (EMOJI_PRESENTATION.test(text) ||
    (text.includes("\ufe0f") && PICTOGRAPH.test(text)) || text.includes("\u20e3"))) return 2;
  let width = 0;
  for (const character of text) {
    if (!ZERO_WIDTH.test(character)) width = Math.max(width, isWide(character.codePointAt(0)!) ? 2 : 1);
  }
  return width;
}

function* plainUnits(text: string): Generator<TerminalUnit> {
  // Independent characters, including long ASCII/CJK/emoji runs, need no ICU
  // segmentation. Keep wrapping linear and reserve clustering for sequences.
  if (!CLUSTERED_TEXT.test(text)) {
    for (const character of text) yield { text: character, width: graphemeWidth(character) };
  } else {
    for (const { segment } of graphemeSegmenter.segment(text)) yield { text: segment, width: graphemeWidth(segment) };
  }
}

function* terminalUnits(text: string): Generator<TerminalUnit> {
  let offset = 0;
  for (const match of text.matchAll(ANSI_SGR)) {
    yield* plainUnits(text.slice(offset, match.index));
    yield { text: match[0], width: 0 };
    offset = match.index + match[0].length;
  }
  yield* plainUnits(text.slice(offset));
}

/** East Asian Wide / Fullwidth ranges that occupy two terminal columns. */
export function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

/** Terminal columns occupied by `value`, ignoring ANSI styling. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const unit of terminalUnits(value)) width += unit.width;
  return width;
}

/** Clip a possibly styled line to `maxColumns`, preserving ANSI sequences. */
export function clipLine(line: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  if (displayWidth(line) <= maxColumns) return line;

  let column = 0;
  let result = "";
  for (const unit of terminalUnits(line)) {
    if (unit.width > 0 && column + unit.width > maxColumns - 1) {
      result += "…";
      break;
    }
    result += unit.text;
    column += unit.width;
  }
  // Only re-arm the reset when styling actually survived the clip, so
  // color-disabled output stays free of escape bytes.
  return result.includes("\x1b[") ? `${result}\x1b[0m` : result;
}

/** Right-pad a line to exactly `targetColumns` display width. */
export function padLine(line: string, targetColumns: number): string {
  const width = displayWidth(line);
  if (width >= targetColumns) return line;
  return line + " ".repeat(targetColumns - width);
}

/** Collapse whitespace and truncate to `maxColumns` terminal columns. */
export function compact(value: string, maxColumns: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (displayWidth(cleaned) <= maxColumns) return cleaned;
  if (maxColumns <= 1) return "…";
  return clipLine(cleaned, maxColumns);
}

/**
 * Compact whitespace for browse rows. The producer already owns injection
 * and masking; literal XML in canonical text must remain readable.
 */
export function tameBrowseMarkup(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Same taming as {@link tameBrowseMarkup} but preserving paragraph breaks. */
export function tameDetailMarkup(value: string): string {
  return value
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Word-wrap `text` to `width` columns, keeping explicit newlines. */
export function wrapText(text: string, width: number): string[] {
  if (text.trim().length === 0) return [];
  const target = Math.max(1, width);
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    const cleaned = paragraph.replace(/[^\S\n]+/gu, " ").trim();
    if (cleaned.length === 0) {
      result.push("");
      continue;
    }
    if (displayWidth(cleaned) <= target) {
      result.push(cleaned);
      continue;
    }
    wrapParagraph(cleaned, target, result);
  }
  return result;
}

/** Greedy word wrap; words wider than the line are hard-broken by column. */
function wrapParagraph(text: string, width: number, out: string[]): void {
  let line = "";
  let lineWidth = 0;

  const flush = () => {
    if (line.length > 0) out.push(line);
    line = "";
    lineWidth = 0;
  };

  for (const word of text.split(" ")) {
    const wordWidth = displayWidth(word);
    if (wordWidth > width) {
      flush();
      // Consume each terminal unit once: rescanning the shrinking suffix makes
      // pasted base64/JSON and long CJK paragraphs quadratic to repaint.
      for (const unit of terminalUnits(word)) {
        if (lineWidth + unit.width > width && line.length > 0) flush();
        line += unit.text;
        lineWidth += unit.width;
      }
      continue;
    }
    const cost = lineWidth === 0 ? wordWidth : wordWidth + 1;
    if (lineWidth + cost > width) {
      flush();
      line = word;
      lineWidth = wordWidth;
      continue;
    }
    line = lineWidth === 0 ? word : `${line} ${word}`;
    lineWidth += cost;
  }
  flush();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Mar 14 09:26:05` — the Full TUI's row timestamp format. */
export function formatShortDate(isoDate: string | undefined): string {
  const date = parseDate(isoDate);
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${hours}:${minutes}:${seconds}`;
}

/** `3d ago` — compact age label for headers and status lines. */
export function formatRelativeTime(isoDate: string | undefined, now: number): string {
  const date = parseDate(isoDate);
  if (!date) return "";
  const deltaSeconds = Math.round((now - date.getTime()) / 1000);
  if (!Number.isFinite(deltaSeconds)) return "";
  if (deltaSeconds < 0) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function parseDate(isoDate: string | undefined): Date | undefined {
  if (!isoDate) return undefined;
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `1.2M` / `43K` / `912` — compact token counts for dense rows. */
export function formatCompactCount(count: number | undefined): string {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

/** Collapse to one line and truncate by character count (non-TUI output). */
export function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
