import { resolve, sep } from "node:path";

/** Returns true when child is inside root (or is root). Path-traversal guard. */
export const isPathInside = (child: string, root: string): boolean =>
  resolve(child) === resolve(root) ||
  resolve(child).startsWith(resolve(root) + sep);
