'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { recordClientAction } from '@/lib/client-action-log';

function labelFor(el: Element): string {
  const workflow = el.getAttribute('data-workflow');
  if (workflow && workflow.trim() !== '') return workflow.trim();
  const id = el.getAttribute('id') ?? el.getAttribute('data-testid') ?? '';
  if (id.trim() !== '') return id.trim();
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim() !== '') return aria.trim();
  const href = el.getAttribute('href');
  if (href && href.trim() !== '') return href.trim();
  const name = el.getAttribute('name');
  if (name && name.trim() !== '') return name.trim();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text !== '') return text;
  return el.tagName.toLowerCase();
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

/**
 * Document-level capture so every page's buttons, links, and forms land in
 * the request log without wrapping each control. Does not record typed values.
 */
export function ActionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    recordClientAction({
      kind: 'screen',
      method: 'SCREEN',
      path: pathname || '/',
      status: 1,
      durationMs: 0,
      requestId: '',
    });
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (isTypingTarget(target)) return;
      const el = target.closest(
        'button, a, [role="button"], input[type="submit"], input[type="button"], [data-workflow]',
      );
      if (!el) return;
      recordClientAction({
        kind: 'ui',
        method: 'TAP',
        path: labelFor(el),
        status: 1,
        durationMs: 0,
        requestId: '',
      });
    };

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const name =
        form.getAttribute('data-workflow') ??
        form.getAttribute('aria-label') ??
        form.getAttribute('name') ??
        form.id ??
        form.action ??
        'form';
      recordClientAction({
        kind: 'ui',
        method: 'SUBMIT',
        path: name,
        status: 1,
        durationMs: 0,
        requestId: '',
      });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  return null;
}
