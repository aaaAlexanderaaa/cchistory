/**
 * Zero-dependency terminal color utilities.
 *
 * Respects NO_COLOR (https://no-color.org/) and detects pipe/non-TTY.
 * Colors are disabled when:
 *   - NO_COLOR env var is set (any value)
 *   - stdout is not a TTY (piped/redirected)
 *   - --no-color flag is passed
 *   - TERM=dumb
 *
 * Colors are forced when:
 *   - FORCE_COLOR env var is set (any value)
 */

import process from "node:process";

type ColorFn = (text: string) => string;

function shouldUseColor(): boolean {
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

const enabled = shouldUseColor();

function ansi(open: number, close: number): ColorFn {
  if (!enabled) return (text: string) => text;
  return (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
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
export const value: ColorFn = cyan;
export const muted: ColorFn = gray;
export const success: ColorFn = green;
export const warning: ColorFn = yellow;
export const error: ColorFn = red;
export const highlight: ColorFn = (text) => bold(yellow(text));
export const id: ColorFn = magenta;
export const platform: ColorFn = blue;

export const isColorEnabled = enabled;
