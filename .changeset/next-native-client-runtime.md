---
'@octanejs/next': patch
'octane': patch
---

Add an experimental native Next.js client mode that hydrates compiler-proven
Octane boundaries without mounting the React App Router client root. Native
modules register stable boundary identities, adopt the React-hosted server DOM
with its exact identifier prefix, and load from Next's compact client-reference
resume table without decoding Flight in the browser.

The native runtime also provides same-document HTML navigation, prefetching,
history traversal, metadata and stylesheet updates, typed browser View
Transitions, and route-local boundary reactivation. Automatic boundaries that
cannot move to Octane become server-static client facades in native mode,
preserving explicitly Octane-owned child registrations without retaining React
or the Next App Router client graph.

Native mode enables Cache Components automatically as part of its
zero-configuration renderer contract.
