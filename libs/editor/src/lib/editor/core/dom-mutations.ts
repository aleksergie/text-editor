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

export function flushMutations(editor: Editor, records: MutationRecord[]): void {
  const characterDataMutations = new Map<NodeKey, string>();

  for (const mutation of records) {
    if (mutation.type === 'characterData') {
      handleCharacterDataMutation(editor, mutation, characterDataMutations);
    } else if (mutation.type === 'childList') {
      // TODO: childList mutations for phase 3
    }
  }

  if (characterDataMutations.size > 0) {
    editor.update((state) => {
      for (const [key, newText] of characterDataMutations) {
        state.setTextNodeText(key, newText);
      }
    });
  }
}
