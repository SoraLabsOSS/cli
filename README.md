# @soralabs/cli

[![Socket Badge](https://badge.socket.dev/npm/package/@soralabs/cli/0.5.6)](https://socket.dev/npm/package/@soralabs/cli/overview/0.5.6)

A CLI for installing components from any [shadcn](https://ui.shadcn.com)-compatible registry into your project — defaults to [Sora UI](https://ui.soralabs.studio) and other Sora Labs products, but works against any registry via `--registry <url>`. Includes native registry authoring tools and Model Context Protocol (MCP) support for AI coding assistants.

## Documentation

- **Official Documentation**: [cli.soralabs.studio](https://cli.soralabs.studio) — full CLI command reference, guides, and universal addressing.
- **Sora UI Docs**: [ui.soralabs.studio/docs/cli](https://ui.soralabs.studio/docs/cli) — documentation for using the CLI with Sora UI components.

## Supported by

Sora CLI is supported by the open-source ecosystem. Special thanks to:

<a href="https://mintlify.com" target="_blank" rel="noopener noreferrer">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.soralabs.studio/logos/partners/mintlify-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.soralabs.studio/logos/partners/mintlify-light.svg" />
    <img src="https://cdn.soralabs.studio/logos/partners/mintlify-light.svg" alt="Mintlify" height="24" />
  </picture>
</a>

## Usage

```bash
# Initialize styling and configuration (optional — add works without init too)
npx @soralabs/cli init

# Install a component
npx @soralabs/cli add text-effect

# Install multiple components
npx @soralabs/cli add text-effect draw-underline-link

# Interactive component picker
npx @soralabs/cli add

# List available components
npx @soralabs/cli list

# Compare installed components against the registry
npx @soralabs/cli diff text-effect

# Diagnose project environment issues
npx @soralabs/cli doctor

# Configure AI coding assistant (Cursor, Claude Code, VS Code, Antigravity)
npx @soralabs/cli mcp init

# Compile local registry components into distribution JSON files
npx @soralabs/cli build

# Validate registry schema and local source file paths
npx @soralabs/cli validate
```

### Options

```bash
npx @soralabs/cli add text-effect --path src/components/ui
npx @soralabs/cli add card --cwd packages/ui       # run as if started in packages/ui (monorepos)
npx @soralabs/cli add text-effect --force
npx @soralabs/cli add text-effect --registry ui                          # default; other Sora Labs products register here later
npx @soralabs/cli add some-item --registry https://any-shadcn-registry.com   # point at any shadcn-compatible registry
npx @soralabs/cli add text-effect --yes           # skip confirmation prompts (for CI/scripts)
npx @soralabs/cli add text-effect --dry-run       # preview changes without writing files
npx @soralabs/cli add text-effect --silent        # only print summary lines
npx @soralabs/cli add text-effect --view          # print file contents instead of writing
npx @soralabs/cli build -o public/r               # custom build output directory
npx @soralabs/cli validate --json                 # machine-readable validation report
npx @soralabs/cli mcp init --client cursor        # configure specific AI client
npx @soralabs/cli --version
```

## How it works

The CLI fetches a shadcn-compatible registry (`<product-url>/r/registry.json`, `<product-url>/r/<name>.json`) built by that product's own `build` step, resolves the dependency tree, automatically transforms React Server Component directives (`"use client"`), writes files into your project, and installs npm dependencies with your detected package manager (bun/pnpm/yarn/npm).

- **No Mandatory Init**: Components can be installed into any project with a `package.json` immediately — aliases and paths are detected on the fly.
- **RSC Optimization**: In Next.js App Router projects, components utilizing client hooks are automatically supplied with `"use client"`. In non-RSC environments (Vite, Astro), unused `"use client"` directives are cleanly stripped.
- **AI-Native with MCP**: Run `npx @soralabs/cli mcp` to start a native Model Context Protocol server, or `npx @soralabs/cli mcp init` to wire component discovery and installation tools directly into Cursor, Claude Code, VS Code, or Antigravity.
- **Registry Authoring**: Build your own UI libraries with `sora build` and verify schema integrity with `sora validate`.

In a monorepo, `--cwd <path>` (or `-c`) runs commands as if started inside `<path>` — it detects that workspace's own `tsconfig.json`/`components.json` aliases and writes components there without having to `cd` into it first.

## Development

```bash
bun install
bun run build      # bundles src/index.ts -> dist/index.js via tsup
bun run typecheck
bun test           # run test suite (368+ unit tests)
bun x ultracite check
node dist/index.js list
```
