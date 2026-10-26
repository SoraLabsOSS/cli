/**
 * Matches a leading "use client" statement on its own line, permitting
 * leading or trailing whitespace and semicolons, while keeping any preceding
 * comments intact.
 */
const USE_CLIENT_STATEMENT = /^(\s*["']use client["'];?\s*[\r\n]+)/m;

/**
 * Recognizes common React client-only hook identifiers and browser-specific
 * constructs requiring the "use client" directive in React Server Component
 * environments.
 */
const CLIENT_HOOK_PATTERN =
  /\b(useState|useEffect|useRef|useCallback|useMemo|useReducer|useContext|createContext|useLayoutEffect|useImperativeHandle|useId|useTransition|useDeferredValue)\b/;

/**
 * Checks whether the source code contains a "use client" directive near the top.
 */
export function hasUseClientDirective(content: string): boolean {
  return USE_CLIENT_STATEMENT.test(content.slice(0, 1000));
}

/**
 * Checks whether the component code contains client-side React hooks.
 */
export function requiresClientDirective(content: string): boolean {
  return CLIENT_HOOK_PATTERN.test(content);
}

/**
 * Transforms file content for React Server Component (RSC) compatibility.
 *
 * - Non-RSC projects (Vite, Astro, Remix, Next.js Pages): Strips the
 *   "use client" directive so non-RSC bundlers do not encounter unused
 *   directives.
 * - RSC projects (Next.js App Router): Ensures that components using
 *   client-side hooks include the "use client" directive at the top.
 */
export function transformRsc(content: string, isRsc: boolean): string {
  if (!isRsc) {
    return content.replace(USE_CLIENT_STATEMENT, "");
  }

  if (hasUseClientDirective(content)) {
    return content;
  }

  if (requiresClientDirective(content)) {
    return `"use client";\n\n${content}`;
  }

  return content;
}
