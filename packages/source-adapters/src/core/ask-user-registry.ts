import type {
  AskUserAnswer,
  AskUserQuestionOptionSpec,
  AskUserQuestionSpec,
  SourcePlatform,
} from "@cchistory/domain";
import { asArray, asString, isObject, safeJsonParse } from "./type-guards.js";

export interface AskUserToolProfile {
  toolNames: string[];
  parseCall: (input: unknown) => AskUserQuestionSpec[];
  parseResult: (output: unknown, specs: AskUserQuestionSpec[]) => AskUserAnswer[];
}

export const ASK_USER_PROFILES: Partial<Record<SourcePlatform, AskUserToolProfile>> = {
  claude_code: {
    toolNames: ["AskUserQuestion"],
    parseCall: parseClaudeCall,
    parseResult: parseClaudeResult,
  },
  codex: {
    toolNames: ["request_user_input"],
    parseCall: parseCodexCall,
    parseResult: parseCodexResult,
  },
};

export function getAskUserProfile(platform: SourcePlatform): AskUserToolProfile | undefined {
  return ASK_USER_PROFILES[platform];
}

function parseClaudeCall(input: unknown): AskUserQuestionSpec[] {
  if (!isObject(input)) {
    return [];
  }
  return asArray(input.questions)
    .filter(isObject)
    .map((question) => normalizeSpec(question, asString(question.question) ?? ""));
}

function parseClaudeResult(output: unknown, specs: AskUserQuestionSpec[]): AskUserAnswer[] {
  const rawText = normalizeOutputToString(output);
  const parsed = safeJsonParse(rawText);
  if (Array.isArray(parsed)) {
    return parsed.filter(isObject).map((entry, index) => answerFromEntry(entry, index, specs));
  }
  if (isObject(parsed)) {
    return [answerFromEntry(parsed, 0, specs)];
  }
  // Claude Code wraps single-select answers as:
  //   'Your questions have been answered: "<question>"="<selected>"'
  // Pull out the inner pair so we can match against option labels.
  const wrapped = extractClaudeWrappedAnswers(rawText);
  if (wrapped.length > 0) {
    return mapWrappedClaudeAnswers(wrapped, specs);
  }
  return coercePlainTextAnswers(rawText, specs);
}

function parseCodexCall(input: unknown): AskUserQuestionSpec[] {
  if (!isObject(input)) {
    return [];
  }
  return asArray(input.questions)
    .filter(isObject)
    .map((question) => normalizeSpec(question, asString(question.question) ?? ""));
}

function parseCodexResult(output: unknown, specs: AskUserQuestionSpec[]): AskUserAnswer[] {
  const rawText = normalizeOutputToString(output);
  const parsed = safeJsonParse(rawText);
  if (!isObject(parsed)) {
    return coercePlainTextAnswers(rawText, specs);
  }
  const answersMap = isObject(parsed.answers) ? parsed.answers : undefined;
  if (!answersMap) {
    return coercePlainTextAnswers(rawText, specs);
  }
  const mapEntries = Object.entries(answersMap);
  const usedKeys = new Set<string>();
  const answers: AskUserAnswer[] = [];
  specs.forEach((spec, index) => {
    const id = spec.id;
    if (id && isObject(answersMap[id])) {
      usedKeys.add(id);
      pushCodexAnswer(answersMap[id] as Record<string, unknown>, spec, index, answers);
      return;
    }
    // Defensive fallback: if a spec has no id (or its id is missing from
    // the answers map), pair it with the next unused answers-map entry by
    // declaration order. Id-keyed matching is the documented Codex path;
    // this guards against a spec regression silently dropping answers.
    const fallback = mapEntries.find(([key]) => !usedKeys.has(key));
    if (!fallback) {
      return;
    }
    usedKeys.add(fallback[0]);
    if (!isObject(fallback[1])) {
      return;
    }
    pushCodexAnswer(fallback[1] as Record<string, unknown>, spec, index, answers);
  });
  return answers;
}

function pushCodexAnswer(
  slot: Record<string, unknown>,
  spec: AskUserQuestionSpec,
  index: number,
  answers: AskUserAnswer[],
): void {
  // Codex protocol: RequestUserInputAnswer has only `answers: Vec<String>`.
  // Free-text input is folded into the same array (typically against an
  // `is_other`-flagged option), so we treat every entry as a candidate label.
  const labels = asArray(slot.answers)
    .map((entry) => asString(entry) ?? "")
    .filter((entry) => entry.length > 0);
  if (labels.length === 0) {
    return;
  }
  // AskUserAnswer only models a single selected_label, so for Codex
  // multi-select we keep the first matched label and fold the rest into
  // free_text. The schema would need a selected_labels array to represent
  // multi-select faithfully.
  const matched = matchOptionLabel(labels[0], spec);
  answers.push({
    question_index: index,
    selected_label: matched,
    free_text: matched
      ? labels.length > 1
        ? labels.slice(1).join(", ")
        : undefined
      : labels.join(", "),
  });
}

