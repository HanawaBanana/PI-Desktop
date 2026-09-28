import { searchMatchRanges } from "./session-search";

/**
 * Find literal text in content the renderer already painted.
 *
 * Search runs over rendered content, so it has to agree with what the surface
 * shows instead of with the source it was built from, and it must resolve a
 * hit on nodes React owns instead of rewriting them. What a keypress in a find
 * field means is part of the same contract, so it stays testable here instead
 * of buried in the component that renders the field.
 */
const NON_CONTENT =
  "button:not(.chat-text-link):not(.chat-file-chip):not(.chat-code-link), textarea, [aria-hidden='true']";

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(NON_CONTENT)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = text.length;
    text += node.textContent ?? "";
    nodes.push({ node: node as Text, start, end: text.length });
  }
  return { nodes, text };
}

/**
 * Every literal match of `query` in the text under `root`, in document order.
 *
 * A hit comes back as a DOM range, so a match that spans inline elements — a
 * bolded word, a link label — is still one range, and painting it never
 * touches the React-owned DOM.
 */
export function renderedTextRanges(root: HTMLElement, query: string): Range[] {
  const { nodes, text } = textNodes(root);
  return searchMatchRanges(text, query).flatMap(([start, end]) => {
    const first = nodes.find((part) => part.end > start);
    const last = nodes.find((part) => part.end >= end && part.start < end);
    if (!first || !last) return [];
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return [range];
  });
}

/**
 * The match a navigation step lands on, wrapping at both ends.
 *
 * `current` is -1 when nothing is active yet, which is also what an empty
 * result set reports: a find bar can therefore count and step without
 * tracking "started" separately.
 */
export function nextMatchIndex(
  current: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export type FindIntent =
  | { type: "step"; direction: 1 | -1 }
  | { type: "close" }
  | null;

/**
 * What a keypress in a find field asks for, or null when the field owns it.
 *
 * Enter steps forward and Shift+Enter steps back — the pair every find bar
 * uses — and Escape closes. Any other key, including the arrow keys that move
 * the caret, stays the input's own behavior.
 */
export function findKeyIntent(key: string, shiftKey: boolean): FindIntent {
  if (key === "Escape") return { type: "close" };
  if (key === "Enter") return { type: "step", direction: shiftKey ? -1 : 1 };
  return null;
}
