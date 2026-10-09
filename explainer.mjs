// Keep the prompt builder independent from the optional video dialog.
const trigger = document.getElementById('watch-explainer');
const dialog = document.getElementById('explainer-dialog');
const closeButton = document.getElementById('explainer-close');
const video = document.getElementById('explainer-video');

if (trigger && dialog && closeButton && video
    && typeof dialog.showModal === 'function'
    && typeof dialog.close === 'function'
    && typeof video.pause === 'function') {
  let returnFocus = null;
  let scrollStyles = null;

  function lockScroll() {
    scrollStyles = [document.documentElement, document.body].map((element) => ({
      element,
      value: element.style.getPropertyValue('overflow'),
      priority: element.style.getPropertyPriority('overflow'),
    }));
    for (const { element } of scrollStyles) {
      element.style.setProperty('overflow', 'hidden');
    }
  }

  function restoreScroll() {
    if (!scrollStyles) return;
    for (const { element, value, priority } of scrollStyles) {
      if (value) element.style.setProperty('overflow', value, priority);
      else element.style.removeProperty('overflow');
    }
    scrollStyles = null;
  }

  trigger.addEventListener('click', (event) => {
    // Modified clicks retain the direct video link, including opening a new tab.
    if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (dialog.open) {
      event.preventDefault();
      return;
    }
    const focusedElement = document.activeElement;
    try {
      dialog.showModal();
    } catch {
      // The ordinary link still works if this browser cannot open a modal.
      return;
    }
    event.preventDefault();
    returnFocus = focusedElement;
    lockScroll();
    // This explicit Watch click starts playback; page load never does.
    // Resume when reopening, and replay from the start after a completed take.
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => {
      // Keep native controls available if the browser requires another gesture.
    });
  });

  closeButton.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  });

  // Native Escape handling also fires close; all exit paths stop playback.
  dialog.addEventListener('close', () => {
    video.pause();
    restoreScroll();
    const focusTarget = returnFocus?.isConnected ? returnFocus : trigger;
    returnFocus = null;
    focusTarget.focus({ preventScroll: true });
  });
}
