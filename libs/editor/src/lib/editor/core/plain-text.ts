import { createNodeKey, NodeMap } from './nodes/node';
import {
  $createParagraphNode,
  $createRootNode,
  $createTextNode,
  $isElementNode,
  $isTextNode,
} from './nodes/node-utils';
import { EditorState } from './state';

/**
 * Flatten the editor state to a plain text string with paragraph boundaries
 * joined by `\n`.
 */
export function toPlainText(state: EditorState): string {
  const root = state.nodes.get(state.rootKey);
  if (!$isElementNode(root)) {
    return '';
  }

  const lines: string[] = [];
  let blockKey = root.__first;
  while (blockKey) {
    const block = state.nodes.get(blockKey);
    let lineText = '';

    if ($isElementNode(block)) {
      let textKey = block.__first;
      while (textKey) {
        const textNode = state.nodes.get(textKey);
        if ($isTextNode(textNode)) {
          lineText += textNode.text;
        }
        textKey = textNode?.__next ?? null;
      }
    } else if ($isTextNode(block)) {
      lineText = block.text;
    }

    lines.push(lineText);
    blockKey = block?.__next ?? null;
  }

  return lines.join('\n');
}

/**
 * Build an EditorState from plain text, producing one paragraph per line.
 * An empty input yields the v1 baseline shape (single empty paragraph).
 */
export function fromPlainText(text: string): EditorState {
  const lines = text.split('\n');
  const nodes: NodeMap = new Map();
  const root = $createRootNode('root');
  nodes.set(root.key, root);

  for (const line of lines) {
    const paragraph = $createParagraphNode(createNodeKey());
    const textNode = $createTextNode(createNodeKey(), line);
    nodes.set(paragraph.key, paragraph);
    nodes.set(textNode.key, textNode);
    paragraph.append(nodes, textNode);
    root.append(nodes, paragraph);
  }

  return new EditorState(nodes, root.key);
}