function normalizeSpec(raw: Record<string, unknown>, fallbackQuestion: string): AskUserQuestionSpec {
  const question = asString(raw.question) ?? fallbackQuestion;
  const header = asString(raw.header) ?? asString(raw.title) ?? undefined;
  const id = asString(raw.id) ?? undefined;
  const options: AskUserQuestionOptionSpec[] = asArray(raw.options)
    .filter(isObject)
    .map((option) => ({
      label: asString(option.label) ?? asString(option.value) ?? asString(option.name) ?? "",
      description: asString(option.description) ?? asString(option.detail) ?? undefined,
    }))
    .filter((option) => option.label.length > 0);
  return { header, question, options, id };
}

function normalizeOutputToString(output: unknown): string {
  if (Array.isArray(output)) {
    return output
      .filter(isObject)
      .map((entry) => asString(entry.text) ?? asString(entry.content) ?? JSON.stringify(entry))
      .join("\n")
      .trim();
  }
  if (isObject(output)) {
    return JSON.stringify(output);
  }
  return asString(output) ?? "";
}

function answerFromEntry(
  entry: Record<string, unknown>,
  questionIndex: number,
  specs: AskUserQuestionSpec[],
): AskUserAnswer {
  const candidate =
    asString(entry.selected_label) ??
    asString(entry.label) ??
    asString(entry.value) ??
    asString(entry.answer) ??
    asString(entry.text) ??
    asString(entry.free_text) ??
    undefined;
  const spec = specs[questionIndex];
  const matched = matchOptionLabel(candidate, spec);
  const resolvedIndex =
    typeof entry.question_index === "number" ? entry.question_index : questionIndex;
  return {
    question_index: resolvedIndex,
    selected_label: matched,
    free_text: matched ? undefined : candidate,
  };
}

function coercePlainTextAnswers(rawText: string, specs: AskUserQuestionSpec[]): AskUserAnswer[] {
  if (!rawText) {
    return [];
  }
  if (specs.length === 0) {
    return [{ question_index: 0, free_text: rawText }];
  }
  // If the unstructured text happens to match one option's label exactly,
  // pin the answer to that question. Otherwise emit a single free-text
  // answer on question_index 0 — duplicating rawText across every question
  // would misrepresent a single user response as N responses.
  for (let index = 0; index < specs.length; index += 1) {
    const matched = matchOptionLabel(rawText, specs[index]);
    if (matched) {
      return [{ question_index: index, selected_label: matched }];
    }
  }
  return [{ question_index: 0, free_text: rawText }];
}

function extractClaudeWrappedAnswers(
  rawText: string,
): Array<{ question: string; answer: string }> {
  // Claude Code wraps structured single-select responses as:
  //   Your questions have been answered: "<q>"="<a>"[, "<q2>"="<a2>"]...
  // Pull each "<q>"="<a>" pair out so we can match the answer against option labels.
  if (!rawText) {
    return [];
  }
  const headerMatch = rawText.match(/Your questions have been answered:\s*(.*)$/u);
  if (!headerMatch) {
    return [];
  }
  const body = headerMatch[1];
  if (!body) {
    return [];
  }
  const pairRegex = /"([^"]*)"\s*=\s*"([^"]*)"/gu;
  const pairs: Array<{ question: string; answer: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(body)) !== null) {
    pairs.push({ question: match[1] ?? "", answer: match[2] ?? "" });
  }
  return pairs;
}

function mapWrappedClaudeAnswers(
  pairs: Array<{ question: string; answer: string }>,
  specs: AskUserQuestionSpec[],
): AskUserAnswer[] {
  return pairs.map((pair, index) => {
    const resolvedSpec =
      specs.find((candidate) => candidate.question === pair.question) ?? specs[index];
    const matched = matchOptionLabel(pair.answer, resolvedSpec);
    return {
      question_index: resolvedSpec ? specs.indexOf(resolvedSpec) : index,
      selected_label: matched,
      free_text: matched ? undefined : pair.answer,
    };
  });
}

function matchOptionLabel(
  candidate: string | undefined,
  spec: AskUserQuestionSpec | undefined,
): string | undefined {
  if (!candidate || !spec) {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return undefined;
  }
  const exact = spec.options.find((option) => option.label === trimmed);
  if (exact) {
    return exact.label;
  }
  const caseInsensitive = spec.options.find(
    (option) => option.label.toLowerCase() === trimmed.toLowerCase(),
  );
  return caseInsensitive?.label;
}
