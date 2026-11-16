/**
 * Small DOM helpers shared by the admin page branch-coverage tests.
 */

/**
 * jsdom does not implement HTMLDialogElement.showModal/close. Stub them so the
 * `open` attribute tracks what ActionConfirmDialog asked for, which lets tests
 * assert on whether a confirm dialog is open.
 */
export function installDialogStub(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

/** The (single) confirm dialog rendered inside `root`. */
export function getDialog(root: ParentNode = document): HTMLDialogElement {
  const dialog = root.querySelector('dialog');
  if (!dialog) throw new Error('expected a <dialog> to be rendered');
  return dialog;
}

/** Index into an array, failing loudly instead of returning undefined. */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected an item at index ${String(index)}, found ${String(items.length)} items`);
  }
  return item;
}

/** Closest ancestor matching `selector`, failing loudly when there is none. */
export function closest(el: Element, selector: string): HTMLElement {
  const match = el.closest<HTMLElement>(selector);
  if (!match) throw new Error(`expected an ancestor matching ${selector}`);
  return match;
}
