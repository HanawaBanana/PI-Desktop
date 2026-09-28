import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from "../icons";
import { TooltipButton } from "../ui";
import { findKeyIntent } from "../../lib/rendered-text-search";

/**
 * Find bar for the file viewer's rendered Markdown preview.
 *
 * It only ever reports what the preview holds, so the count is read off the
 * matches themselves and the field owns navigation: Enter steps forward,
 * Shift+Enter back, Escape closes and returns focus to the control that opened
 * it.
 */
export function FileFindBar({
  inputRef,
  query,
  index,
  count,
  onQueryChange,
  onStep,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** 0-based index of the active match; -1 when the query matches nothing. */
  index: number;
  count: number;
  onQueryChange: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const empty = query.trim().length === 0;
  const status = empty
    ? ""
    : count === 0
      ? t("panel.files.findNoMatch")
      : t("panel.files.findCounter", { current: index + 1, total: count });
  return (
    <div className="file-find" role="search">
      <span className="file-find-glyph" aria-hidden>
        <IconSearch size={14} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="file-find-input"
        value={query}
        placeholder={t("panel.files.findPlaceholder")}
        aria-label={t("panel.files.find")}
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          const intent = findKeyIntent(event.key, event.shiftKey);
          if (!intent) return;
          event.preventDefault();
          if (intent.type === "close") onClose();
          else onStep(intent.direction);
        }}
      />
      <span className="file-find-count" role="status" aria-live="polite">
        {status}
      </span>
      <TooltipButton
        type="button"
        className="icon-btn icon-btn-square"
        tooltip={t("panel.files.findPrevious")}
        ariaLabel={t("panel.files.findPrevious")}
        disabled={count === 0}
        onClick={() => onStep(-1)}
      >
        <IconChevronUp size={14} />
      </TooltipButton>
      <TooltipButton
        type="button"
        className="icon-btn icon-btn-square"
        tooltip={t("panel.files.findNext")}
        ariaLabel={t("panel.files.findNext")}
        disabled={count === 0}
        onClick={() => onStep(1)}
      >
        <IconChevronDown size={14} />
      </TooltipButton>
      <TooltipButton
        type="button"
        className="icon-btn icon-btn-square"
        tooltip={t("panel.files.findClose")}
        ariaLabel={t("panel.files.findClose")}
        onClick={onClose}
      >
        <IconClose size={14} />
      </TooltipButton>
    </div>
  );
}
