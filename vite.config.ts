import { paraglideVitePlugin } from '@inlang/paraglide-js';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		devtoolsJson(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide'
		})
	],
	optimizeDeps: {
		// Pre-bundle deps that storybook-vitest hits on every test file, so the
		// browser provider doesn't recompile them per worker. Without this, CI
		// runs see ~3-5s of "discovered new dependencies" reloads on each story
		// project boot — flaky test timeouts when machines are slow.
		//
		// The phosphor-svelte/lib/* surface is the most common source of
		// late-discovered deps because each icon is a separate module. Listing
		// the icons that stories actually render keeps the pre-bundle warm
		// across the full storybook test run.
		include: [
			'axe-core',
			'@storybook/addon-a11y/preview',
			'phosphor-svelte/lib/StarIcon',
			'phosphor-svelte/lib/HeartIcon',
			'phosphor-svelte/lib/HeartBreakIcon',
			'phosphor-svelte/lib/GhostIcon',
			'phosphor-svelte/lib/MapPinIcon',
			'phosphor-svelte/lib/CrosshairIcon',
			'phosphor-svelte/lib/BellIcon',
			'phosphor-svelte/lib/CameraIcon',
			'phosphor-svelte/lib/CheckCircleIcon',
			'phosphor-svelte/lib/CloudArrowUpIcon',
			'phosphor-svelte/lib/ArrowClockwiseIcon',
			'phosphor-svelte/lib/ArrowCounterClockwiseIcon',
			'phosphor-svelte/lib/LightningIcon',
			'phosphor-svelte/lib/SparkleIcon',
			'phosphor-svelte/lib/CaretRightIcon',
			'phosphor-svelte/lib/CopyIcon',
			'phosphor-svelte/lib/EyeIcon',
			'phosphor-svelte/lib/LockSimpleIcon',
			'phosphor-svelte/lib/MoonIcon',
			'phosphor-svelte/lib/PlusIcon',
			'phosphor-svelte/lib/ShareNetworkIcon',
			'phosphor-svelte/lib/SignOutIcon',
			'phosphor-svelte/lib/SunIcon',
			'phosphor-svelte/lib/TranslateIcon',
			'phosphor-svelte/lib/TrashIcon',
			'phosphor-svelte/lib/UserIcon',
			'phosphor-svelte/lib/WrenchIcon',
			'phosphor-svelte/lib/XIcon',
			'phosphor-svelte/lib/WaveformIcon'
		]
	},
	test: {
		expect: {
			requireAssertions: true
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [
							{
								browser: 'chromium',
								headless: true
							}
						]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: true,
				plugins: [
					// The plugin will run tests for the stories defined in your Storybook config
					// See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
					storybookTest({
						configDir: path.join(dirname, '.storybook')
					})
				],
				test: {
					name: 'storybook',
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [
							{
								browser: 'chromium'
							}
						]
					},
					setupFiles: ['.storybook/vitest.setup.ts']
				}
			}
		]
	}
});
