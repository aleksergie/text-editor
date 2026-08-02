import { ElementNode, ParagraphNode, RootNode } from './element-node';
import { NodeBase, NodeKey, NodeMap } from './node';
import { TextNode } from './text-node';
import { LineBreakNode } from './line-break-node';
import { TabNode } from './tab-node';

export function $createRootNode(key: NodeKey): RootNode {
  return new RootNode(key);
}

export function $createElementNode(key: NodeKey): ElementNode {
  return new ElementNode(key);
}

export function $createParagraphNode(key: NodeKey): ParagraphNode {
  return new ParagraphNode(key);
}

export function $createTextNode(
  key: NodeKey,
  text: string,
  format = 0,
): TextNode {
  return new TextNode(key, text, format);
}

export function $createLineBreakNode(key: NodeKey): LineBreakNode {
  return new LineBreakNode(key);
}

export function $createTabNode(key: NodeKey): TabNode {
  return new TabNode(key);
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

export function $isLineBreakNode(node: NodeBase | null | undefined): node is LineBreakNode {
  return node instanceof LineBreakNode;
}

export function $isTabNode(node: NodeBase | null | undefined): node is TabNode {
  return node instanceof TabNode;
}

function getParentElement(nodeMap: NodeMap, node: NodeBase): ElementNode | null {
  const latestNode = nodeMap.get(node.key) || node;
  if (!latestNode.__parent) {
    return null;
  }
  const parent = nodeMap.get(latestNode.__parent);
  return parent instanceof ElementNode ? parent : null;
}

export function insertAfter(nodeMap: NodeMap, target: NodeBase, nodeToInsert: NodeBase) {
  if (target === nodeToInsert) {
    return;
  }

  const latestTarget = nodeMap.get(target.key) || target;
  const latestNodeToInsert = nodeMap.get(nodeToInsert.key) || nodeToInsert;

  const parent = getParentElement(nodeMap, latestTarget);
  if (!parent) {
    return;
  }

  if (latestNodeToInsert.__parent) {
    remove(nodeMap, latestNodeToInsert);
  }

  const nextKey = latestTarget.__next;
  const insertKey = latestNodeToInsert.__key;

  const writableNodeToInsert = latestNodeToInsert.getWritable();
  writableNodeToInsert.__parent = parent.__key;
  writableNodeToInsert.__prev = latestTarget.__key;
  writableNodeToInsert.__next = nextKey;

  latestTarget.getWritable().__next = insertKey;

  const writableParent = parent.getWritable();
  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.getWritable().__prev = insertKey;
    }
  } else {
    writableParent.__last = insertKey;
  }

  writableParent.__size += 1;
}

export function insertBefore(nodeMap: NodeMap, target: NodeBase, nodeToInsert: NodeBase) {
  if (target === nodeToInsert) {
    return;
  }

  const latestTarget = nodeMap.get(target.key) || target;
  const latestNodeToInsert = nodeMap.get(nodeToInsert.key) || nodeToInsert;

  const parent = getParentElement(nodeMap, latestTarget);
  if (!parent) {
    return;
  }

  if (latestNodeToInsert.__parent) {
    remove(nodeMap, latestNodeToInsert);
  }

  const prevKey = latestTarget.__prev;
  const insertKey = latestNodeToInsert.__key;

  const writableNodeToInsert = latestNodeToInsert.getWritable();
  writableNodeToInsert.__parent = parent.__key;
  writableNodeToInsert.__prev = prevKey;
  writableNodeToInsert.__next = latestTarget.__key;

  latestTarget.getWritable().__prev = insertKey;

  const writableParent = parent.getWritable();
  if (prevKey) {
    const prev = nodeMap.get(prevKey);
    if (prev) {
      prev.getWritable().__next = insertKey;
    }
  } else {
    writableParent.__first = insertKey;
  }

  writableParent.__size += 1;
}

export function remove(nodeMap: NodeMap, node: NodeBase) {
  const latestNode = nodeMap.get(node.key) || node;
  const writableNode = latestNode.getWritable();
  const parent = getParentElement(nodeMap, latestNode);
  if (!parent) {
    writableNode.__parent = null;
    writableNode.__prev = null;
    writableNode.__next = null;
    return;
  }

  const prevKey = latestNode.__prev;
  const nextKey = latestNode.__next;
  const writableParent = parent.getWritable();

  if (prevKey) {
    const prev = nodeMap.get(prevKey);
    if (prev) {
      prev.getWritable().__next = nextKey;
    }
  } else {
    writableParent.__first = nextKey;
  }

  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.getWritable().__prev = prevKey;
    }
  } else {
    writableParent.__last = prevKey;
  }

  writableParent.__size = Math.max(0, parent.__size - 1);

  writableNode.__parent = null;
  writableNode.__prev = null;
  writableNode.__next = null;
}

export function replace(nodeMap: NodeMap, target: NodeBase, replacement: NodeBase) {
  if (target === replacement) {
    return;
  }

  const latestTarget = nodeMap.get(target.key) || target;
  const latestReplacement = nodeMap.get(replacement.key) || replacement;

  const parent = getParentElement(nodeMap, latestTarget);
  if (!parent) {
    return;
  }

  if (latestReplacement.__parent) {
    remove(nodeMap, latestReplacement);
  }

  const prevKey = latestTarget.__prev;
  const nextKey = latestTarget.__next;
  const replacementKey = latestReplacement.__key;
  
  const writableParent = parent.getWritable();

  if (prevKey) {
    const prev = nodeMap.get(prevKey);
    if (prev) {
      prev.getWritable().__next = replacementKey;
    }
  } else {
    writableParent.__first = replacementKey;
  }

  if (nextKey) {
    const next = nodeMap.get(nextKey);
    if (next) {
      next.getWritable().__prev = replacementKey;
    }
  } else {
    writableParent.__last = replacementKey;
  }

  const writableReplacement = latestReplacement.getWritable();
  writableReplacement.__parent = parent.__key;
  writableReplacement.__prev = prevKey;
  writableReplacement.__next = nextKey;

  const writableTarget = latestTarget.getWritable();
  writableTarget.__parent = null;
  writableTarget.__prev = null;
  writableTarget.__next = null;
}
