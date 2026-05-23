/// <reference types="vite/client" />

// Tell TypeScript about the env vars we use, so `import.meta.env.VITE_…`
// is typed instead of being `any`.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
