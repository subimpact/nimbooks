// Focus management for the app's `aria-modal` dialogs.
//
// `aria-modal="true"` tells a screen reader that everything outside the dialog
// is inert — but the reading cursor only moves if focus moves. Without this, a
// dialog opens and the user is left in the background tree, reading a page the
// app has just declared hidden.
//
// One ref callback does both halves. On mount it moves focus into the dialog:
// the close button when there is one, otherwise the dialog itself. On unmount
// React runs the cleanup it returns, which hands focus back to whatever opened
// the dialog. The opener is captured per dialog instance, so stacked overlays
// (the unstake confirmation over the stake panel) unwind in the right order.
//
// Attach with `ref={dialogFocus}` on the element carrying `role="dialog"`, and
// give that element `tabIndex={-1}` so the fallback target can take focus.

export function dialogFocus(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return
  const opener = document.activeElement as HTMLElement | null
  const close = node.querySelector<HTMLElement>('button[aria-label="Close"]:not([disabled])')
  ;(close ?? node).focus()
  return () => {
    // A dialog can outlive its opener — disconnecting tears the whole screen
    // down — so focus only goes back to something still in the document.
    if (opener?.isConnected) opener.focus()
  }
}
