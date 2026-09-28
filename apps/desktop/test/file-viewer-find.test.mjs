import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { findKeyIntent, nextMatchIndex, renderedTextRanges } = await import(
  "../src/lib/rendered-text-search.ts"
);

function textNode(textContent, excluded = false) {
  return {
    textContent,
    parentElement: { closest: () => (excluded ? {} : null) },
  };
}

/**
 * The walker and ranges are the only DOM the search model touches, so a stubbed
 * document is enough to drive the real production chain — block splitting,
 * Unicode folding, and the range mapping included.
 */
function withStubbedDom(nodes, run) {
  const originalDocument = globalThis.document;
  const originalNodeFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  globalThis.document = {
    createTreeWalker: (_root, _mask, filter) => {
      const accepted = nodes.filter((node) => filter.acceptNode(node) === 1);
      let index = 0;
      return { nextNode: () => accepted[index++] ?? null };
    },
    createRange: () => ({
      setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
      },
      setEnd(node, offset) {
        this.endContainer = node;
        this.endOffset = offset;
      },
    }),
  };
  try {
    return run();
  } finally {
    globalThis.document = originalDocument;
    globalThis.NodeFilter = originalNodeFilter;
  }
}

test("a preview match spans inline elements and is found case-insensitively", () => {
  const nodes = [
    textNode("Intro "),
    textNode("NEE"),
    textNode("DLE and needle"),
    textNode("ignored", true),
  ];
  const ranges = withStubbedDom(nodes, () => renderedTextRanges({}, "needle"));
  assert.equal(ranges.length, 2);
  // The first hit started before the second text node, so it has to close
  // across the inline element React rendered rather than be dropped.
  assert.equal(ranges[0].startContainer, nodes[1]);
  assert.equal(ranges[0].startOffset, 0);
  assert.equal(ranges[0].endContainer, nodes[2]);
  assert.equal(ranges[0].endOffset, 3);
  assert.equal(ranges[1].startContainer, nodes[2]);
  assert.equal(ranges[1].startOffset, 8);
  assert.equal(ranges[1].endOffset, 14);
  assert.equal(
    withStubbedDom(nodes, () => renderedTextRanges({}, "ignored")).length,
    0,
    "a control label or hidden decoration is not searchable content",
  );
  assert.equal(withStubbedDom(nodes, () => renderedTextRanges({}, "   ")).length, 0);
  assert.equal(
    nodes[1].textContent,
    "NEE",
    "highlighting never rewrites the React-owned text",
  );
});

test("navigation wraps at both ends and reports nothing for no matches", () => {
  assert.equal(nextMatchIndex(-1, 3, 1), 0);
  assert.equal(nextMatchIndex(-1, 3, -1), 2);
  assert.equal(nextMatchIndex(0, 3, 1), 1);
  assert.equal(nextMatchIndex(2, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 3, -1), 2);
  assert.equal(nextMatchIndex(0, 0, 1), -1);
  assert.equal(nextMatchIndex(0, 0, -1), -1);
  // A document that shrank under a stale index still lands on a real match.
  assert.equal(nextMatchIndex(5, 3, 1), 0);
  assert.equal(nextMatchIndex(5, 3, -1), 2);
});

test("the find field keeps only the keys that mean something to it", () => {
  assert.deepEqual(findKeyIntent("Escape", false), { type: "close" });
  assert.deepEqual(findKeyIntent("Enter", false), { type: "step", direction: 1 });
  assert.deepEqual(findKeyIntent("Enter", true), { type: "step", direction: -1 });
  for (const key of ["a", "ArrowDown", "Tab", " "]) {
    assert.equal(findKeyIntent(key, false), null, key);
  }
});

test("the find bar reports the count, the empty result, and localized actions", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { FileFindBar } = await server.ssrLoadModule(
      "/src/components/workpanel/FileFindBar.tsx",
    );
    const render = async (locale, props) => {
      const i18n = createInstance();
      await i18n.init({
        lng: locale,
        resources: { [locale]: { translation: catalogs[locale] } },
      });
      return renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(FileFindBar, props),
        ),
      );
    };
    const props = {
      inputRef: { current: null },
      onQueryChange() {},
      onStep() {},
      onClose() {},
    };
    for (const [locale, catalog] of Object.entries(catalogs)) {
      const files = catalog.panel.files;
      const found = await render(locale, {
        ...props,
        query: "needle",
        index: 1,
        count: 4,
      });
      assert.ok(found.includes('class="file-find" role="search"'), locale);
      assert.doesNotMatch(
        found,
        /disabled=""/,
        `${locale} offers both steps while there is something to step through`,
      );
      assert.ok(
        found.includes(
          files.findCounter.replace("{{current}}", "2").replace("{{total}}", "4"),
        ),
        `${locale} counter`,
      );
      for (const key of ["find", "findPlaceholder", "findPrevious", "findNext", "findClose"]) {
        assert.ok(found.includes(files[key]), `${locale} ${key}`);
      }

      const empty = await render(locale, {
        ...props,
        query: "needle",
        index: -1,
        count: 0,
      });
      assert.ok(empty.includes(files.findNoMatch), `${locale} no match`);
      assert.equal(
        (empty.match(/disabled=""/g) ?? []).length,
        2,
        `${locale} has nothing to step through`,
      );

      const blank = await render(locale, {
        ...props,
        query: "",
        index: -1,
        count: 0,
      });
      assert.ok(
        !blank.includes(files.findNoMatch),
        `${locale} says nothing before a query is typed`,
      );
    }
  } finally {
    await server.close();
  }
});

test("the preview search is offered only where a Markdown preview is rendered", async () => {
  const viewer = await readFile(
    new URL("../src/components/workpanel/FilesTab.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    viewer,
    /selected !== null && file\?\.kind === "text" && isMarkdownPath\(selected\)/,
  );
  // The bar and its highlights read the previewed document, not the viewer's
  // file list: the toggle is gated on the preview and both the content root and
  // the scrolling body are the ones the preview is rendered into.
  assert.match(viewer, /\{markdownPreview && \(\n\s+<TooltipButton/);
  assert.match(viewer, /\{find\.open && markdownPreview && \(\n\s+<FileFindBar/);
  assert.match(
    viewer,
    /<div className="file-viewer-markdown prose-chat" ref=\{previewRef\}>/,
  );
  assert.match(
    viewer,
    /<div className="file-viewer-body" ref=\{viewerBodyRef\}>/,
  );
});
