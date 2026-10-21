const FENCE_PATTERN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING_PATTERN = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const BLOCKQUOTE_PATTERN = /^\s*>\s?(.*)$/;
const UNORDERED_ITEM_PATTERN = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^(\s*)\d+[.)]\s+(.*)$/;
const RULE_PATTERN = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const INLINE_PATTERN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;

/**
 * Match a Markdown list item.
 * @param {string} line Source line.
 * @returns {object|null} List item details.
 */
const matchListItem = (line) => {
  const unordered = UNORDERED_ITEM_PATTERN.exec(line);
  if (unordered) {
    return {
      indent: unordered[1].length,
      ordered: false,
      text: unordered[2]
    };
  }
  const ordered = ORDERED_ITEM_PATTERN.exec(line);
  if (ordered) {
    return {
      indent: ordered[1].length,
      ordered: true,
      text: ordered[2]
    };
  }
  return null;
};

/**
 * Whether a line starts a non-paragraph block.
 * @param {string} line Source line.
 * @returns {boolean} Whether the line starts a block.
 */
const startsBlock = (line) =>
  FENCE_PATTERN.test(line) ||
  HEADING_PATTERN.test(line) ||
  BLOCKQUOTE_PATTERN.test(line) ||
  RULE_PATTERN.test(line) ||
  Boolean(matchListItem(line));

/**
 * Resolve a safe link target.
 * @param {string} raw Raw URL.
 * @returns {string|null} Safe URL, or null.
 */
const safeHref = (raw) => {
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
  } catch (error) {
    // Invalid URLs are rendered as plain text.
  }
  return null;
};

/**
 * Append inline Markdown to a container without interpreting HTML.
 * @param {string} text Inline source.
 * @param {HTMLElement} container Destination element.
 */
const appendInline = (text, container) => {
  const source = String(text || '');
  const pattern = new RegExp(INLINE_PATTERN.source, 'g');
  let lastIndex = 0;
  let match = pattern.exec(source);

  while (match) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
    }

    const token = match[1];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      container.appendChild(code);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong');
      appendInline(token.slice(2, -2), strong);
      container.appendChild(strong);
    } else if (token.startsWith('~~')) {
      const deleted = document.createElement('del');
      appendInline(token.slice(2, -2), deleted);
      container.appendChild(deleted);
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = linkMatch ? safeHref(linkMatch[2]) : null;
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        appendInline(linkMatch[1], link);
        container.appendChild(link);
      } else {
        container.appendChild(document.createTextNode(token));
      }
    } else {
      const emphasis = document.createElement('em');
      appendInline(token.slice(1, -1), emphasis);
      container.appendChild(emphasis);
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(source);
  }

  if (lastIndex < source.length) {
    container.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
};

/**
 * Append a fenced code block.
 * @param {Array<string>} lines Source lines.
 * @param {number} start Fence start index.
 * @param {HTMLElement} container Destination element.
 * @returns {number} Next line index.
 */
const appendCodeBlock = (lines, start, container) => {
  const opening = FENCE_PATTERN.exec(lines[start]);
  const marker = opening[1];
  const markerCharacter = marker.charAt(0);
  const closingPattern = new RegExp(`^\\s*\\${markerCharacter}{${marker.length},}\\s*$`);
  const language = String(opening[2] || '').replace(/[^\w-]/g, '');
  const codeLines = [];
  let index = start + 1;

  while (index < lines.length && !closingPattern.test(lines[index])) {
    codeLines.push(lines[index]);
    index++;
  }
  if (index < lines.length) index++;

  const pre = document.createElement('pre');
  pre.className = 'sa-agent-code';
  const code = document.createElement('code');
  if (language) code.className = `language-${language}`;
  code.textContent = codeLines.join('\n');
  pre.appendChild(code);
  container.appendChild(pre);
  return index;
};

/**
 * Append a Markdown list.
 * @param {Array<string>} lines Source lines.
 * @param {number} start List start index.
 * @param {HTMLElement} container Destination element.
 * @returns {number} Next line index.
 */
const appendList = (lines, start, container) => {
  const first = matchListItem(lines[start]);
  const ordered = first.ordered;
  const indent = first.indent;
  const list = document.createElement(ordered ? 'ol' : 'ul');
  list.className = 'sa-agent-md-list';
  let index = start;

  while (index < lines.length) {
    const item = matchListItem(lines[index]);
    if (!item || item.ordered !== ordered || item.indent !== indent) break;

    const listItem = document.createElement('li');
    let itemText = item.text;
    index++;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) break;
      const nextItem = matchListItem(line);
      if (nextItem) {
        if (nextItem.indent > indent) break;
        break;
      }
      if (startsBlock(line)) break;
      itemText += ` ${line.trim()}`;
      index++;
    }

    appendInline(itemText, listItem);

    while (index < lines.length) {
      const nested = matchListItem(lines[index]);
      if (!nested || nested.indent <= indent) break;
      index = appendList(lines, index, listItem);
    }

    list.appendChild(listItem);
  }

  container.appendChild(list);
  return index;
};

/**
 * Append a paragraph.
 * @param {Array<string>} lines Paragraph source lines.
 * @param {HTMLElement} container Destination element.
 */
const appendParagraph = (lines, container) => {
  const paragraph = document.createElement('p');
  lines.forEach((line, index) => {
    if (index > 0) paragraph.appendChild(document.createElement('br'));
    appendInline(line.trim(), paragraph);
  });
  container.appendChild(paragraph);
};

/**
 * Render Markdown blocks into a container.
 * @param {Array<string>} lines Source lines.
 * @param {HTMLElement} container Destination element.
 */
const appendBlocks = (lines, container) => {
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      index = appendCodeBlock(lines, index, container);
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const headingElement = document.createElement(`h${level}`);
      appendInline(heading[2], headingElement);
      container.appendChild(headingElement);
      index++;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      const rule = document.createElement('hr');
      rule.className = 'sa-agent-md-rule';
      container.appendChild(rule);
      index++;
      continue;
    }

    const quote = BLOCKQUOTE_PATTERN.exec(line);
    if (quote) {
      const quoteLines = [];
      while (index < lines.length) {
        const quoted = BLOCKQUOTE_PATTERN.exec(lines[index]);
        if (!quoted) break;
        quoteLines.push(quoted[1]);
        index++;
      }
      const blockquote = document.createElement('blockquote');
      appendBlocks(quoteLines, blockquote);
      container.appendChild(blockquote);
      continue;
    }

    if (matchListItem(line)) {
      index = appendList(lines, index, container);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      paragraphLines.push(lines[index]);
      index++;
    }
    if (paragraphLines.length === 0) {
      // Defensive fallback: always make progress on malformed input.
      paragraphLines.push(lines[index] || '');
      index++;
    }
    appendParagraph(paragraphLines, container);
  }
};

/**
 * Render Markdown safely into DOM nodes. Raw HTML is treated as text.
 * @param {string} text Markdown source.
 * @returns {HTMLElement} Rendered content wrapper.
 */
export const renderMarkdown = (text) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'sa-agent-md';
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  appendBlocks(lines, wrapper);
  return wrapper;
};
