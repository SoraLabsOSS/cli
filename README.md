# @soralabs/cli

[![Socket Badge](https://badge.socket.dev/npm/package/@soralabs/cli/0.5.5)](https://socket.dev/npm/package/@soralabs/cli/overview/0.5.5)

A CLI for installing components from any [shadcn](https://ui.shadcn.com)-compatible registry into your project — defaults to [Sora UI](https://ui.soralabs.studio) and other Sora Labs products, but works against any registry via `--registry <url>`.

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
npx @soralabs/cli add text-effect

# multiple components
npx @soralabs/cli add text-effect draw-underline-link

# interactive picker
npx @soralabs/cli add

# list available components
npx @soralabs/cli list

# compare installed components against the registry
npx @soralabs/cli diff text-effect
```

### Options

```bash
npx @soralabs/cli add text-effect --path src/components/ui
npx @soralabs/cli add card --cwd packages/ui       # run as if started in packages/ui (monorepos)
npx @soralabs/cli add text-effect --force
npx @soralabs/cli add text-effect --registry ui                          # default; other Sora Labs products register here later
npx @soralabs/cli add some-item --registry https://any-shadcn-registry.com   # or point at any shadcn-compatible registry directly
npx @soralabs/cli add text-effect --yes           # skip the install confirmation, for scripts/CI
npx @soralabs/cli add text-effect --dry-run       # preview what would change, write nothing
npx @soralabs/cli add text-effect --silent        # only print summary lines, not per-file output
npx @soralabs/cli add text-effect --view          # print file contents instead of writing them
npx @soralabs/cli --version
```

## How it works

The CLI fetches a shadcn-compatible registry (`<product-url>/r/registry.json`, `<product-url>/r/<name>.json`) built by that product's own `registry:build` step, resolves the dependency tree, writes files into your project, and installs npm dependencies with your detected package manager (bun/pnpm/yarn/npm).

Each Sora Labs product registers its base URL in [`src/constants.ts`](src/constants.ts) as a short `--registry` key — adding a new product only requires adding an entry there, no other logic changes. `--registry` also accepts a full URL directly, so it works against any shadcn-compatible registry, not just Sora Labs' own — it must be HTTPS (plain HTTP is only allowed for `localhost`/`127.0.0.1`, for local registry development). Registry content isn't cryptographically signed, so only point `--registry` at a registry you trust — it's written into your project and its dependency list is fed straight into your package manager.

Since components are copied into your project rather than installed as a package, `sora diff` is the way to check whether the registry has changed a component since you installed it — it reports differences without writing anything; re-run `add <component> --force --yes` to apply an update.

In a monorepo, `--cwd <path>` (or `-c`) runs `add`/`diff` as if the CLI had been started inside `<path>` — it picks up that workspace's own `tsconfig.json`/`components.json` aliases and writes components there, without you having to `cd` into it first. `--path` is different: it only overrides where files get written, without changing which config gets detected.

Every command also does a quick, non-blocking check against npm for a newer published version (printed to stderr, never mixed into `--json` output). Set `SORA_NO_UPDATE_CHECK=1` to disable it, e.g. in CI.

## Development

```bash
bun install
bun run build      # bundles src/index.ts -> dist/index.js via tsup
bun run typecheck
bun test           # run test suite
node dist/index.js list
```
