import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem } from "@/types.js";
import {
  collectCssPayload,
  detectTailwindVersion,
  findGlobalCssFile,
  hasCssPayload,
  shouldOverwriteCssVars,
  transformCss,
  transformCssVars,
  updateGlobalCss,
} from "@/utils/update-css.js";

const V4_CSS = `@import "tailwindcss";\n`;
const V3_CSS = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-css-test-"));
});

afterEach(() => {
  const { rmSync } = require("node:fs");
  rmSync(tempDir, { force: true, recursive: true });
});

function makeItem(overrides: Partial<RegistryItem>): RegistryItem {
  return { files: [], name: "test", type: "registry:ui", ...overrides };
}

describe("collectCssPayload", () => {
  test("merges cssVars across items with later items winning", () => {
    const payload = collectCssPayload([
      makeItem({ cssVars: { light: { accent: "red", primary: "blue" } } }),
      makeItem({
        cssVars: { dark: { primary: "black" }, light: { primary: "green" } },
      }),
    ]);
    expect(payload.cssVars.light).toEqual({ accent: "red", primary: "green" });
    expect(payload.cssVars.dark).toEqual({ primary: "black" });
  });

  test("deep-merges css blocks", () => {
    const payload = collectCssPayload([
      makeItem({ css: { "@layer base": { body: { margin: "0" } } } }),
      makeItem({ css: { "@layer base": { h1: { color: "red" } } } }),
    ]);
    expect(payload.css["@layer base"]).toEqual({
      body: { margin: "0" },
      h1: { color: "red" },
    });
  });

  test("hasCssPayload is false for items without css fields", () => {
    expect(hasCssPayload(collectCssPayload([makeItem({})]))).toBe(false);
  });
});

describe("shouldOverwriteCssVars", () => {
  test("true for theme/style items, false for ui items", () => {
    expect(shouldOverwriteCssVars([makeItem({ type: "registry:theme" })])).toBe(
      true
    );
    expect(shouldOverwriteCssVars([makeItem({ type: "registry:ui" })])).toBe(
      false
    );
  });
});

describe("transformCssVars (v4)", () => {
  test("writes vars to :root/.dark and maps them in @theme inline", async () => {
    const output = await transformCssVars(
      V4_CSS,
      {
        dark: { brand: "oklch(0.2 0 0)" },
        light: { brand: "oklch(0.9 0 0)" },
      },
      { tailwindVersion: "v4" }
    );

    expect(output).toContain("@custom-variant dark (&:is(.dark *));");
    expect(output).toContain(":root {");
    expect(output).toContain("--brand: oklch(0.9 0 0)");
    expect(output).toContain(".dark {");
    expect(output).toContain("--brand: oklch(0.2 0 0)");
    expect(output).toContain("@theme inline {");
    expect(output).toContain("--color-brand: var(--brand)");
  });

  test("wraps bare HSL triples and expands radius scale", async () => {
    const output = await transformCssVars(
      V4_CSS,
      { light: { muted: "210 40% 96%", radius: "0.5rem" } },
      { tailwindVersion: "v4" }
    );
    expect(output).toContain("--muted: hsl(210 40% 96%)");
    expect(output).toContain("--radius-sm: calc(var(--radius) * 0.6)");
    expect(output).toContain("--radius-lg: var(--radius)");
  });

  test("does not overwrite existing user values by default", async () => {
    const input = `${V4_CSS}\n:root {\n  --brand: purple;\n}\n`;
    const output = await transformCssVars(
      input,
      { light: { brand: "red" } },
      { tailwindVersion: "v4" }
    );
    expect(output).toContain("--brand: purple");
    expect(output).not.toContain("--brand: red");
  });

  test("overwrites when overwriteCssVars is true", async () => {
    const input = `${V4_CSS}\n:root {\n  --brand: purple;\n}\n`;
    const output = await transformCssVars(
      input,
      { light: { brand: "red" } },
      { overwriteCssVars: true, tailwindVersion: "v4" }
    );
    expect(output).toContain("--brand: red");
    expect(output).not.toContain("--brand: purple");
  });

  test("is idempotent across repeated runs", async () => {
    const vars = { light: { brand: "red" } };
    const once = await transformCssVars(V4_CSS, vars, {
      tailwindVersion: "v4",
    });
    const twice = await transformCssVars(once, vars, {
      tailwindVersion: "v4",
    });
    expect(twice).toBe(once);
  });
});

describe("transformCssVars (v3)", () => {
  test("writes vars into @layer base", async () => {
    const output = await transformCssVars(
      V3_CSS,
      { dark: { brand: "0 0% 10%" }, light: { brand: "0 0% 90%" } },
      { tailwindVersion: "v3" }
    );
    expect(output).toContain("@layer base");
    expect(output).toContain(":root");
    expect(output).toContain("--brand: 0 0% 90%");
    expect(output).toContain(".dark");
    expect(output).toContain("--brand: 0 0% 10%");
    expect(output).not.toContain("@theme");
  });
});

