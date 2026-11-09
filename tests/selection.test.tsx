import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/markdown";
import {
  buildSelectableTextIndex,
  getOffsetsFromRange,
  restoreRangeFromOffsets,
} from "../lib/selection";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(markdown: string) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<Markdown content={markdown} />);
  document.body.append(root);
  return root;
}

describe("selection against the actual Markdown renderer", () => {
  it("keeps repeated phrases distinct through layout markup changes", () => {
    const root = render("Same phrase.\n\nSame **phrase**.");
    const p = root.querySelectorAll("p")[1];
    const range = document.createRange();
    range.selectNodeContents(p);
    const anchor = getOffsetsFromRange(root, range)!;
    expect(anchor.selectedText).toBe("Same phrase.");
    expect(anchor.startOffset).toBe(13);
    root.innerHTML =
      "<p>Same phrase.</p><p><span>Same </span><strong><span>phrase</span></strong><span>.</span></p>";
    const restored = restoreRangeFromOffsets(
      root,
      anchor.startOffset,
      anchor.endOffset,
    )!;
    expect(restored.toString()).toBe("Same phrase.");
    expect(p.isConnected).toBe(false);
    expect(
      root.querySelectorAll("p")[1].contains(restored.startContainer),
    ).toBe(true);
  });

  it("preserves tokenized code newlines while excluding copy controls", () => {
    const root = render("```python\nx = 1\ny = x + 2\nprint(y)\n```");
    const index = buildSelectableTextIndex(root);
    expect(index.text).toBe("x = 1\ny = x + 2\nprint(y)\n");
    const range = restoreRangeFromOffsets(root, 6, 15)!;
    expect(range.toString()).toBe("y = x + 2");
    expect(getOffsetsFromRange(root, range)?.selectedText).toBe("y = x + 2");
  });

  it("indexes visible inline and display math once, excluding hidden MathML", () => {
    const root = render("Take $x + y$.\n\n$$\nE = mc^2\n$$");
    expect(
      root.querySelectorAll(".katex-mathml[data-selection-exclude]"),
    ).toHaveLength(2);
    const index = buildSelectableTextIndex(root);
    expect(index.text).not.toContain("x + y"); // Raw TeX exists only in excluded annotations.
    const visible = root.querySelectorAll(".katex-html")[1];
    const range = document.createRange();
    range.selectNodeContents(visible);
    const anchor = getOffsetsFromRange(root, range)!;
    expect(anchor.selectedText).toContain("E");
    expect(anchor.selectedText).toContain("mc");
    expect(
      restoreRangeFromOffsets(
        root,
        anchor.startOffset,
        anchor.endOffset,
      )?.toString(),
    ).toBe(anchor.selectedText);
  });

  it("preserves table tabs and list/block boundaries", () => {
    const root = render(
      "| A | B |\n| - | - |\n| one | two |\n| three | four |\n\n- first\n- second",
    );
    const index = buildSelectableTextIndex(root);
    expect(index.text).toBe("A\tB\none\ttwo\nthree\tfour\nfirst\nsecond");
    const cells = root.querySelectorAll("td");
    const range = document.createRange();
    range.setStart(cells[0].firstChild!, 0);
    range.setEnd(cells[3].firstChild!, 4);
    expect(getOffsetsFromRange(root, range)?.selectedText).toBe(
      "one\ttwo\nthree\tfour",
    );
  });

  it("uses UTF-16 offsets without splitting emoji or matching the wrong occurrence", () => {
    const root = render("🙂 hello 🙂 hello");
    const range = restoreRangeFromOffsets(root, 9, 17)!;
    expect(range.toString()).toBe("🙂 hello");
    expect(getOffsetsFromRange(root, range)).toEqual({
      selectedText: "🙂 hello",
      startOffset: 9,
      endOffset: 17,
    });
  });

  it("trims selection whitespace and rejects excluded UI and empty selections", () => {
    const root = render("   hello world   \n\n```js\nconst x = 1;\n```");
    const p = root.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    expect(getOffsetsFromRange(root, range)?.selectedText).toBe("hello world");
    range.selectNodeContents(root.querySelector(".code-toolbar span")!);
    expect(getOffsetsFromRange(root, range)).toBeNull();
    expect(restoreRangeFromOffsets(root, 3, 3)).toBeNull();
  });

  it("keeps hard line breaks between prose lines", () => {
    const root = render("first  \nsecond");
    expect(buildSelectableTextIndex(root).text).toBe("first\nsecond");
  });
});
