/**
 * Copies text to the clipboard. Over http:// on a local network the page is not
 * a secure context and navigator.clipboard does not exist: a selected, read-only
 * textarea and execCommand("copy") do it instead. Rejects when neither works;
 * the focus and the page selection come back as they were.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Denied or unavailable (an older Safari outside a click): try the fallback.
    }
  }
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
  const area = document.createElement("textarea");
  area.value = text;
  // Read-only keeps the iOS keyboard closed; off screen, it never shows.
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.append(area);
  let copied = false;
  try {
    area.select();
    // iOS selects only through a range.
    area.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    area.remove();
    if (focused && focused !== document.body) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
  if (!copied) throw Error("copy unavailable");
}
