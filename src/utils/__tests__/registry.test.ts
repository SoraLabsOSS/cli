import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertSecureRegistryUrl,
  resolveRegistryUrl,
} from "@/utils/registry.js";

const MUST_USE_HTTPS = /must use HTTPS/;
const INVALID_URL = /Invalid registry URL/;
const UNKNOWN_REGISTRY = /Unknown registry "nonexistent"/;

describe("assertSecureRegistryUrl", () => {
  test("accepts HTTPS URLs", () => {
    expect(() =>
      assertSecureRegistryUrl("https://ui.soralabs.io.vn")
    ).not.toThrow();
  });

  test("accepts HTTP localhost", () => {
    expect(() =>
      assertSecureRegistryUrl("http://localhost:3000")
    ).not.toThrow();
  });

  test("accepts HTTP 127.0.0.1", () => {
    expect(() =>
      assertSecureRegistryUrl("http://127.0.0.1:8080")
    ).not.toThrow();
  });

  test("accepts HTTP ::1", () => {
    expect(() => assertSecureRegistryUrl("http://[::1]:3000")).not.toThrow();
  });

  test("rejects HTTP for non-localhost", () => {
    expect(() => assertSecureRegistryUrl("http://evil.example.com")).toThrow(
      MUST_USE_HTTPS
    );
  });

  test("rejects invalid URLs", () => {
    expect(() => assertSecureRegistryUrl("not-a-url")).toThrow(INVALID_URL);
  });

  test("accepts http://localhost without port", () => {
    expect(() => assertSecureRegistryUrl("http://localhost")).not.toThrow();
  });

  test("accepts file:// protocol (only http: is restricted)", () => {
    expect(() => assertSecureRegistryUrl("file:///tmp/registry")).not.toThrow();
  });
});

describe("resolveRegistryUrl", () => {
  const originalEnv = process.env.SORA_REGISTRY_URL;

  beforeEach(() => {
    delete process.env.SORA_REGISTRY_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SORA_REGISTRY_URL;
    } else {
      process.env.SORA_REGISTRY_URL = originalEnv;
    }
  });

  test("resolves known registry key", () => {
    expect(resolveRegistryUrl("ui")).toBe("https://ui.soralabs.io.vn");
  });

  test("uses default registry when no argument", () => {
    expect(resolveRegistryUrl()).toBe("https://ui.soralabs.io.vn");
  });

  test("accepts full HTTPS URL", () => {
    expect(resolveRegistryUrl("https://custom.registry.dev")).toBe(
      "https://custom.registry.dev"
    );
  });

  test("strips trailing slash from URL", () => {
    expect(resolveRegistryUrl("https://custom.registry.dev/")).toBe(
      "https://custom.registry.dev"
    );
  });

  test("accepts localhost HTTP URL", () => {
    expect(resolveRegistryUrl("http://localhost:4000")).toBe(
      "http://localhost:4000"
    );
  });

  test("rejects non-localhost HTTP URL", () => {
    expect(() => resolveRegistryUrl("http://evil.example.com")).toThrow(
      MUST_USE_HTTPS
    );
  });

  test("throws for unknown registry key", () => {
    expect(() => resolveRegistryUrl("nonexistent")).toThrow(UNKNOWN_REGISTRY);
  });

  test("env var overrides everything", () => {
    process.env.SORA_REGISTRY_URL = "https://env-override.dev";
    expect(resolveRegistryUrl("ui")).toBe("https://env-override.dev");
  });

  test("env var rejects insecure URL", () => {
    process.env.SORA_REGISTRY_URL = "http://insecure.example.com";
    expect(() => resolveRegistryUrl()).toThrow(MUST_USE_HTTPS);
  });
});
