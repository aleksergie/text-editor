import { Editor } from './editor';
import { getInnermostTextHolder } from './nodes/text-node';
import { $isTextNode } from './nodes/node-utils';
import { NodeKey } from './nodes/node';

function handleCharacterDataMutation(editor: Editor, mutation: MutationRecord, characterDataMutations: Map<NodeKey, string>): void {
  const pair = editor.nearestManagedDomPair(mutation.target);
  if (!pair) {
    return;
  }
  
  const key = pair.key;
  
  editor.read((state) => {
    const node = state.nodes.get(key);
    if (!$isTextNode(node)) {
      return;
    }
    const textHolder = getInnermostTextHolder(pair.dom);
    if (textHolder && textHolder.textContent !== null && textHolder.textContent !== node.text) {
      characterDataMutations.set(key, textHolder.textContent);
    }
  });
}

function handleChildListMutation(editor: Editor, mutation: MutationRecord): { needsFullRerender: boolean } {
  let needsFullRerender = false;
  const pair = editor.nearestManagedDomPair(mutation.target);
  if (!pair) {
    return { needsFullRerender };
  }

  editor.runWithObserverPaused(() => {
    // Revert added nodes that are not managed by the editor
    for (let i = 0; i < mutation.addedNodes.length; i++) {
      const addedNode = mutation.addedNodes[i];
      if (editor.keyForExactDomNode(addedNode) === null) {
        // Not registered and not a managed line break (we don't have managed line breaks yet).
        // Remove it.
        if (addedNode.parentNode) {
          addedNode.parentNode.removeChild(addedNode);
        }
      }
    }
  });

  // Check removed nodes
  for (let i = 0; i < mutation.removedNodes.length; i++) {
    // If it's not a managed line break (we don't have managed line breaks yet)
    // and the target is a managed DOM pair, trigger full re-render.
    needsFullRerender = true;
  }

  return { needsFullRerender };
}

export function flushMutations(editor: Editor, records: MutationRecord[]): void {
  const characterDataMutations = new Map<NodeKey, string>();
  let needsFullRerender = false;

  for (const mutation of records) {
    if (mutation.type === 'characterData') {
      handleCharacterDataMutation(editor, mutation, characterDataMutations);
    } else if (mutation.type === 'childList') {
      const result = handleChildListMutation(editor, mutation);
      if (result.needsFullRerender) {
        needsFullRerender = true;
      }
    }
  }

  // Phase 2: Handle character data updates
  if (characterDataMutations.size > 0) {
    editor.update((state) => {
      for (const [key, newText] of characterDataMutations) {
        state.setTextNodeText(key, newText);
      }
    });
  }

  // Phase 3: Run structural repair if needed
  if (needsFullRerender) {
    editor.reconcileFromScratch();
  }
  
  // Drain any records produced by our own defense writes
  editor.drainObserverRecords();
}
