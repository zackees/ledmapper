/// <reference types="vite/client" />

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
