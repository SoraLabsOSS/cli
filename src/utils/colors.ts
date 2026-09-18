import pc from "picocolors";

const SORA_CLI_BANNER = `███████╗ ██████╗ ██████╗  █████╗      ██████╗██╗     ██╗
██╔════╝██╔═══██╗██╔══██╗██╔══██╗    ██╔════╝██║     ██║
███████╗██║   ██║██████╔╝███████║    ██║     ██║     ██║
╚════██║██║   ██║██╔══██╗██╔══██║    ██║     ██║     ██║
███████║╚██████╔╝██║  ██║██║  ██║    ╚██████╗███████╗██║
╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝`;

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control/escape chars to strip them before printing
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/g;

/**
 * Names, descriptions, file paths, error detail, and diffed file content
 * can come straight from a registry response (untrusted, remote) and get
 * printed to the terminal. Every ANSI/OSC escape sequence starts with a
 * control character (ESC 0x1B being the main one; raw \r can also be used
 * to overwrite a printed line), so stripping C0 control chars before
 * printing prevents a malicious registry from spoofing output, hiding
 * text, or rewriting the terminal title/clipboard via injected escapes.
 * Tab and newline are kept since they're needed for legitimate multi-line
 * content (diff output).
 */
export function sanitize(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}

export function header(): void {
  console.log(pc.cyan(SORA_CLI_BANNER));
  console.log(pc.dim("Sora Labs component installer"));
  console.log();
}

export function active(message: string): void {
  console.log(pc.cyan("○"), message);
}

export function done(message: string): void {
  console.log(pc.green("✓"), message);
}

export function error(message: string): void {
  console.error(pc.red("✗"), message);
}

export function warn(message: string): void {
  console.error(pc.yellow("⚠"), message);
}

export function bar(message?: string): void {
  console.log(pc.dim(message ? `  ${message}` : "│"));
}

export function highlight(text: string): string {
  return pc.cyan(text);
}

export function dim(text: string): string {
  return pc.dim(text);
}

export function fileHeader(path: string): void {
  console.log(pc.bold(pc.cyan(`── ${path} ──`)));
}
