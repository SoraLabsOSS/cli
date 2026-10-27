import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { isPathInside } from "@/utils/fs.js";

describe("isPathInside", () => {
  it("returns true when child is directly inside root", () => {
    const root = resolve("foo");
    const child = resolve("foo/bar.txt");
    expect(isPathInside(child, root)).toBe(true);
  });

  it("returns true when child is in a nested directory inside root", () => {
    const root = resolve("foo");
    const child = resolve("foo/sub/dir/bar.txt");
    expect(isPathInside(child, root)).toBe(true);
  });

  it("returns true when child is root itself", () => {
    const root = resolve("foo");
    expect(isPathInside(root, root)).toBe(true);
  });

  it("returns false when child is outside root", () => {
    const root = resolve("foo");
    const child = resolve("bar/baz.txt");
    expect(isPathInside(child, root)).toBe(false);
  });

  it("returns false for path traversal escaping root", () => {
    const root = resolve("foo");
    const child = resolve("foo/../bar.txt");
    expect(isPathInside(child, root)).toBe(false);
  });

  it("returns false when child shares name prefix but is not inside directory", () => {
    const root = resolve("foo");
    const child = resolve("foobar/baz.txt");
    expect(isPathInside(child, root)).toBe(false);
  });
});
