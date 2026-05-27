import { DomObserver } from './dom-observer';

function flushMutationObserver(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('DomObserver', () => {
  let root: HTMLElement;
  let callback: jest.Mock<void, [MutationRecord[], () => MutationRecord[]]>;

  beforeEach(() => {
    root = document.createElement('div');
    callback = jest.fn();
  });

  describe('pause / resume reference counting', () => {
    it('nested pause/resume pairs keep the observer disconnected until the outer resume', async () => {
      const observer = new DomObserver(callback);
      observer.start(root);

      observer.pause();
      observer.pause();
      root.appendChild(document.createElement('span'));
      await flushMutationObserver();
      expect(callback).not.toHaveBeenCalled();

      observer.resume();
      root.appendChild(document.createElement('em'));
      await flushMutationObserver();
      expect(callback).not.toHaveBeenCalled();

      observer.resume();
      root.appendChild(document.createElement('strong'));
      await flushMutationObserver();
      expect(callback).toHaveBeenCalled();
    });

    it('resume is a no-op when pause depth is already zero', () => {
      const observer = new DomObserver(callback);
      observer.start(root);
      expect(() => observer.resume()).not.toThrow();
    });
  });

  describe('drain', () => {
    it('discards queued records produced during observer-paused DOM cleanup', async () => {
      const observer = new DomObserver(callback);
      observer.start(root);

      observer.pause();
      root.appendChild(document.createElement('div'));
      observer.drain();
      observer.resume();

      await flushMutationObserver();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('synchronously processes queued mutations through the callback', () => {
      const observer = new DomObserver(callback);
      observer.start(root);
      root.appendChild(document.createElement('em'));

      observer.flush();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].length).toBeGreaterThan(0);
    });

    it('is a no-op when paused', () => {
      const observer = new DomObserver(callback);
      observer.start(root);
      root.appendChild(document.createElement('em'));
      observer.pause();

      observer.flush();

      expect(callback).not.toHaveBeenCalled();
    });

    it('takeRecords argument captures post-callback mutations', async () => {
      const seen: MutationRecord[][] = [];
      const cb = jest.fn((records: MutationRecord[], takeRecords: () => MutationRecord[]) => {
        seen.push(records);
        const more = takeRecords();
        if (more.length > 0) {
          seen.push(more);
        }
      });
      const observer = new DomObserver(cb);
      observer.start(root);

      root.appendChild(document.createElement('div'));
      await flushMutationObserver();

      expect(cb).toHaveBeenCalledTimes(1);
      expect(seen[0].length).toBeGreaterThan(0);
    });
  });

  describe('start / stop', () => {
    it('delivers foreign mutations after start()', async () => {
      const observer = new DomObserver(callback);
      observer.start(root);

      root.appendChild(document.createElement('div'));
      await flushMutationObserver();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].length).toBeGreaterThan(0);
      expect(typeof callback.mock.calls[0][1]).toBe('function');
    });

    it('stops delivering mutations after stop()', async () => {
      const observer = new DomObserver(callback);
      observer.start(root);
      observer.stop();

      root.appendChild(document.createElement('div'));
      await flushMutationObserver();

      expect(callback).not.toHaveBeenCalled();
    });

    it('resets pause depth when start() is called again', async () => {
      const observer = new DomObserver(callback);
      observer.start(root);
      observer.pause();

      const otherRoot = document.createElement('div');
      observer.start(otherRoot);

      otherRoot.appendChild(document.createElement('div'));
      await flushMutationObserver();

      expect(callback).toHaveBeenCalled();
    });
  });
});
