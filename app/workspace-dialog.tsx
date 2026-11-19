"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export function WorkspaceDialog({ open = true, titleId, className, onDismiss, onSaveShortcut, children }: {
  open?: boolean; titleId: string; className: string; onDismiss: () => void; onSaveShortcut?: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-start]")?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected && trigger !== document.body) {
        trigger.focus({ preventScroll: true });
      }
      if (document.activeElement === document.body) document.getElementById("view-title")?.focus({ preventScroll: true });
    };
  }, [open]);

  function handleKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (onSaveShortcut && (event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault(); onSaveShortcut(); return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, summary, [tabindex]",
    )).filter(el => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
  return <dialog ref={ref} className={className} aria-labelledby={titleId} onKeyDown={handleKey}
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onDismiss();
    }}>
    {children}
  </dialog>;
}
