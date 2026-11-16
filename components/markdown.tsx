"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Root, Element } from "hast";
import { Icon } from "./icons";
import { desktop } from "@/lib/runtime";

function ExternalLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const [error, setError] = useState("");
  const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
  return <><a href={safe} target="_blank" rel="noopener noreferrer" onClick={async (event) => {
    if (!desktop()) return;
    event.preventDefault();
    if (!safe) return;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(safe);
      setError("");
    } catch { setError("Could not open this link in your browser. Please retry."); }
  }}>{children}</a>{error && <span role="alert" data-selection-exclude="true">{error}</span>}</>;
}

// The visible KaTeX leaves participate in selection; the parallel MathML tree doesn't.
function selectionText() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      if (
        node.type === "element" &&
        (node.properties.className as string[] | undefined)?.includes(
          "katex-mathml",
        )
      ) {
        node.properties["data-selection-exclude"] = "true";
        return;
      }
      node.children.forEach((child) => {
        if (child.type === "element") walk(child);
      });
    };
    walk(tree);
  };
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <div className="code-toolbar" data-selection-exclude="true">
        <span>Code</span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={async (e) => {
            const code = e.currentTarget
              .closest(".code-block")
              ?.querySelector("code")?.textContent;
            if (code) {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
  rehypeKatex,
  [rehypeHighlight, { detect: false }],
  selectionText,
] as NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
const components: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => <ExternalLink href={href}>{children}</ExternalLink>,
  // Keep the image leaf (and canonical text) without loading model-supplied resources.
  img: ({ alt }) => <img alt={alt || "Image omitted"} />,
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
};

export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});
