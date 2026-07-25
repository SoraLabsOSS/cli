import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import type { ComponentAliases, ProjectConfig, RegistryItem } from "@/types.js";
import {
  assertSafeDependencies,
  assertSafeDestination,
  normalizeLineEndings,
  resolveTarget,
  rewriteAliases,
} from "@/utils/install.js";

const OUTSIDE_PROJECT = /outside the project/;
const UNSAFE_DEP = /unsafe dependency/;
const INVALID_DEP = /invalid dependency/;

const ALIASES: ComponentAliases = {
  components: "~/components",
  hooks: "~/hooks",
  lib: "~/lib",
  utils: "~/lib/utils",
};

describe("rewriteAliases", () => {
  test("rewrites @/lib/utils import", () => {
    const input = 'import { cn } from "@/lib/utils";';
    expect(rewriteAliases(input, ALIASES)).toBe(
      'import { cn } from "~/lib/utils";'
    );
  });

  test("rewrites @/hooks/ imports", () => {
    const input = 'import { useFoo } from "@/hooks/use-foo";';
    expect(rewriteAliases(input, ALIASES)).toBe(
      'import { useFoo } from "~/hooks/use-foo";'
    );
  });

  test("rewrites @/components/ imports", () => {
    const input = 'import { Button } from "@/components/button";';
    expect(rewriteAliases(input, ALIASES)).toBe(
      'import { Button } from "~/components/button";'
    );
  });

  test("rewrites @/lib/ imports", () => {
    const input = 'import { helper } from "@/lib/helper";';
    expect(rewriteAliases(input, ALIASES)).toBe(
      'import { helper } from "~/lib/helper";'
    );
  });

  test("rewrites multiple imports in one file", () => {
    const input = [
      'import { cn } from "@/lib/utils";',
      'import { useFoo } from "@/hooks/use-foo";',
      'import { Button } from "@/components/button";',
    ].join("\n");
    const expected = [
      'import { cn } from "~/lib/utils";',
      'import { useFoo } from "~/hooks/use-foo";',
      'import { Button } from "~/components/button";',
    ].join("\n");
    expect(rewriteAliases(input, ALIASES)).toBe(expected);
  });

  test("handles single-quoted imports", () => {
    const input = "import { cn } from '@/lib/utils';";
    expect(rewriteAliases(input, ALIASES)).toBe(
      "import { cn } from '~/lib/utils';"
    );
  });

  test("leaves unrelated imports untouched", () => {
    const input = 'import React from "react";';
    expect(rewriteAliases(input, ALIASES)).toBe(input);
  });

  test("does not rewrite @/lib/utils as @/lib/ + utils", () => {
    const input = 'import { cn } from "@/lib/utils";';
    const result = rewriteAliases(input, ALIASES);
    expect(result).toBe('import { cn } from "~/lib/utils";');
    expect(result).not.toContain("~/lib//utils");
  });

  test("rewrites all occurrences of the same pattern", () => {
    const input = [
      'import { cn } from "@/lib/utils";',
      'import { cn2 } from "@/lib/utils";',
    ].join("\n");
    const result = rewriteAliases(input, ALIASES);
    expect(result).toBe(
      [
        'import { cn } from "~/lib/utils";',
        'import { cn2 } from "~/lib/utils";',
      ].join("\n")
    );
  });

  test("does not over-match @/lib/utils-extra as utils", () => {
    const input = 'import { x } from "@/lib/utils-extra";';
    const result = rewriteAliases(input, ALIASES);
    expect(result).toBe('import { x } from "~/lib/utils-extra";');
  });
});

