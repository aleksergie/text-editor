import { ElementNode, ParagraphNode, RootNode } from './element-node';
import { NodeBase, NodeKey, NodeMap } from './node';
import { TextNode } from './text-node';

export function $createRootNode(key: NodeKey): RootNode {
  return new RootNode(key);
}

export function $createElementNode(key: NodeKey): ElementNode {
  return new ElementNode(key);
}

export function $createParagraphNode(key: NodeKey): ParagraphNode {
  return new ParagraphNode(key);
}

export function $createTextNode(key: NodeKey, text: string): TextNode {
  return new TextNode(key, text);
}

export function $isRootNode(node: NodeBase | null | undefined): node is RootNode {
  return node instanceof RootNode;
}

export function $isElementNode(node: NodeBase | null | undefined): node is ElementNode {
  return node instanceof ElementNode;
}

export function $isTextNode(node: NodeBase | null | undefined): node is TextNode {
  return node instanceof TextNode;
}

function getParentElement(nodeMap: NodeMap, node: NodeBase): ElementNode | null {
  if (!node.__parent) {
    return null;
  }
  const parent = nodeMap.get(node.__parent);
  return parent instanceof ElementNode ? parent : null;
}

export function insertAfter(nodeMap: NodeMap, target: NodeBase, nodeToInsert: NodeBase) {
  if (target === nodeToInsert) {
    return;
  }

  const parent = getParentElement(nodeMap, target);
  if (!parent) {
    return;
  }

  if (nodeToInsert.__parent) {
    remove(nodeMap, nodeToInsert);
  }

  const nextKey = target.__next;
  const insertKey = nodeToInsert.__key;

  nodeToInsert.__parent = parent.__key;
  nodeToInsert.__prev = target.__key;
  nodeToInsert.__next = nextKey;

  target.__next = insertKey;

  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.__prev = insertKey;
    }
  } else {
    parent.__last = insertKey;
  }

  parent.__size += 1;
}

export function remove(nodeMap: NodeMap, node: NodeBase) {
  const parent = getParentElement(nodeMap, node);
  if (!parent) {
    node.__parent = null;
    node.__prev = null;
    node.__next = null;
    return;
  }

  const prevKey = node.__prev;
  const nextKey = node.__next;

  if (prevKey) {
    const prev = nodeMap.get(prevKey);
    if (prev) {
      prev.__next = nextKey;
    }
  } else {
    parent.__first = nextKey;
  }

  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.__prev = prevKey;
    }
  } else {
    parent.__last = prevKey;
  }

  parent.__size = Math.max(0, parent.__size - 1);

  node.__parent = null;
  node.__prev = null;
  node.__next = null;
}

export function replace(nodeMap: NodeMap, target: NodeBase, replacement: NodeBase) {
  if (target === replacement) {
    return;
  }

  const parent = getParentElement(nodeMap, target);
  if (!parent) {
    return;
  }

  if (replacement.__parent) {
    remove(nodeMap, replacement);
  }

  const prevKey = target.__prev;
  const nextKey = target.__next;
  const replacementKey = replacement.__key;

  if (prevKey) {
    const prev = nodeMap.get(prevKey);
    if (prev) {
      prev.__next = replacementKey;
    }
  } else {
    parent.__first = replacementKey;
  }

  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.__prev = replacementKey;
    }
  } else {
    parent.__last = replacementKey;
  }

  replacement.__parent = parent.__key;
  replacement.__prev = prevKey;
  replacement.__next = nextKey;

  target.__parent = null;
  target.__prev = null;
  target.__next = null;
}
