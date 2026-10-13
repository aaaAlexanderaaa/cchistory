/**
 * Zero-dependency terminal color utilities for Lite TUI output.
 *
 * Mirrors the semantic palette of the Full TUI (`apps/tui/src/colors.ts`) so
 * both terminal read surfaces look like one product. Lite cannot import the
 * Full TUI package, so the palette is restated rather than shared.
 *
 * Colors are disabled when:
 *   - NO_COLOR env var is set (any value)
 *   - TERM=dumb
 *   - the caller passes `color: false` (non-TTY output, `--no-color`)
 *
 * Colors are forced when FORCE_COLOR is set (any value).
 */

import process from "node:process";

type ColorFn = (text: string) => string;

interface ColorPolicy {
  color?: boolean;
}

function shouldUseColor(policy: ColorPolicy = {}): boolean {
  if (process.env["FORCE_COLOR"] !== undefined) return true;
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["TERM"] === "dumb") return false;
  if (policy.color === false) return false;
  return true;
}

let enabled = shouldUseColor();

export function configureColorPolicy(policy: ColorPolicy = {}): void {
  enabled = shouldUseColor(policy);
}

export function isColorEnabled(): boolean {
  return enabled;
}

function ansi(open: number, close: number): ColorFn {
  return (text: string) => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text);
}

// ---- Base styles ----
export const bold: ColorFn = ansi(1, 22);
export const dim: ColorFn = ansi(2, 22);
export const italic: ColorFn = ansi(3, 23);
export const underline: ColorFn = ansi(4, 24);

// ---- Foreground colors ----
export const red: ColorFn = ansi(31, 39);
export const green: ColorFn = ansi(32, 39);
export const yellow: ColorFn = ansi(33, 39);
export const blue: ColorFn = ansi(34, 39);
export const magenta: ColorFn = ansi(35, 39);
export const cyan: ColorFn = ansi(36, 39);
export const white: ColorFn = ansi(37, 39);
export const gray: ColorFn = ansi(90, 39);

// ---- Semantic aliases ----
export const heading: ColorFn = (text) => bold(cyan(text));
export const label: ColorFn = (text) => bold(white(text));
export const muted: ColorFn = gray;
export const success: ColorFn = green;
export const warning: ColorFn = yellow;
export const danger: ColorFn = red;
export const id: ColorFn = magenta;
export const platform: ColorFn = blue;
export const activeItem: ColorFn = (text) => bold(cyan(text));
export const selectedItem: ColorFn = (text) => bold(white(text));
export const sectionTitle: ColorFn = (text) => bold(blue(text));
export const activeSectionTitle: ColorFn = (text) => bold(cyan(text));
export const cursor: ColorFn = (text) => bold(green(text));
export const metaLabel: ColorFn = dim;

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
