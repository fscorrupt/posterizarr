/**
 * Safe, zero-dependency Markdown parser for GitHub release notes and changelogs.
 * Produces a structured AST rendered directly by React components (no dangerouslySetInnerHTML).
 */

const BLOCKED_TAG_CONTENT_RE = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ANY_HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Validate and normalize an external URL; allows only http:// and https:// URLs.
 */
export function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

const BASIC_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeBasicEntities(text) {
  return String(text || "").replace(
    /&(?:amp|lt|gt|quot|#39|nbsp);/g,
    (entity) => BASIC_ENTITY_MAP[entity] || entity
  );
}

function stripBlockedTagContent(text) {
  let current = String(text || "");
  let previous;
  do {
    previous = current;
    current = current.replace(BLOCKED_TAG_CONTENT_RE, "");
  } while (current !== previous);
  return current;
}

function stripUnsafeTags(text) {
  let current = stripBlockedTagContent(text).replace(/<br\s*\/?>/gi, " ");
  let previous;
  do {
    previous = current;
    current = current.replace(ANY_HTML_TAG_RE, "");
  } while (current !== previous);
  return current;
}

function extractHtmlAttribute(attrString, attrName) {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = regex.exec(attrString || "");
  if (!match) return "";
  return decodeBasicEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function pushTextToken(tokens, value) {
  if (!value) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.type === "text") {
    prev.value += value;
  } else {
    tokens.push({ type: "text", value });
  }
}

/**
 * Parse inline formatting (`code`, **bold**, *italic*, [text](url), <a href="...">text</a>)
 * into flat token objects. Safe against raw HTML and unsafe URL schemes.
 */
export function parseInlineTokens(input) {
  if (!input || typeof input !== "string") return [];
  const cleaned = stripBlockedTagContent(input);
  const tokens = [];
  let i = 0;

  while (i < cleaned.length) {
    // 1. Inline code span
    if (cleaned[i] === "`") {
      const end = cleaned.indexOf("`", i + 1);
      if (end !== -1) {
        tokens.push({ type: "code", value: cleaned.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // 2. HTML anchor tag <a href="...">label</a>
    if (cleaned[i] === "<" && /^<a\b/i.test(cleaned.slice(i))) {
      const anchorMatch = /^<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(cleaned.slice(i));
      if (anchorMatch) {
        const href = sanitizeUrl(extractHtmlAttribute(anchorMatch[1], "href"));
        const label = decodeBasicEntities(stripUnsafeTags(anchorMatch[2])).trim();
        if (href && label) {
          tokens.push({ type: "link", label, href });
        } else if (label) {
          pushTextToken(tokens, label);
        }
        i += anchorMatch[0].length;
        continue;
      }
    }

    // 3. Any other raw HTML tag -> strip cleanly
    if (cleaned[i] === "<") {
      const tagMatch = /^<\/?[a-zA-Z][^>]*>/.exec(cleaned.slice(i));
      if (tagMatch) {
        if (/^<br\s*\/?>$/i.test(tagMatch[0])) {
          pushTextToken(tokens, " ");
        }
        i += tagMatch[0].length;
        continue;
      }
    }

    // 4. Inline Markdown image syntax inside prose -> extract alt text safely
    if (cleaned[i] === "!" && cleaned[i + 1] === "[") {
      const imgMatch = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(cleaned.slice(i));
      if (imgMatch) {
        const alt = imgMatch[1].trim();
        if (alt) pushTextToken(tokens, alt);
        i += imgMatch[0].length;
        continue;
      }
    }

    // 5. Markdown link [label](url)
    if (cleaned[i] === "[") {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(cleaned.slice(i));
      if (linkMatch) {
        const label = decodeBasicEntities(stripUnsafeTags(linkMatch[1]));
        const href = sanitizeUrl(linkMatch[2]);
        if (href) {
          tokens.push({ type: "link", label, href });
        } else {
          pushTextToken(tokens, label);
        }
        i += linkMatch[0].length;
        continue;
      }
    }

    // 6. Bold **text** or __text__
    if (cleaned.startsWith("**", i)) {
      const end = cleaned.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        const inner = cleaned.slice(i + 2, end);
        tokens.push({ type: "bold", children: parseInlineTokens(inner) });
        i = end + 2;
        continue;
      }
    }

    // 7. Italic *text* (avoid matching list markers or bare asterisks with spaces)
    if (cleaned[i] === "*" && cleaned[i + 1] !== "*" && cleaned[i + 1] !== " ") {
      const end = cleaned.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1 && cleaned[end - 1] !== " ") {
        const inner = cleaned.slice(i + 1, end);
        tokens.push({ type: "italic", children: parseInlineTokens(inner) });
        i = end + 1;
        continue;
      }
    }

    // 8. Underscore italic _text_ only on whitespace/punctuation boundaries (preserves snake_case)
    if (cleaned[i] === "_") {
      const prevChar = i === 0 ? " " : cleaned[i - 1];
      if (/[\s(["']/.test(prevChar)) {
        const italicMatch = /^_([^\s_](?:[^_]*[^\s_])?)_(?=$|[\s.,!?;:)"'\]]|<)/.exec(cleaned.slice(i));
        if (italicMatch) {
          tokens.push({ type: "italic", children: parseInlineTokens(italicMatch[1]) });
          i += italicMatch[0].length;
          continue;
        }
      }
    }

    // 9. Escaped markdown character
    if (cleaned[i] === "\\" && i + 1 < cleaned.length && /[\\`*_{}[\]()#+\-.!|<>]/.test(cleaned[i + 1])) {
      pushTextToken(tokens, cleaned[i + 1]);
      i += 2;
      continue;
    }

    // 10. Bare HTTP(S) URLs (e.g. GitHub Full Changelog links)
    if (
      (cleaned.startsWith("https://", i) || cleaned.startsWith("http://", i)) &&
      (i === 0 || /[\s(["']/.test(cleaned[i - 1]))
    ) {
      const urlMatch = /^https?:\/\/[^\s<>)\]]+/i.exec(cleaned.slice(i));
      if (urlMatch) {
        const rawCandidate = urlMatch[0];
        const trimmedUrl = rawCandidate.replace(/[.,;:!?]+$/, "");
        const trailing = rawCandidate.slice(trimmedUrl.length);
        const safeHref = sanitizeUrl(trimmedUrl);
        if (safeHref) {
          tokens.push({ type: "link", label: trimmedUrl, href: safeHref });
          if (trailing) pushTextToken(tokens, trailing);
          i += rawCandidate.length;
          continue;
        }
      }
    }

    // Plain character
    pushTextToken(tokens, decodeBasicEntities(cleaned[i]));
    i += 1;
  }

  return tokens;
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);

  const cells = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "`") {
      inCode = !inCode;
      current += ch;
    } else if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparatorLine(line) {
  if (!line || !line.includes("-")) return false;
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isHorizontalRule(line) {
  return /^\s*(?:-\s*){3,}$/.test(line) || /^\s*(?:\*\s*){3,}$/.test(line) || /^\s*(?:_\s*){3,}$/.test(line);
}

function matchListItem(line) {
  const unordered = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (unordered) {
    return {
      indent: unordered[1].replace(/\t/g, "  ").length,
      ordered: false,
      content: unordered[3],
    };
  }
  const ordered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1].replace(/\t/g, "  ").length,
      ordered: true,
      content: ordered[3],
    };
  }
  return null;
}

function parseListBlock(lines, startIndex) {
  const flatItems = [];
  const firstMatch = matchListItem(lines[startIndex]);
  const rootIndent = firstMatch.indent;
  const rootOrdered = firstMatch.ordered;
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // Peek ahead: if next non-blank line is another list item at >= rootIndent, keep inside list
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      const nextItem = nextIdx < lines.length ? matchListItem(lines[nextIdx]) : null;
      if (nextItem && (nextItem.indent > rootIndent || nextItem.ordered === rootOrdered)) {
        i = nextIdx;
        continue;
      }
      break;
    }

    const itemMatch = matchListItem(line);
    if (itemMatch) {
      if (itemMatch.indent === rootIndent && itemMatch.ordered !== rootOrdered) {
        break;
      }
      flatItems.push({
        indent: itemMatch.indent,
        ordered: itemMatch.ordered,
        text: itemMatch.content.trim(),
      });
      i += 1;
      continue;
    }

    // Continuation line indented further than the current list marker
    const leadingSpaces = /^(\s*)/.exec(line)[1].replace(/\t/g, "  ").length;
    if (flatItems.length > 0 && leadingSpaces > flatItems[flatItems.length - 1].indent) {
      flatItems[flatItems.length - 1].text += " " + line.trim();
      i += 1;
      continue;
    }

    break;
  }

  // Build nested list tree from indentation levels
  function buildTree(items, minIndent) {
    const result = [];
    let idx = 0;
    while (idx < items.length) {
      const current = items[idx];
      const node = {
        tokens: parseInlineTokens(current.text),
        children: null,
      };
      idx += 1;

      const subItems = [];
      while (idx < items.length && items[idx].indent > current.indent) {
        subItems.push(items[idx]);
        idx += 1;
      }
      if (subItems.length > 0) {
        node.children = {
          ordered: subItems[0].ordered,
          items: buildTree(subItems, current.indent + 1),
        };
      }
      result.push(node);
    }
    return result;
  }

  return {
    block: {
      type: "list",
      ordered: rootOrdered,
      items: buildTree(flatItems, rootIndent),
    },
    nextIndex: i,
  };
}

function parsePositiveDimension(rawValue) {
  const match = /^\s*(\d{1,4})(?:px)?\s*$/i.exec(String(rawValue || ""));
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isInteger(num) && num >= 16 && num <= 2400 ? num : null;
}

function parseHtmlBlock(rawHtml) {
  const cleaned = stripBlockedTagContent(rawHtml).trim();
  const blocks = [];

  // Extract standalone <img> tags cleanly
  const imgRegex = /<img\b([^>]*)>/gi;
  let imgMatch;
  let foundImg = false;
  while ((imgMatch = imgRegex.exec(cleaned)) !== null) {
    const src = sanitizeUrl(extractHtmlAttribute(imgMatch[1], "src"));
    const alt = extractHtmlAttribute(imgMatch[1], "alt");
    const width = parsePositiveDimension(extractHtmlAttribute(imgMatch[1], "width"));
    const height = parsePositiveDimension(extractHtmlAttribute(imgMatch[1], "height"));
    if (src) {
      const imageBlock = { type: "image", src, alt };
      if (width !== null) imageBlock.width = width;
      if (height !== null) imageBlock.height = height;
      blocks.push(imageBlock);
      foundImg = true;
    }
  }

  const remainingText = cleaned.replace(/<img\b[^>]*>/gi, "").trim();
  const textWithoutWrapper = remainingText
    .replace(/^<(?:p|div)\b[^>]*>/i, "")
    .replace(/<\/(?:p|div)>$/i, "")
    .trim();

  if (textWithoutWrapper) {
    const tokens = parseInlineTokens(textWithoutWrapper);
    if (tokens.length > 0) {
      const hasOnlyLinksAndSeparators =
        tokens.some((t) => t.type === "link") &&
        tokens.every((t) => t.type === "link" || (t.type === "text" && /^[\s·|•\-]+$/.test(t.value)));
      if (hasOnlyLinksAndSeparators && /^<(?:p|div)\b[^>]*align\s*=\s*["']?center["']?/i.test(cleaned)) {
        blocks.push({
          type: "linkBar",
          items: tokens.filter((t) => t.type === "link"),
        });
      } else {
        blocks.push({ type: "paragraph", tokens });
      }
    }
  } else if (!foundImg) {
    // Nothing renderable left
  }

  return blocks;
}

/**
 * Parse a Markdown string (including GitHub release notes HTML fragments like <p align="center">)
 * into render-ready block AST nodes.
 */
export function parseMarkdownBlocks(markdown) {
  if (!markdown || typeof markdown !== "string") return [];
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block
    const fenceMatch = /^```([\w-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "codeblock", lang, code: codeLines.join("\n") });
      continue;
    }

    // 2. Centered/block HTML tags (<p ...>...</p>, <div ...>...</div>)
    if (/^<(?:p|div)\b/i.test(trimmed)) {
      const tagName = /^<(\w+)/i.exec(trimmed)[1].toLowerCase();
      const closeRe = new RegExp(`</${tagName}>`, "i");
      const htmlLines = [line];
      let j = i;
      if (!closeRe.test(line)) {
        j += 1;
        while (j < lines.length) {
          htmlLines.push(lines[j]);
          if (closeRe.test(lines[j])) break;
          j += 1;
        }
      }
      const htmlBlocks = parseHtmlBlock(htmlLines.join("\n"));
      blocks.push(...htmlBlocks);
      i = j + 1;
      continue;
    }

    // 3. Standalone image ![alt](url)
    const standaloneImg = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(trimmed);
    if (standaloneImg) {
      const src = sanitizeUrl(standaloneImg[2]);
      if (src) {
        blocks.push({ type: "image", src, alt: standaloneImg[1].trim() });
      }
      i += 1;
      continue;
    }

    // 4. Headings (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        tokens: parseInlineTokens(headingMatch[2]),
      });
      i += 1;
      continue;
    }

    // 5. GFM Pipe Table
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(lines[i]).map((cell) => parseInlineTokens(cell));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|") && !isHorizontalRule(lines[i])) {
        rows.push(splitTableRow(lines[i]).map((cell) => parseInlineTokens(cell)));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // 6. Horizontal Rule
    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // 7. Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({
        type: "blockquote",
        tokens: parseInlineTokens(quoteLines.join(" ").trim()),
      });
      continue;
    }

    // 8. List (ordered or unordered, including nested items)
    if (matchListItem(line)) {
      const { block, nextIndex } = parseListBlock(lines, i);
      blocks.push(block);
      i = nextIndex;
      continue;
    }

    // 9. Paragraph (stops at blank lines or new block markers)
    const paraLines = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (
        /^```/.test(curTrim) ||
        /^<(?:p|div)\b/i.test(curTrim) ||
        /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.test(curTrim) ||
        /^(#{1,4})\s+/.test(curTrim) ||
        isHorizontalRule(curTrim) ||
        /^>\s?/.test(curTrim) ||
        matchListItem(cur) ||
        (curTrim.includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(curTrim);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: "paragraph",
        tokens: parseInlineTokens(paraLines.join(" ")),
      });
    } else {
      i += 1;
    }
  }

  return blocks;
}
