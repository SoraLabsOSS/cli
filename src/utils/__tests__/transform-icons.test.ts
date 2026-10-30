import { describe, expect, test } from "bun:test";
import {
  detectIconUsage,
  getIconLibraryPackages,
  normalizeIconLibrary,
  transformIcons,
} from "@/utils/transform-icons.js";

describe("normalizeIconLibrary", () => {
  test("normalizes supported names and aliases", () => {
    expect(normalizeIconLibrary("lucide")).toBe("lucide");
    expect(normalizeIconLibrary("LUCIDE")).toBe("lucide");
    expect(normalizeIconLibrary("lucide-react")).toBe("lucide");
    expect(normalizeIconLibrary("radix")).toBe("radix");
    expect(normalizeIconLibrary("radix-ui")).toBe("radix");
    expect(normalizeIconLibrary("tabler")).toBe("tabler");
    expect(normalizeIconLibrary("hugeicons")).toBe("hugeicons");
    expect(normalizeIconLibrary("phosphor")).toBe("phosphor");
    expect(normalizeIconLibrary("remixicon")).toBe("remixicon");
    expect(normalizeIconLibrary("unknown")).toBeNull();
    expect(normalizeIconLibrary(undefined)).toBeNull();
  });
});

describe("getIconLibraryPackages", () => {
  test("returns package names for each library", () => {
    expect(getIconLibraryPackages("lucide")).toEqual(["lucide-react"]);
    expect(getIconLibraryPackages("radix")).toEqual(["@radix-ui/react-icons"]);
    expect(getIconLibraryPackages("tabler")).toEqual(["@tabler/icons-react"]);
    expect(getIconLibraryPackages("hugeicons")).toEqual([
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
    ]);
    expect(getIconLibraryPackages("phosphor")).toEqual([
      "@phosphor-icons/react",
    ]);
    expect(getIconLibraryPackages("remixicon")).toEqual(["@remixicon/react"]);
    expect(getIconLibraryPackages("unknown")).toEqual([]);
  });
});

describe("detectIconUsage", () => {
  test("detects IconPlaceholder or lucide-react", () => {
    expect(
      detectIconUsage([
        {
          files: [
            {
              content: '<IconPlaceholder lucide="Check" />',
              path: "a.tsx",
              type: "registry:ui",
            },
          ],
          name: "comp",
          type: "registry:ui",
        },
      ])
    ).toBe(true);

    expect(
      detectIconUsage([
        {
          files: [
            {
              content: 'import { Check } from "lucide-react";',
              path: "a.tsx",
              type: "registry:ui",
            },
          ],
          name: "comp",
          type: "registry:ui",
        },
      ])
    ).toBe(true);

    expect(
      detectIconUsage([
        {
          files: [
            {
              content: "export const a = 1;",
              path: "a.tsx",
              type: "registry:ui",
            },
          ],
          name: "comp",
          type: "registry:ui",
        },
      ])
    ).toBe(false);
  });
});

describe("transformIcons", () => {
  describe("IconPlaceholder transform", () => {
    const rawPlaceholder = `import * as React from "react";
import { IconPlaceholder } from "@/components/icon-placeholder";

export function Component() {
  return (
    <div>
      <IconPlaceholder
        lucide="CheckIcon"
        tabler="IconCheck"
        radix="CheckIcon"
        hugeicons="Tick02Icon"
        className="size-4"
        aria-label="check"
      />
    </div>
  );
}`;

    test("transforms to lucide by default", () => {
      const transformed = transformIcons(rawPlaceholder, "lucide");
      expect(transformed).toContain(
        'import { CheckIcon } from "lucide-react";'
      );
      expect(transformed).toContain(
        '<CheckIcon className="size-4" aria-label="check" />'
      );
      expect(transformed).not.toContain("IconPlaceholder");
    });

    test("transforms to tabler", () => {
      const transformed = transformIcons(rawPlaceholder, "tabler");
      expect(transformed).toContain(
        'import { IconCheck } from "@tabler/icons-react";'
      );
      expect(transformed).toContain(
        '<IconCheck className="size-4" aria-label="check" />'
      );
      expect(transformed).not.toContain("IconPlaceholder");
    });

    test("transforms to radix", () => {
      const transformed = transformIcons(rawPlaceholder, "radix");
      expect(transformed).toContain(
        'import { CheckIcon } from "@radix-ui/react-icons";'
      );
      expect(transformed).toContain(
        '<CheckIcon className="size-4" aria-label="check" />'
      );
      expect(transformed).not.toContain("IconPlaceholder");
    });

    test("transforms to hugeicons with wrapper", () => {
      const transformed = transformIcons(rawPlaceholder, "hugeicons");
      expect(transformed).toContain(
        'import { HugeiconsIcon } from "@hugeicons/react";'
      );
      expect(transformed).toContain(
        'import { Tick02Icon } from "@hugeicons/core-free-icons";'
      );
      expect(transformed).toContain(
        '<HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4" aria-label="check" />'
      );
      expect(transformed).not.toContain("IconPlaceholder");
    });

    test("transforms to phosphor with strokeWidth", () => {
      const transformed = transformIcons(rawPlaceholder, "phosphor");
      expect(transformed).toContain(
        'import { CheckIcon } from "@phosphor-icons/react";'
      );
      expect(transformed).toContain(
        '<CheckIcon strokeWidth={2} className="size-4" aria-label="check" />'
      );
      expect(transformed).not.toContain("IconPlaceholder");
    });
  });

  describe("direct lucide-react import transform", () => {
    const rawLucide = `import * as React from "react";
import { Check, ChevronRight } from "lucide-react";

export function Component() {
  return (
    <div>
      <Check className="size-4" />
      <ChevronRight className="size-4" />
    </div>
  );
}`;

    test("transforms direct lucide-react imports to tabler", () => {
      const transformed = transformIcons(rawLucide, "tabler");
      expect(transformed).toContain(
        'import { IconCheck, IconChevronRight } from "@tabler/icons-react";'
      );
      expect(transformed).toContain('<IconCheck className="size-4" />');
      expect(transformed).toContain('<IconChevronRight className="size-4" />');
      expect(transformed).not.toContain("lucide-react");
    });

    test("transforms direct lucide-react imports to radix", () => {
      const transformed = transformIcons(rawLucide, "radix");
      expect(transformed).toContain(
        'import { CheckIcon, ChevronRightIcon } from "@radix-ui/react-icons";'
      );
      expect(transformed).toContain('<CheckIcon className="size-4" />');
      expect(transformed).toContain('<ChevronRightIcon className="size-4" />');
      expect(transformed).not.toContain("lucide-react");
    });

    test("leaves lucide imports untouched when target is lucide", () => {
      const transformed = transformIcons(rawLucide, "lucide");
      expect(transformed).toBe(rawLucide);
    });
  });

  test("returns content untouched if no icons are present", () => {
    const noIcons = 'export const greeting = "hello";\n';
    expect(transformIcons(noIcons, "tabler")).toBe(noIcons);
  });
});