describe("normalizeLineEndings", () => {
  test("converts CRLF to LF", () => {
    expect(normalizeLineEndings("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  test("leaves LF-only content unchanged", () => {
    expect(normalizeLineEndings("a\nb\nc")).toBe("a\nb\nc");
  });

  test("handles empty string", () => {
    expect(normalizeLineEndings("")).toBe("");
  });

  test("handles content with no line endings", () => {
    expect(normalizeLineEndings("hello")).toBe("hello");
  });

  test("handles mixed CRLF and LF in the same string", () => {
    expect(normalizeLineEndings("a\r\nb\nc\r\nd")).toBe("a\nb\nc\nd");
  });

  test("leaves standalone CR unchanged (only targets CRLF)", () => {
    expect(normalizeLineEndings("a\rb")).toBe("a\rb");
  });
});

describe("assertSafeDestination", () => {
  const cwd = resolve("/project");

  test("allows path inside project", () => {
    expect(() =>
      assertSafeDestination(join(cwd, "src/components/button.tsx"), cwd)
    ).not.toThrow();
  });

  test("allows the project root itself", () => {
    expect(() => assertSafeDestination(cwd, cwd)).not.toThrow();
  });

  test("rejects path traversal outside project", () => {
    expect(() =>
      assertSafeDestination(resolve("/project/../.bashrc"), cwd)
    ).toThrow(OUTSIDE_PROJECT);
  });

  test("rejects absolute path outside project", () => {
    expect(() => assertSafeDestination(resolve("/etc/passwd"), cwd)).toThrow(
      OUTSIDE_PROJECT
    );
  });

  test("rejects sibling directory with similar prefix", () => {
    expect(() =>
      assertSafeDestination(resolve("/project-evil/file.ts"), cwd)
    ).toThrow(OUTSIDE_PROJECT);
  });
});

describe("assertSafeDependencies", () => {
  test("accepts valid package names", () => {
    expect(() =>
      assertSafeDependencies([
        "react",
        "tailwind-merge",
        "@radix-ui/react-slot",
      ])
    ).not.toThrow();
  });

  test("accepts scoped packages", () => {
    expect(() => assertSafeDependencies(["@scope/package-name"])).not.toThrow();
  });

  test("rejects names starting with dash", () => {
    expect(() => assertSafeDependencies(["--registry=evil"])).toThrow(
      UNSAFE_DEP
    );
  });

  test("rejects empty string", () => {
    expect(() => assertSafeDependencies([""])).toThrow(INVALID_DEP);
  });

  test("rejects names with spaces", () => {
    expect(() => assertSafeDependencies(["bad package"])).toThrow(INVALID_DEP);
  });

  test("rejects names with special characters", () => {
    expect(() => assertSafeDependencies(["pkg;rm -rf /"])).toThrow(INVALID_DEP);
  });

  test("rejects names longer than 214 chars", () => {
    expect(() => assertSafeDependencies(["a".repeat(215)])).toThrow(
      INVALID_DEP
    );
  });

  test("accepts names exactly 214 chars", () => {
    expect(() => assertSafeDependencies(["a".repeat(214)])).not.toThrow();
  });

  test("rejects unicode in names", () => {
    expect(() => assertSafeDependencies(["pkg\u00e9"])).toThrow(INVALID_DEP);
  });

  test("throws on invalid dep at second position", () => {
    expect(() => assertSafeDependencies(["react", "bad pkg"])).toThrow(
      INVALID_DEP
    );
  });
});

describe("resolveTarget", () => {
  const config: ProjectConfig = {
    aliasConfigured: true,
    aliases: ALIASES,
    componentPath: "src/components/sora-ui",
    cwd: resolve("/project"),
    packageManager: "bun",
    srcDir: "src",
    tsconfigPathsConfigured: true,
  };

  const makeItem = (name: string): RegistryItem => ({
    files: [],
    name,
    type: "registry:ui",
  });

  test("uses componentPath + item name when no target", () => {
    const file = { path: "button.tsx", type: "registry:ui" };
    expect(resolveTarget(file, makeItem("button"), config)).toBe(
      "src/components/sora-ui/button.tsx"
    );
  });

  test("strips components/<product>/ prefix from target", () => {
    const file = {
      path: "button.tsx",
      target: "components/sora-ui/texts/foo.tsx",
      type: "registry:ui",
    };
    expect(resolveTarget(file, makeItem("foo"), config)).toBe(
      "src/components/sora-ui/texts/foo.tsx"
    );
  });

  test("prepends srcDir for non-component targets", () => {
    const file = {
      path: "use-foo.ts",
      target: "hooks/use-foo.ts",
      type: "registry:hook",
    };
    expect(resolveTarget(file, makeItem("use-foo"), config)).toBe(
      "src/hooks/use-foo.ts"
    );
  });

  test("returns target as-is when no srcDir configured", () => {
    const noSrcConfig = { ...config, srcDir: "" };
    const file = {
      path: "use-foo.ts",
      target: "hooks/use-foo.ts",
      type: "registry:hook",
    };
    expect(resolveTarget(file, makeItem("use-foo"), noSrcConfig)).toBe(
      "hooks/use-foo.ts"
    );
  });

  test("strips any product name in components/ prefix, not just sora-ui", () => {
    const file = {
      path: "widget.tsx",
      target: "components/other-product/widget.tsx",
      type: "registry:ui",
    };
    expect(resolveTarget(file, makeItem("widget"), config)).toBe(
      "src/components/sora-ui/widget.tsx"
    );
  });

  test("handles deeply nested target after prefix", () => {
    const file = {
      path: "deep.tsx",
      target: "components/sora-ui/a/b/c/deep.tsx",
      type: "registry:ui",
    };
    expect(resolveTarget(file, makeItem("deep"), config)).toBe(
      "src/components/sora-ui/a/b/c/deep.tsx"
    );
  });
});
