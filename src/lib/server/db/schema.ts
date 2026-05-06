// Re-export Better-Auth-generated tables (run `bun run auth:schema` to regenerate).
export * from './auth.schema';

// DuoSync app schema. Co-located but separate from auth.schema.ts so the
// generated file is never hand-edited. See plan.md §3.
export * from './app.schema';
