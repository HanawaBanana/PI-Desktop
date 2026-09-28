import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { nextMatchIndex, renderedTextRanges } from "../lib/rendered-text-search";

/**
 * Custom-highlight registries for in-content search. All matches and the
 * active one are separate registries so the active match can read differently
 * without a second pass over the DOM.
 */
const ALL_MATCHES = "rendered-find";
const ACTIVE_MATCH = "rendered-find-active";

function paintHighlights(found: Range[], active: number) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  CSS.highlights.delete(ALL_MATCHES);
  CSS.highlights.delete(ACTIVE_MATCH);
  if (!found.length) return;
  CSS.highlights.set(ALL_MATCHES, new Highlight(...found));
  const current = found[active];
  if (current) CSS.highlights.set(ACTIVE_MATCH, new Highlight(current));
}

function clearHighlights() {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  CSS.highlights.delete(ALL_MATCHES);
  CSS.highlights.delete(ACTIVE_MATCH);
}

/** Bring the active match to the middle of the scroller it lives in. */
function alignToMatch(scroller: HTMLElement | null, range: Range | undefined) {
  if (!scroller || !range) return;
  const rect = range.getBoundingClientRect();
  // A match in a collapsed, unloaded, or hidden subtree has no box to align to.
  if (!rect.height && !rect.width) return;
  const viewport = scroller.getBoundingClientRect();
  const offset = rect.top - viewport.top - viewport.height / 2 + rect.height / 2;
  if (Math.abs(offset) < 4) return;
  scroller.scrollTop += offset;
}

export type RenderedFind = {
  open: boolean;
  query: string;
  /** 0-based index of the active match; -1 when the query matches nothing. */
  index: number;
  count: number;
  setQuery: (query: string) => void;
  step: (direction: 1 | -1) => void;
  toggle: () => void;
  close: () => void;
};

/**
 * Literal search over rendered content, for a surface that cannot rewrite the
 * DOM it searches.
 *
 * The match list is rebuilt from the live DOM rather than kept from the moment
 * a query was typed: rendering a document keeps replacing its own text nodes
 * (async syntax highlighting, diagrams), and a range resolved against nodes
 * that are gone highlights nothing. Rebuilding is why every mutation of the
 * content re-counts, not just a keystroke.
 *
 * `index` is mirrored in a ref because painting happens both in a commit (a new
 * query) and in a mutation callback (late content), and only one of those two
 * has a fresh render to read state from.
 */
export function useRenderedFind({
  enabled,
  containerRef,
  scrollRef,
  contentVersion,
  inputRef,
  returnFocusRef,
}: {
  /** Whether a searchable preview is on screen at all. */
  enabled: boolean;
  /** The rendered content to search. */
  containerRef: RefObject<HTMLElement | null>;
  /** The scrolling ancestor the active match is aligned inside. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Changes when the searched source does, so a new document re-counts. */
  contentVersion: unknown;
  /** The field to focus when the bar opens. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** The control focus returns to when the bar closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}): RenderedFind {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(-1);
  const [count, setCount] = useState(0);
  const ranges = useRef<Range[]>([]);
  const active = useRef(-1);
  const searching = open && enabled && query.trim().length > 0;

  const reset = useCallback(() => {
    ranges.current = [];
    active.current = -1;
    setCount(0);
    setIndex(-1);
    clearHighlights();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
    returnFocusRef.current?.focus();
  }, [reset, returnFocusRef]);

  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [close, open]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const found = ranges.current;
      const next = nextMatchIndex(active.current, found.length, direction);
      active.current = next;
      setIndex(next);
      paintHighlights(found, next);
      alignToMatch(scrollRef.current, found[next]);
    },
    [scrollRef],
  );

  // A preview that stops being searchable (another file kind, the tree) has no
  // bar to keep open.
  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    reset();
  }, [enabled, reset]);

  useEffect(() => {
    if (open && enabled) inputRef.current?.focus();
  }, [enabled, inputRef, open]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!searching || !root) return;
    let frame = 0;
    const recompute = () => {
      const found = renderedTextRanges(root, query);
      const next = nextMatchIndex(active.current, found.length, 1);
      ranges.current = found;
      active.current = next;
      setCount(found.length);
      setIndex(next);
      paintHighlights(found, next);
      alignToMatch(scrollRef.current, found[next]);
    };
    recompute();
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [containerRef, query, scrollRef, searching, contentVersion]);

  // The registries are process-wide, so a surface that goes away must take its
  // paint with it instead of leaving it on nodes a later document reuses.
  useEffect(() => clearHighlights, []);

  return { open, query, index, count, setQuery, step, toggle, close };
}
