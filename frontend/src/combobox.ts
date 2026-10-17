/**
 * Keyboard model shared by the pickers (airport, airline and phone country),
 * after the WAI-ARIA "combobox with listbox popup" pattern: the text field has
 * role="combobox" and points at the highlighted option with
 * aria-activedescendant; options are tabIndex -1, so Tab leaves the field;
 * the result count and errors live outside the listbox.
 */
export type ComboboxState = {
  /** Options rendered in the listbox. */
  count: number;
  /** Highlighted option, or -1. */
  active: number;
  /** Whether the listbox is showing. */
  open: boolean;
  setActive: (index: number) => void;
  choose: (index: number) => void;
  close: () => void;
  /** Shows the listbox when an arrow key is pressed while it is hidden. */
  reopen?: () => void;
  /**
   * False while the highlight is the automatic one on the first option
   * (airports): Enter chooses it, but Home and End keep moving the caret in
   * the field until an arrow key or the pointer moves through the list.
   */
  browsing?: boolean;
};

type Key = {
  key: string;
  altKey?: boolean;
  preventDefault(): void;
  stopPropagation?(): void;
};

/**
 * Arrows move the highlight (and open the list), Home/End jump to the first or
 * last option while the list is in use, Enter chooses and Escape closes.
 * Returns true when the key was used; each picker handles the rest itself.
 */
export function comboboxKeyDown(event: Key, state: ComboboxState): boolean {
  const { count, active, open } = state;
  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp": {
      event.preventDefault();
      if (!open) {
        state.reopen?.();
        // Alt+Down only opens the list, as in native selects.
        if (event.altKey) return true;
      }
      if (!count) return true;
      const forward = event.key === "ArrowDown";
      state.setActive(
        active < 0
          ? forward
            ? 0
            : count - 1
          : Math.max(0, Math.min(count - 1, active + (forward ? 1 : -1))),
      );
      return true;
    }
    case "Home":
    case "End":
      // Outside the list the keys keep moving the caret in the field.
      if (!open || !count || active < 0 || state.browsing === false) return false;
      event.preventDefault();
      state.setActive(event.key === "Home" ? 0 : count - 1);
      return true;
    case "Enter":
      if (!open || active < 0 || active >= count) return false;
      event.preventDefault();
      state.choose(active);
      return true;
    case "Escape":
      if (!open) return false;
      event.preventDefault();
      event.stopPropagation?.();
      state.close();
      return true;
  }
  return false;
}

/** Keeps the highlighted option visible inside its scrolling listbox. */
export function revealActive(list: HTMLElement | null) {
  list
    ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    ?.scrollIntoView({ block: "nearest" });
}
