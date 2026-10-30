import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectConfig, RegistryItem } from "@/types.js";
import {
  collectTailwindConfig,
  hasTailwindPayload,
  toPluginExpression,
  transformTailwindConfig,
  updateTailwindConfig,
} from "@/utils/update-tailwind-config.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sora-tw-test-"));
});

afterEach(() => {
  rmSync(tempDir, { force: true, recursive: true });
});

function makeItem(overrides: Partial<RegistryItem>): RegistryItem {
  return { files: [], name: "test", type: "registry:ui", ...overrides };
}

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    aliasConfigured: true,
    aliases: {
      components: "@/components",
      hooks: "@/hooks",
      lib: "@/lib",
      utils: "@/lib/utils",
    },
    componentPath: "src/components",
    cwd: tempDir,
    packageManager: "npm",
    srcDir: "src",
    tsconfigPathsConfigured: true,
    ...overrides,
  };
}

describe("toPluginExpression", () => {
  test("wraps bare package name in require()", () => {
    expect(toPluginExpression("tailwindcss-animate")).toBe(
      'require("tailwindcss-animate")'
    );
    expect(toPluginExpression("@tailwindcss/typography")).toBe(
      'require("@tailwindcss/typography")'
    );
  });

  test("leaves existing require() or function call unchanged", () => {
    expect(toPluginExpression('require("tailwindcss-animate")')).toBe(
      'require("tailwindcss-animate")'
    );
    expect(toPluginExpression("require('./local-plugin')")).toBe(
      "require('./local-plugin')"
    );
  });
});

describe("collectTailwindConfig", () => {
  test("merges plugins, content, and deep-merges theme", () => {
    const items: RegistryItem[] = [
      makeItem({
        tailwind: {
          config: {
            plugins: ["tailwindcss-animate"],
            theme: {
              extend: {
                colors: { primary: "#123456" },
              },
            },
          },
        },
      }),
      makeItem({
        tailwind: {
          config: {
            plugins: ["@tailwindcss/typography"],
            theme: {
              extend: {
                colors: { secondary: "#654321" },
                keyframes: {
                  "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
                },
              },
            },
          },
        },
      }),
    ];

    const merged = collectTailwindConfig(items);
    expect(merged?.plugins).toEqual([
      "tailwindcss-animate",
      "@tailwindcss/typography",
    ]);
    expect(merged?.theme).toEqual({
      extend: {
        colors: { primary: "#123456", secondary: "#654321" },
        keyframes: {
          "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        },
      },
    });
  });

  test("returns null when no item specifies tailwind config", () => {
    expect(collectTailwindConfig([makeItem({})])).toBeNull();
  });
});

describe("hasTailwindPayload", () => {
  test("returns true when items have tailwind config content, plugins, or theme", () => {
    expect(
      hasTailwindPayload([
        makeItem({
          tailwind: { config: { plugins: ["tailwindcss-animate"] } },
        }),
      ])
    ).toBe(true);

    expect(hasTailwindPayload([makeItem({})])).toBe(false);
  });
});

describe("transformTailwindConfig", () => {
  const baseConfig = `
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
`;

  test("injects darkMode, plugins, and deep-merges theme extend", () => {
    const transformed = transformTailwindConfig(baseConfig, {
      plugins: ["tailwindcss-animate"],
      theme: {
        extend: {
          animation: {
            "accordion-down": "accordion-down 0.2s ease-out",
          },
          keyframes: {
            "accordion-down": {
              from: { height: "0" },
              to: { height: "var(--radix-accordion-content-height)" },
            },
          },
        },
      },
    });

    expect(transformed).toContain('darkMode: ["class"]');
    expect(transformed).toContain('require("tailwindcss-animate")');
    expect(transformed).toContain("accordion-down");
    expect(transformed).toContain("keyframes");
  });

  test("returns original input if no config object is found", () => {
    const emptyFile = "export default {};";
    expect(transformTailwindConfig(emptyFile, { plugins: ["foo"] })).toBe(
      emptyFile
    );
  });
});

describe("updateTailwindConfig", () => {
  test("returns no-config when items have no tailwind payload", () => {
    const config = makeConfig({
      tailwindConfig: join(tempDir, "tailwind.config.ts"),
    });
    const outcome = updateTailwindConfig([makeItem({})], config);
    expect(outcome.status).toBe("no-config");
  });

  test("returns no-config when tailwindConfig path is not defined", () => {
    const config = makeConfig({ tailwindConfig: undefined });
    const outcome = updateTailwindConfig(
      [makeItem({ tailwind: { config: { plugins: ["a"] } } })],
      config
    );
    expect(outcome.status).toBe("no-config");
  });

  test("updates tailwind.config.ts for Tailwind v3 projects", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "^3.4.0" } })
    );
    const configPath = join(tempDir, "tailwind.config.ts");
    const initialConfig = `
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`;
    writeFileSync(configPath, initialConfig);
    const config = makeConfig({ tailwindConfig: configPath });

    const outcome = updateTailwindConfig(
      [
        makeItem({
          tailwind: {
            config: {
              plugins: ["tailwindcss-animate"],
            },
          },
        }),
      ],
      config
    );

    expect(outcome.status).toBe("updated");
    const updated = readFileSync(configPath, "utf8");
    expect(updated).toContain('require("tailwindcss-animate")');
    expect(updated).toContain('darkMode: ["class"]');
  });

  test("dryRun reports would-update without modifying file", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "^3.4.0" } })
    );
    const configPath = join(tempDir, "tailwind.config.ts");
    const initialConfig = `
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`;
    writeFileSync(configPath, initialConfig);
    const config = makeConfig({ tailwindConfig: configPath });

    const outcome = updateTailwindConfig(
      [
        makeItem({
          tailwind: { config: { plugins: ["tailwindcss-animate"] } },
        }),
      ],
      config,
      { dryRun: true }
    );

    expect(outcome.status).toBe("would-update");
    expect(readFileSync(configPath, "utf8")).toBe(initialConfig);
  });
});
