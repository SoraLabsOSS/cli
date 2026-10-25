import { describe, expect, test } from "bun:test";
import {
  addressKey,
  formatAddress,
  parseComponentAddress,
} from "@/utils/address.js";

describe("parseComponentAddress", () => {
  test("identifies direct HTTP/HTTPS URLs", () => {
    const parsed = parseComponentAddress(
      "https://ui.shadcn.com/r/styles/new-york/button.json"
    );
    expect(parsed).toEqual({
      scheme: "url",
      url: "https://ui.shadcn.com/r/styles/new-york/button.json",
    });
  });

  test("identifies local files starting with ./ or ../ or ending in .json", () => {
    expect(parseComponentAddress("./registry/button.json")).toEqual({
      path: "./registry/button.json",
      scheme: "file",
    });

    expect(parseComponentAddress("../shared/dialog.json")).toEqual({
      path: "../shared/dialog.json",
      scheme: "file",
    });

    expect(parseComponentAddress("card.json")).toEqual({
      path: "card.json",
      scheme: "file",
    });
  });

  test("identifies github: prefix with and without branch ref", () => {
    expect(parseComponentAddress("github:shadcn-ui/ui/button")).toEqual({
      item: "button",
      owner: "shadcn-ui",
      ref: undefined,
      repo: "ui",
      scheme: "github",
    });

    expect(
      parseComponentAddress("github:soralabs/ui/text-effect#canary")
    ).toEqual({
      item: "text-effect",
      owner: "soralabs",
      ref: "canary",
      repo: "ui",
      scheme: "github",
    });
  });

  test("identifies GitHub shorthand (owner/repo/item)", () => {
    expect(parseComponentAddress("shadcn-ui/ui/button")).toEqual({
      item: "button",
      owner: "shadcn-ui",
      ref: undefined,
      repo: "ui",
      scheme: "github",
    });

    expect(parseComponentAddress("org/repo/nested/component#main")).toEqual({
      item: "nested/component",
      owner: "org",
      ref: "main",
      repo: "repo",
      scheme: "github",
    });
  });

  test("identifies scoped namespace (@scope/item)", () => {
    expect(parseComponentAddress("@magicui/marquee")).toEqual({
      item: "marquee",
      namespace: "@magicui",
      scheme: "namespace",
    });

    expect(parseComponentAddress("@soralabs/accordion")).toEqual({
      item: "accordion",
      namespace: "@soralabs",
      scheme: "namespace",
    });
  });

  test("identifies bare component name", () => {
    expect(parseComponentAddress("button")).toEqual({
      name: "button",
      scheme: "bare",
    });

    expect(parseComponentAddress("text-effect")).toEqual({
      name: "text-effect",
      scheme: "bare",
    });
  });
});

describe("formatAddress and addressKey", () => {
  test("formats each address type accurately", () => {
    expect(
      formatAddress({
        scheme: "url",
        url: "https://example.com/r/item.json",
      })
    ).toBe("https://example.com/r/item.json");

    expect(
      formatAddress({
        item: "btn",
        owner: "org",
        ref: "v1",
        repo: "ui",
        scheme: "github",
      })
    ).toBe("org/ui/btn#v1");

    expect(
      formatAddress({
        item: "marquee",
        namespace: "@magicui",
        scheme: "namespace",
      })
    ).toBe("@magicui/marquee");

    expect(formatAddress({ name: "button", scheme: "bare" })).toBe("button");
  });

  test("generates unique addressKeys", () => {
    const k1 = addressKey({
      scheme: "url",
      url: "https://example.com/r/item.json",
    });
    const k2 = addressKey({ name: "item", scheme: "bare" });
    const k3 = addressKey({
      item: "item",
      namespace: "@scope",
      scheme: "namespace",
    });

    expect(k1).not.toBe(k2);
    expect(k2).not.toBe(k3);
    expect(k1).toBe("url:https://example.com/r/item.json");
    expect(k2).toBe("bare:item");
    expect(k3).toBe("ns:@scope/item");
  });
});
