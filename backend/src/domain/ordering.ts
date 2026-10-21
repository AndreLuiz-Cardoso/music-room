// Ordering helpers for the playlist editor. Moves are expressed relative to an anchor
// ("put X right after Y", null = top) instead of an absolute index: two users moving
// different tracks at the same time then both get what they asked for, whatever the
// order in which the server applies the two operations.

export interface Positioned {
  id: string;
}

/** Returns the new order, or null when the anchor is not in the list anymore. */
export function moveAfter<T extends Positioned>(items: T[], id: string, afterId: string | null): T[] | null {
  const moving = items.find((i) => i.id === id);
  if (!moving) return null;
  if (afterId === id) return items.slice();
  const rest = items.filter((i) => i.id !== id);
  if (afterId === null) return [moving, ...rest];
  const anchor = rest.findIndex((i) => i.id === afterId);
  if (anchor === -1) return null;
  return [...rest.slice(0, anchor + 1), moving, ...rest.slice(anchor + 1)];
}

/** Index at which a new item must be inserted, or -1 when the anchor does not exist. */
export function insertionIndex<T extends Positioned>(items: T[], afterId: string | null | undefined): number {
  if (afterId === undefined) return items.length;
  if (afterId === null) return 0;
  const anchor = items.findIndex((i) => i.id === afterId);
  return anchor === -1 ? -1 : anchor + 1;
}
