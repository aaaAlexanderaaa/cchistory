/**
 * Zero-dependency terminal color utilities for TUI output.
 *
 * Respects NO_COLOR (https://no-color.org/) and detects pipe/non-TTY.
 */

import process from "node:process";

type ColorFn = (text: string) => string;

function shouldUseColor(): boolean {
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return true;
}

const enabled = shouldUseColor();

function ansi(open: number, close: number): ColorFn {
  if (!enabled) return (text: string) => text;
  return (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
}

export const bold: ColorFn = ansi(1, 22);
export const dim: ColorFn = ansi(2, 22);
export const italic: ColorFn = ansi(3, 23);
export const underline: ColorFn = ansi(4, 24);

export const red: ColorFn = ansi(31, 39);
export const green: ColorFn = ansi(32, 39);
export const yellow: ColorFn = ansi(33, 39);
export const blue: ColorFn = ansi(34, 39);
export const magenta: ColorFn = ansi(35, 39);
export const cyan: ColorFn = ansi(36, 39);
export const white: ColorFn = ansi(37, 39);
export const gray: ColorFn = ansi(90, 39);

export const bgCyan: ColorFn = ansi(46, 49);
export const bgBlue: ColorFn = ansi(44, 49);

export const heading: ColorFn = (text) => bold(cyan(text));
export const label: ColorFn = (text) => bold(white(text));
export const value: ColorFn = cyan;
export const muted: ColorFn = gray;
export const success: ColorFn = green;
export const warning: ColorFn = yellow;
export const error: ColorFn = red;
export const highlight: ColorFn = (text) => bold(yellow(text));
export const activeItem: ColorFn = (text) => bold(cyan(text));
export const selectedItem: ColorFn = (text) => bold(white(text));
export const sectionTitle: ColorFn = (text) => bold(blue(text));
export const activeSectionTitle: ColorFn = (text) => bold(cyan(text));
export const cursor: ColorFn = (text) => bold(green(text));
export const metaLabel: ColorFn = (text) => dim(text);

export const isColorEnabled = enabled;

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
