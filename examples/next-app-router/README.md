# Next.js App Router hybrid example

This fixture exercises `@octanejs/next` against the upstream Next.js App Router
with Turbopack and Cache Components enabled.

```bash
pnpm typecheck
pnpm build
pnpm dev
```

The fixture also carries a controlled `/perf` workload whose identical React
source can be built once under React Compiler and once under automatic Octane
migration:

```bash
pnpm bench:client-runtime
```

The benchmark verifies exact component work and final DOM state before
reporting equal-parent, one-row-change, and 1,000-consumer context timings.

The page deliberately combines:

- a cached React Server Component;
- request-time content streamed through Suspense;
- an ordinary React-authored `"use client"` boundary automatically migrated to
  Octane, including its named `react` hook imports;
- a React-authored transitive `.tsx` child marked only with `"use octane"`,
  compiled without creating another Next client boundary;
- a `"use client"` plus `"use react"` boundary left on React as an escape hatch;
- one `"use client"` plus `"use octane"` `.tsx` boundary with Octane state,
  memoization, effects, transitions, ids, native events, a nested `.tsrx`
  component, SSR, and hydration.

React remains the Flight, App Router, and root hydration kernel. The interactive
card's descendants are owned by Octane.