describe("transformCss", () => {
  test("adds @layer rules with @apply and plain declarations", async () => {
    const output = await transformCss(V4_CSS, {
      "@layer base": {
        body: { "@apply bg-background": {}, "letter-spacing": "0.01em" },
      },
    });
    expect(output).toContain("@layer base {");
    expect(output).toContain("@apply bg-background");
    expect(output).toContain("letter-spacing: 0.01em");
  });

  test("puts @keyframes inside @theme inline", async () => {
    const output = await transformCss(V4_CSS, {
      "@keyframes shimmer": {
        from: { "background-position": "0 0" },
        to: { "background-position": "-200% 0" },
      },
    });
    expect(output).toContain("@theme inline {");
    expect(output).toContain("@keyframes shimmer");
    expect(output).toContain("background-position: -200% 0");
  });

  test("creates @utility blocks and dedupes imports/plugins", async () => {
    const input = `${V4_CSS}@plugin "tw-animate-css";\n`;
    const output = await transformCss(input, {
      '@import "tailwindcss"': {},
      "@plugin tw-animate-css": {},
      "@utility scrollbar-hidden": { "scrollbar-width": "none" },
    });
    expect(output.match(/@import "tailwindcss"/g)?.length).toBe(1);
    expect(output.match(/tw-animate-css/g)?.length).toBe(1);
    expect(output).toContain("@utility scrollbar-hidden");
    expect(output).toContain("scrollbar-width: none");
  });

  test("merges @apply into an existing rule via tailwind-merge", async () => {
    const input = `${V4_CSS}\n.badge {\n  @apply p-2 text-sm;\n}\n`;
    const output = await transformCss(input, {
      ".badge": { "@apply p-4": {} },
    });
    expect(output).toContain("@apply text-sm p-4");
    expect(output).not.toContain("p-2");
  });
});

describe("findGlobalCssFile / detectTailwindVersion", () => {
  test("finds the css file that imports tailwind", () => {
    mkdirSync(join(tempDir, "app"), { recursive: true });
    writeFileSync(join(tempDir, "app", "other.css"), "body { margin: 0; }");
    writeFileSync(join(tempDir, "app", "globals.css"), V4_CSS);
    expect(findGlobalCssFile(tempDir)).toBe(
      join(tempDir, "app", "globals.css")
    );
  });

  test("prefers the components.json tailwind.css path", () => {
    mkdirSync(join(tempDir, "styles"), { recursive: true });
    writeFileSync(join(tempDir, "styles", "main.css"), V4_CSS);
    writeFileSync(
      join(tempDir, "components.json"),
      JSON.stringify({ tailwind: { css: "styles/main.css" } })
    );
    expect(findGlobalCssFile(tempDir)).toBe(
      join(tempDir, "styles", "main.css")
    );
  });

  test("returns null when nothing tailwind-related exists", () => {
    writeFileSync(join(tempDir, "plain.css"), "body { margin: 0; }");
    expect(findGlobalCssFile(tempDir)).toBeNull();
  });

  test("detects version from the tailwindcss dependency", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "^3.4.0" } })
    );
    expect(detectTailwindVersion(tempDir)).toBe("v3");
  });

  test("falls back to css content when no dependency is found", () => {
    expect(detectTailwindVersion(join(tempDir, "nope"), V3_CSS)).toBe("v3");
    expect(detectTailwindVersion(join(tempDir, "nope"), V4_CSS)).toBe("v4");
  });
});

describe("updateGlobalCss", () => {
  test("applies cssVars and css to the detected global css file", async () => {
    mkdirSync(join(tempDir, "app"), { recursive: true });
    const cssPath = join(tempDir, "app", "globals.css");
    writeFileSync(cssPath, V4_CSS);
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "^4.0.0" } })
    );

    const outcome = await updateGlobalCss(
      {
        css: { "@utility glow": { "box-shadow": "0 0 8px red" } },
        cssVars: { light: { brand: "oklch(0.7 0.1 200)" } },
      },
      tempDir
    );

    expect(outcome.status).toBe("updated");
    const written = readFileSync(cssPath, "utf8");
    expect(written).toContain("--brand: oklch(0.7 0.1 200)");
    expect(written).toContain("@utility glow");
  });

  test("dry run reports would-update without writing", async () => {
    const cssPath = join(tempDir, "globals.css");
    writeFileSync(cssPath, V4_CSS);

    const outcome = await updateGlobalCss(
      { css: {}, cssVars: { light: { brand: "red" } } },
      tempDir,
      { dryRun: true }
    );

    expect(outcome.status).toBe("would-update");
    expect(readFileSync(cssPath, "utf8")).toBe(V4_CSS);
  });

  test("reports unchanged when payload is already applied", async () => {
    const cssPath = join(tempDir, "globals.css");
    writeFileSync(cssPath, V4_CSS);
    const payload = { css: {}, cssVars: { light: { brand: "red" } } };

    await updateGlobalCss(payload, tempDir);
    const outcome = await updateGlobalCss(payload, tempDir);
    expect(outcome.status).toBe("unchanged");
  });

  test("reports no-css-file when nothing is found", async () => {
    const outcome = await updateGlobalCss(
      { css: {}, cssVars: { light: { brand: "red" } } },
      tempDir
    );
    expect(outcome.status).toBe("no-css-file");
  });
});
