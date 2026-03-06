export interface SnippetPart {
  text: string;
  highlighted: boolean;
}

export function splitHighlightedSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let highlighted = false;

  for (const token of snippet.split(/(<mark>|<\/mark>)/g)) {
    if (!token) continue;
    if (token === "<mark>") {
      highlighted = true;
      continue;
    }
    if (token === "</mark>") {
      highlighted = false;
      continue;
    }
    parts.push({ text: token, highlighted });
  }

  return parts;
}
