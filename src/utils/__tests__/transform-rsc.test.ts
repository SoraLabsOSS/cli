import { describe, expect, test } from "bun:test";
import {
  hasUseClientDirective,
  requiresClientDirective,
  transformRsc,
} from "@/utils/transform-rsc.js";

describe("transform-rsc", () => {
  describe("hasUseClientDirective", () => {
    test("detects double quoted directive", () => {
      expect(
        hasUseClientDirective(
          '"use client";\n\nexport const Button = () => null;'
        )
      ).toBe(true);
    });

    test("detects single quoted directive", () => {
      expect(
        hasUseClientDirective(
          "'use client';\n\nexport const Button = () => null;"
        )
      ).toBe(true);
    });

    test("detects directive without semicolon", () => {
      expect(
        hasUseClientDirective(
          '"use client"\n\nexport const Button = () => null;'
        )
      ).toBe(true);
    });

    test("detects directive with leading comments", () => {
      const code =
        '// Copyright 2026\n"use client";\n\nexport const Button = () => null;';
      expect(hasUseClientDirective(code)).toBe(true);
    });

    test("returns false when directive is absent", () => {
      expect(hasUseClientDirective("export const Button = () => null;")).toBe(
        false
      );
    });
  });

  describe("requiresClientDirective", () => {
    test("returns true when useState is used", () => {
      expect(
        requiresClientDirective("const [val, setVal] = useState(0);")
      ).toBe(true);
    });

    test("returns true when useEffect is used", () => {
      expect(requiresClientDirective("useEffect(() => {}, []);")).toBe(true);
    });

    test("returns true when createContext is used", () => {
      expect(requiresClientDirective("const Ctx = createContext(null);")).toBe(
        true
      );
    });

    test("returns false for server-only component code", () => {
      expect(
        requiresClientDirective(
          "export async function Page() { return <div>Server</div>; }"
        )
      ).toBe(false);
    });
  });

  describe("transformRsc", () => {
    test("strips directive for non-RSC project", () => {
      const code = '"use client";\n\nimport * as React from "react";';
      expect(transformRsc(code, false)).toBe('import * as React from "react";');
    });

    test("strips single-quoted directive for non-RSC project", () => {
      const code = "'use client';\n\nimport * as React from 'react';";
      expect(transformRsc(code, false)).toBe("import * as React from 'react';");
    });

    test("preserves leading comment when stripping directive", () => {
      const code =
        '// License: MIT\n"use client";\n\nimport * as React from "react";';
      expect(transformRsc(code, false)).toBe(
        '// License: MIT\nimport * as React from "react";'
      );
    });

    test("leaves non-RSC code unchanged when directive was absent", () => {
      const code = 'import * as React from "react";';
      expect(transformRsc(code, false)).toBe('import * as React from "react";');
    });

    test("prepends directive for RSC project when client hooks are used", () => {
      const code =
        'import { useState } from "react";\n\nexport const Counter = () => null;';
      expect(transformRsc(code, true)).toBe(
        `"use client";\n\nimport { useState } from "react";\n\nexport const Counter = () => null;`
      );
    });

    test("preserves existing directive for RSC project", () => {
      const code = '"use client";\n\nimport { useState } from "react";';
      expect(transformRsc(code, true)).toBe(code);
    });

    test("leaves pure server component untouched in RSC project", () => {
      const code =
        "export function Card({ title }: { title: string }) {\n  return <h1>{title}</h1>;\n}";
      expect(transformRsc(code, true)).toBe(code);
    });
  });
});
