---
"@octanejs/next": patch
"octane": patch
---

Add a Turbopack-only Next.js App Router integration that compiles `.tsx`
boundaries marked with `"use client"` and `"use octane"`, then hosts their
Octane component exports through the React-compatible island bridge. An
automatic mode migrates every direct `"use client"` boundary, rewrites supported
named React imports, and provides `"use react"` as a per-boundary escape hatch.
Automatic migration is the zero-configuration default: incompatible boundaries
quietly remain on React, optional diagnostics explain each fallback, and
`createOctanePlugin()` exposes advanced selection and profiling controls.
Connected React `ViewTransition` boundaries remain React-owned automatically;
explicit `"use octane"` ownership can opt into isolated Octane transition
semantics.

Add opt-in compiler transforms for supported React imports and React-hosted
Octane component export facades. Make the React-owned island host
layout-transparent while retaining its lifecycle and hydration ownership.
