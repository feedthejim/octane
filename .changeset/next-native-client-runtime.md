---
'@octanejs/next': patch
'octane': patch
---

Add an experimental native Next.js client mode that hydrates compiler-proven
Octane boundaries without mounting the React App Router client root. The
compiler now emits stable boundary identities for renderer integrations, and
the Next binding supplies the native Flight discovery runtime plus ReactDOM
compatibility shims.
