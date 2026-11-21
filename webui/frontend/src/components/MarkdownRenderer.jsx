import React, { useMemo } from "react";
import { parseMarkdownBlocks } from "../utils/markdownParser";

function renderInline(tokens, keyPrefix = "tok") {
  if (!Array.isArray(tokens)) return null;
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (token.type) {
      case "bold":
        return (
          <strong key={key} className="font-semibold text-theme-text">
            {renderInline(token.children, key)}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic text-theme-text">
            {renderInline(token.children, key)}
          </em>
        );
      case "code":
        return (
          <code
            key={key}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-black/35 border border-theme font-mono text-[0.85em] text-theme-text"
          >
            {token.value}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-theme-primary hover:underline font-medium break-words"
          >
            {token.label}
          </a>
        );
      default:
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
    }
  });
}

function renderList(listBlock, keyPrefix, compact) {
  const Tag = listBlock.ordered ? "ol" : "ul";
  const listStyle = listBlock.ordered ? "list-decimal" : "list-disc";
  return (
    <Tag
      className={`${listStyle} pl-5 ${compact ? "space-y-1.5" : "space-y-2"} text-theme-muted marker:text-theme-primary`}
    >
      {listBlock.items.map((item, idx) => {
        const key = `${keyPrefix}-li-${idx}`;
        return (
          <li key={key} className="leading-relaxed">
            <span>{renderInline(item.tokens, key)}</span>
            {item.children && (
              <div className="mt-1.5">{renderList(item.children, `${key}-sub`, compact)}</div>
            )}
          </li>
        );
      })}
    </Tag>
  );
}

function MarkdownRenderer({ content, compact = false, className = "" }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content || ""), [content]);

  if (!blocks.length) return null;

  return (
    <div className={`text-sm leading-relaxed text-theme-muted ${compact ? "space-y-3" : "space-y-4"} ${className}`}>
      {blocks.map((block, idx) => {
        const key = `md-block-${idx}`;
        switch (block.type) {
          case "heading": {
            const headingClasses = {
              1: "text-xl sm:text-2xl font-bold text-theme-text pt-1",
              2: "text-base sm:text-lg font-bold text-theme-text pt-2 border-b border-theme pb-1.5",
              3: "text-sm sm:text-base font-semibold text-theme-text pt-1.5",
              4: "text-sm font-semibold text-theme-text pt-1",
            };
            const Tag = `h${Math.min(4, Math.max(1, block.level))}`;
            return (
              <Tag key={key} className={headingClasses[block.level] || headingClasses[3]}>
                {renderInline(block.tokens, key)}
              </Tag>
            );
          }
          case "hr":
            return <hr key={key} className="border-theme my-2" />;
          case "image": {
            const imgStyle = {};
            if (block.width) imgStyle.maxWidth = `min(100%, ${block.width}px)`;
            if (block.height) imgStyle.maxHeight = `${block.height}px`;
            return (
              <figure key={key} className="my-3 overflow-hidden rounded-lg border border-theme bg-black/30">
                <div className="p-2 flex justify-center">
                  <img
                    src={block.src}
                    alt={block.alt || "Release preview"}
                    loading="lazy"
                    style={Object.keys(imgStyle).length ? imgStyle : undefined}
                    className="w-auto max-w-full h-auto max-h-96 object-contain mx-auto block rounded"
                  />
                </div>
                {block.alt && (
                  <figcaption className="px-3 py-1.5 text-xs text-theme-muted border-t border-theme text-center">
                    {block.alt}
                  </figcaption>
                )}
              </figure>
            );
          }
          case "linkBar":
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 py-1">
                {block.items.map((link, linkIdx) => (
                  <a
                    key={`${key}-link-${linkIdx}`}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-full text-xs font-medium bg-theme-hover hover:bg-black/40 border border-theme hover:border-theme-primary text-theme-text transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-lg border border-theme bg-black/20">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-theme">
                      {block.headers.map((cell, cIdx) => (
                        <th key={`${key}-h-${cIdx}`} className="px-3 py-2 font-semibold text-theme-text whitespace-nowrap">
                          {renderInline(cell, `${key}-h-${cIdx}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {block.rows.map((row, rIdx) => (
                      <tr key={`${key}-r-${rIdx}`}>
                        {row.map((cell, cIdx) => (
                          <td key={`${key}-r-${rIdx}-c-${cIdx}`} className="px-3 py-2 align-top text-theme-muted">
                            {renderInline(cell, `${key}-r-${rIdx}-c-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list":
            return <div key={key}>{renderList(block, key, compact)}</div>;
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-theme-primary bg-black/25 px-3.5 py-2.5 rounded-r-lg text-theme-text"
              >
                {renderInline(block.tokens, key)}
              </blockquote>
            );
          case "codeblock":
            return (
              <pre
                key={key}
                className="p-3 rounded-lg bg-black/40 border border-theme text-xs font-mono text-theme-text overflow-x-auto"
              >
                <code>{block.code}</code>
              </pre>
            );
          case "paragraph":
          default:
            return (
              <p key={key} className="leading-relaxed">
                {renderInline(block.tokens, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

export default MarkdownRenderer;
