import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },
	// Ignore PostGIS-managed tables/extension so drizzle-kit won't try to manage them.
	tablesFilter: ['!spatial_ref_sys', '!geography_columns', '!geometry_columns'],
	// Don't introspect / manage Supabase's auth schema.
	schemaFilter: ['public'],
	extensionsFilters: ['postgis'],
	verbose: true,
	strict: true
});
