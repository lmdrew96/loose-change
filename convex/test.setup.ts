/// <reference types="vite/client" />

// Shared module glob for convex-test — Vite's import.meta.glob is a
// compile-time macro, so this is factored out once rather than repeated in
// every test file.
export const modules = import.meta.glob("./**/*.*s");
