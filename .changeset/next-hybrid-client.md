---
"@octanejs/next": patch
"octane": patch
---

Add a Turbopack-only Next.js App Router integration that compiles `.tsx`
boundaries marked with `"use client"` and `"use octane"`, then hosts their
Octane component exports through the React-compatible island bridge. An
automatic mode migrates every direct `"use client"` boundary, rewrites supported
named React imports, and provides `"use react"` as a per-boundary escape hatch.
Directive ownership is the zero-configuration default so Octane is loaded only
for explicitly owned boundaries. Automatic migration remains available through
`createOctanePlugin({ clientComponents: "all" })`, with optional diagnostics
and `"use react"` escape hatches.
Connected React `ViewTransition` boundaries remain React-owned automatically;
explicit `"use octane"` ownership can opt into isolated Octane transition
semantics.

Add opt-in compiler transforms for supported React imports and React-hosted
Octane component export facades. Make the React-owned island host
layout-transparent while retaining its lifecycle and hydration ownership.
