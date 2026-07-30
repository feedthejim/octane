# `@octanejs/next`

Turbopack-only integration for hosting compiled Octane client components inside
the Next.js App Router.

```ts
// next.config.ts
import { withOctane } from '@octanejs/next';

export default withOctane({
	cacheComponents: true,
});
```

By default, every application `.tsx` module with `"use client"` is considered
for Octane compilation. Compatible modules migrate automatically. Modules whose
React ownership cannot be proven quietly remain on React, and `"use react"` is
the explicit escape hatch. Set `diagnostics: true` or
`OCTANE_NEXT_DIAGNOSTICS=1` to explain each fallback during integration work.

`"use octane"` forces Octane ownership. Add it beside Next's client directive
when deliberately overriding the conservative compatibility planner.
The physical `.tsx` module identity lets Next register the module in its Flight
client manifest while Octane replaces only its component exports with React
facades:

```tsx
/** @jsxImportSource octane */
'use client';
'use octane';

import { useState } from 'octane';

export function Counter() {
	const [count, setCount] = useState(0);
	return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

Regular `.tsrx` modules remain available for nested Octane components imported
by that boundary. A nested `.tsx` module can instead declare `"use octane"`
without `"use client"`: it is compiled as an ordinary Octane module and does not
receive a React facade.

`"use octane"` is the build ownership signal. TypeScript does not currently
select a JSX namespace from a custom directive, so add
`/** @jsxImportSource octane */` when the boundary uses Octane-specific JSX
types such as `class` composition or ref arrays. Boundaries using the JSX subset
shared with React do not need the pragma.

Next still owns React Server Components, Flight, App Router navigation, Cache
Components, and the root React hydration lifecycle. The integration generates a
normal Next client-reference facade for each `.tsx` module with both directives.
React owns one opaque host element per facade instance; Octane owns every
descendant. React Compiler can remain enabled: Octane-owned modules opt out of
its post-loader transform automatically.

## Automatic client-boundary migration

Supported named imports from `react` and `react-dom` are rewritten to `octane`
before hook and component analysis in automatic mode and in any explicitly
`"use octane"` `.tsx` module:

```tsx
'use client';

import { useState } from 'react';

export function Counter() {
	const [count, setCount] = useState(0);
	return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

Use `"use react"` to keep one boundary on React:

```tsx
'use client';
'use react';
```

Turbopack's public loader conditions do not expose whether a directive-free
module is transitively inside an Octane client graph. Mark transitive `.tsx`
modules with `"use octane"` so both their browser and server-render copies are
compiled. Automatic mode also migrates their supported React imports.

Advanced integrations can use `createOctanePlugin(options)` to opt into
directive-only selection, profiling, or a custom compiler root. Normal Next
applications should use `withOctane(nextConfig)` without Octane-specific
configuration.

Default and namespace React imports, unsupported React APIs, `react-dom/client`,
and other React subpaths fail at build time with an instruction to use named
imports or add `"use react"`.

## Current constraints

- Next.js 16.2 or newer and Turbopack are required.
- Automatic selection currently targets application `.tsx` modules. `.jsx` and
  `.js` client boundaries remain on React.
- The Node.js App Router runtime is covered by the integration fixture. Edge
  runtime compilation is not configured yet.
- Every direct `"use client"` boundary is considered automatically unless it
  adds `"use react"`. A forced direct boundary uses both `"use client"` and
  `"use octane"`; a transitive compiled module uses `"use octane"` alone.
- Next currently re-addresses custom loader output as a virtual `*.tsrx.js`
  module that its Flight graph cannot resolve, so direct `.tsrx` boundaries are
  rejected with an actionable error.
- Named function declarations and named arrow/function-expression component
  exports are supported. `memo(...)` and `lazy(...)` exports are supported,
  including default exports. Other default components must use a named function
  declaration or an exported named local so the compiled Octane implementation
  retains a local identity. Lowercase non-component exports are forwarded
  unchanged; exported uppercase functions follow React's component naming
  convention and receive facades.
- `export *`, component re-exports, and imported component exports are rejected
  at the boundary because the loader cannot prove their runtime ownership.
  Define a local wrapper component or keep that boundary on React.
- React Server Component children cannot yet render as slots inside an Octane
  island.
- Automatic mode keeps boundaries importing React's `ViewTransition` on React
  because connected transitions require one renderer to own the coordination
  graph. Add `"use octane"` only when isolated Octane transition semantics are
  intentional.
- Automatic mode cannot infer ownership for directive-free transitive `.tsx`
  modules. They must add `"use octane"` until Turbopack exposes a client-graph
  condition or loader context.
- Rewriting a module's React imports cannot prove that an arbitrary third-party
  component is Octane-compatible. A React component imported and rendered
  inside an Octane-owned module can still return React elements or call React's
  private runtime. Keep that boundary on React until the dependency has an
  Octane binding.
- Fast Refresh currently falls back to the host's module invalidation behavior;
  Octane's webpack-dialect HMR output is disabled under Turbopack.
- Native, React-free App Router ownership is not implemented. It requires a
  selectable client-runtime entrypoint in Next.js.
