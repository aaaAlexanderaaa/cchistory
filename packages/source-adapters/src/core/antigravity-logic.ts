import type { ConversationAtom } from "@cchistory/domain";
import { asString } from "./type-guards.js";
import { isUserTurnAtom } from "./factories.js";

export function collapseAntigravityUserTurnAtoms(atoms: ConversationAtom[]): ConversationAtom[] {
  const collapsed: ConversationAtom[] = [];
  let lastKeptUserAtom: ConversationAtom | undefined;
  let assistantSeenSinceLastUser = false;
  for (const atom of atoms) {
    if (atom.actor_kind === "assistant" && atom.content_kind === "text" && atom.display_policy !== "hide") {
      assistantSeenSinceLastUser = true;
    }
    if (isUserTurnAtom(atom)) {
      if (
        lastKeptUserAtom &&
        !assistantSeenSinceLastUser &&
        areAntigravityPromptVariantsSimilar(asString(lastKeptUserAtom.payload.text), asString(atom.payload.text)) &&
        antigravityAtomTimeDeltaMs(lastKeptUserAtom.time_key, atom.time_key) <= 10 * 60 * 1000
      ) {
        continue;
      }
      lastKeptUserAtom = atom;
      assistantSeenSinceLastUser = false;
    }
    collapsed.push(atom);
  }
  return collapsed;
}

export function areAntigravityPromptVariantsSimilar(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeAntigravityPromptVariant(left);
  const normalizedRight = normalizeAntigravityPromptVariant(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const shorter = normalizedLeft.length < normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length < normalizedRight.length ? normalizedRight : normalizedLeft;
  if (shorter.length >= 24 && longer.includes(shorter)) {
    return true;
  }

  const leftTokens = extractAntigravityPromptSimilarityTokens(normalizedLeft);
  const rightTokens = extractAntigravityPromptSimilarityTokens(normalizedRight);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  let overlapCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlapCount += 1;
    }
  }
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  const largerSize = Math.max(leftTokens.size, rightTokens.size);
  return overlapCount >= 4 && overlapCount / smallerSize >= 0.6 && overlapCount / largerSize >= 0.45;
}

export function normalizeAntigravityPromptVariant(value: string | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized || undefined;
}

export function extractAntigravityPromptSimilarityTokens(value: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "onto",
    "about",
    "following",
    "established",
    "project",
  ]);
  const tokens = new Set<string>();
  for (const rawToken of value.split(/\s+/u)) {
    const token = normalizeAntigravityPromptSimilarityToken(rawToken);
    if (!token || stopWords.has(token)) {
      continue;
    }
    tokens.add(token);
  }
  return tokens;
}

export function normalizeAntigravityPromptSimilarityToken(token: string): string | undefined {
  if (!token) {
    return undefined;
  }
  if (/^[a-z]{3,}$/u.test(token)) {
    if (token.endsWith("ies") && token.length > 4) {
      return token.slice(0, -3) + "y";
    }
    if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) {
      return token.slice(0, -1);
    }
    return token;
  }
  if (/[^\x00-\x7f]/u.test(token)) {
    return token.length >= 2 ? token : undefined;
  }
  return token.length >= 3 ? token : undefined;
}

export function antigravityAtomTimeDeltaMs(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(rightMs - leftMs);
}
