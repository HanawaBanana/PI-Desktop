import { searchMatchRanges } from "./session-search";
import { renderedTextRanges } from "./rendered-text-search";

export type TranscriptSearchMatch = {
  ranges: Range[];
  /** A source-only match highlights its rendered element, such as a link label. */
  sourceElement?: HTMLElement;
};

/** The parser maps hidden Markdown syntax and destinations to their visible owner. */
export function locateTranscriptSearch(
  root: HTMLElement,
  query: string,
  source: string,
): TranscriptSearchMatch {
  const first = searchMatchRanges(source, query)[0];
  let owner: HTMLElement | undefined;
  let ownerLength = Infinity;
  if (first) {
    for (const element of root.querySelectorAll<HTMLElement>("[data-source-start][data-source-end]")) {
      const start = Number(element.dataset.sourceStart);
      const end = Number(element.dataset.sourceEnd);
      if (start <= first[0] && end >= first[1] && end - start < ownerLength) {
        owner = element;
        ownerLength = end - start;
      }
    }
  }
  const ranges = renderedTextRanges(owner ?? root, query);
  if (ranges.length || !owner) return { ranges };
  // Link URLs, emphasis delimiters, and image destinations have no literal
  // rendered text. Their source owner is still a precise, visible destination.
  return { ranges: [], sourceElement: owner };
}
