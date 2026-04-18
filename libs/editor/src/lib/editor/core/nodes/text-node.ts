import { NodeBase } from './node';
import { SerializedTextNode } from '../snapshot';
import {
  FORMAT_RENDER_ORDER,
  TextFormat,
  TextFormatBits,
  TextFormatFlag,
  hasFormat,
} from '../text-format';

/**
 * Private symbol used to cache the last-rendered format bits on an element
 * host so `updateDOM` can detect format changes without parsing the DOM
 * subtree. The symbol is module-private so consumers cannot mutate it.
 */
const LAST_FORMAT = Symbol('TextNode.lastFormat');

interface FormattedHost extends HTMLElement {
  [LAST_FORMAT]?: TextFormatBits;
}

function formatFlagToTagName(flag: TextFormatFlag): string {
  switch (flag) {
    case TextFormat.BOLD:
      return 'strong';
    case TextFormat.ITALIC:
      return 'em';
    case TextFormat.UNDERLINE:
      return 'u';
    case TextFormat.STRIKETHROUGH:
      return 's';
    case TextFormat.CODE:
      return 'code';
    default:
      return 'span';
  }
}

/**
 * Build the nested tag stack for a given format bitfield and set the text on
 * the innermost tag. The outermost element is `host`; callers own its
 * identity so the reconciler can keep its DOM<->Key mapping stable across
 * format changes.
 */
function renderFormattedContent(
  host: HTMLElement,
  text: string,
  format: TextFormatBits,
): void {
  host.textContent = '';

  let cursor: HTMLElement = host;
  for (const flag of FORMAT_RENDER_ORDER) {
    if (hasFormat(format, flag)) {
      const wrapper = document.createElement(formatFlagToTagName(flag));
      cursor.appendChild(wrapper);
      cursor = wrapper;
    }
  }

  cursor.appendChild(document.createTextNode(text));
}

export class TextNode extends NodeBase {
  format: TextFormatBits;

  constructor(key: string, public text: string, format: TextFormatBits = TextFormat.NONE) {
    super(key);
    this.format = format;
  }

  static override getType(): string {
    return 'text';
  }

  static override readonly version: number = 2;

  getFormat(): TextFormatBits {
    return this.format;
  }

  /**
   * Replace the format bitfield. Does not mutate the node map; callers
   * inside `editor.update` are expected to mark the node dirty themselves
   * via `state.markDirty(key)` or via structural helpers.
   */
  setFormat(format: TextFormatBits): void {
    this.format = format;
  }

  override createDOM(): HTMLElement {
    const span = document.createElement('span') as FormattedHost;
    renderFormattedContent(span, this.text, this.format);
    span[LAST_FORMAT] = this.format;
    return span;
  }

  override updateDOM(dom: HTMLElement): boolean {
    const host = dom as FormattedHost;
    const prevFormat = host[LAST_FORMAT] ?? TextFormat.NONE;

    if (prevFormat !== this.format) {
      renderFormattedContent(host, this.text, this.format);
      host[LAST_FORMAT] = this.format;
      return true;
    }

    // Same format: only the innermost text may have changed. Walk into the
    // tag stack to find the text node we wrote during the last render and
    // flip its content. This preserves the exact DOM element identities so
    // any caret the browser is tracking keeps its reference.
    const textHolder = getInnermostTextHolder(host);
    if (textHolder && textHolder.textContent !== this.text) {
      textHolder.textContent = this.text;
      return true;
    }
    return false;
  }

  exportJSON(): SerializedTextNode {
    return {
      type: 'text',
      version: TextNode.version,
      key: this.__key,
      parent: this.__parent,
      prev: this.__prev,
      next: this.__next,
      text: this.text,
      format: this.format,
    };
  }

  static importJSON(data: SerializedTextNode): TextNode {
    const node = new TextNode(data.key, data.text, data.format ?? TextFormat.NONE);
    node.__parent = data.parent;
    node.__prev = data.prev;
    node.__next = data.next;
    return node;
  }
}

/**
 * Walk from a TextNode's outer host down the format tag stack to the single
 * child HTML text node holding the user text. Returns `null` if the structure
 * is unexpected (which would force a full re-render via updateDOM path).
 */
function getInnermostTextHolder(host: HTMLElement): Node | null {
  let cursor: Node = host;
  while (cursor.firstChild) {
    const child: Node = cursor.firstChild;
    if (child.nodeType === Node.TEXT_NODE) {
      return child;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    cursor = child;
  }
  // host has no children yet - treat as needing a write.
  return host;
}
