/// <reference types="vite/client" />

// Build-version string injected by Vite's `define` in vite.config.js (git
// SHA + build date, e.g. "a1b2c3d (2026-07-08)"). A literal string
// substituted at build/dev-server time by esbuild — not a real runtime
// binding, so plain Node (unit tests, no Vite processing) never sees this
// identifier declared. Read it via `typeof __APP_VERSION__ === 'string'`
// (see src/ui/diagnostics.ts) rather than a bare reference so the read
// stays safe in both environments.
declare const __APP_VERSION__: string;

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}

declare module 'virtual:screenmap-presets' {
  export interface PresetCategory {
    id: string;
    label: string;
  }
  export interface PresetEntry {
    file: string;
    name: string;
    category?: string;
    dimensions?: [number, number];
    ledCount?: number;
  }
  export interface PresetManifest {
    schemaVersion?: number;
    categories?: PresetCategory[];
    presets: PresetEntry[];
  }
  const manifest: PresetManifest;
  export default manifest;
}
