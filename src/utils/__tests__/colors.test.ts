import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  active,
  bar,
  dim,
  done,
  error,
  fileHeader,
  header,
  highlight,
  sanitize,
  warn,
} from "@/utils/colors.js";

describe("sanitize", () => {
  test("strips ANSI escape sequences", () => {
    expect(sanitize("\x1B[31mred\x1B[0m")).toBe("[31mred[0m");
  });

  test("strips null bytes", () => {
    expect(sanitize("hello\x00world")).toBe("helloworld");
  });

  test("strips carriage return", () => {
    expect(sanitize("overwritten\ractual")).toBe("overwrittenactual");
  });

  test("strips bell character", () => {
    expect(sanitize("alert\x07")).toBe("alert");
  });

  test("preserves tabs", () => {
    expect(sanitize("col1\tcol2")).toBe("col1\tcol2");
  });

  test("preserves newlines", () => {
    expect(sanitize("line1\nline2")).toBe("line1\nline2");
  });

  test("preserves normal text", () => {
    const text = "Hello, World! 123 @#$%^&*()";
    expect(sanitize(text)).toBe(text);
  });

  test("handles empty string", () => {
    expect(sanitize("")).toBe("");
  });

  test("strips OSC sequence used for terminal title injection", () => {
    expect(sanitize("\x1B]0;evil title\x07")).toBe("]0;evil title");
  });

  test("strips DEL character (0x7F)", () => {
    expect(sanitize("abc\x7Fdef")).toBe("abcdef");
  });
});

/**
 * Errors and warnings must go to stderr, everything else to stdout — the
 * CLI's whole `--json` piping contract (`sora list --json > out.json`)
 * depends on stdout staying free of anything that isn't the requested
 * output. See AGENTS.md "Output streams".
 */
describe("stream routing", () => {
  afterEach(() => {
    mock.restore();
  });

  test("error() writes to console.error, not console.log", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    error("something broke");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("warn() writes to console.error, not console.log", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    warn("careful");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("done() writes to console.log, not console.error", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    done("all good");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("active() writes to console.log, not console.error", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    active("working...");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("bar() writes to console.log, not console.error", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    bar("a line");
    bar();

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("header() writes only to console.log", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    header();

    expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("fileHeader() writes only to console.log", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    fileHeader("components/card.tsx");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("highlight / dim", () => {
  test("highlight() returns the text unchanged aside from color codes", () => {
    expect(highlight("card")).toContain("card");
  });

  test("dim() returns the text unchanged aside from color codes", () => {
    expect(dim("hint")).toContain("hint");
  });
});
