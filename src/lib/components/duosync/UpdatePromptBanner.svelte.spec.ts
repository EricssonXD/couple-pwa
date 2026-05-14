import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// Tiny svelte-store-shaped mock so we don't have to use require() (not
// available in browser env) and don't have to fight vi.hoisted's sync
// factory restriction with svelte/store's ESM.
const mocks = vi.hoisted(() => {
	const subs = new Set<(v: boolean) => void>();
	let value = false;
	return {
		needRefresh: {
			subscribe(fn: (v: boolean) => void) {
				subs.add(fn);
				fn(value);
				return () => subs.delete(fn);
			},
			set(v: boolean) {
				value = v;
				for (const fn of subs) fn(v);
			},
			update(updater: (v: boolean) => boolean) {
				value = updater(value);
				for (const fn of subs) fn(value);
			}
		},
		apply: vi.fn(async () => {})
	};
});
vi.mock('$lib/pwa/register', () => ({
	needRefresh: mocks.needRefresh,
	applyPendingUpdate: mocks.apply
}));

import UpdatePromptBanner from './UpdatePromptBanner.svelte';

describe('UpdatePromptBanner', () => {
	beforeEach(() => {
		mocks.needRefresh.set(false);
		mocks.apply.mockClear();
	});

	it('renders nothing while no update is pending', async () => {
		render(UpdatePromptBanner);
		// Banner uses role="status" on its container; absence is the
		// contract on the happy path.
		await expect.element(page.getByRole('status')).not.toBeInTheDocument();
	});

	it('appears once needRefresh flips to true', async () => {
		render(UpdatePromptBanner);
		mocks.needRefresh.set(true);
		await expect.element(page.getByRole('status')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /reload/i })).toBeInTheDocument();
	});

	it('dismiss button hides the banner without applying the update', async () => {
		render(UpdatePromptBanner);
		mocks.needRefresh.set(true);
		await expect.element(page.getByRole('status')).toBeInTheDocument();

		await page.getByRole('button', { name: /dismiss/i }).click();
		await expect.element(page.getByRole('status')).not.toBeInTheDocument();
		expect(mocks.apply).not.toHaveBeenCalled();
	});

	it('reload button invokes applyPendingUpdate with the current href', async () => {
		render(UpdatePromptBanner);
		mocks.needRefresh.set(true);
		await page.getByRole('button', { name: /reload/i }).click();
		expect(mocks.apply).toHaveBeenCalledTimes(1);
		expect(mocks.apply).toHaveBeenCalledWith(window.location.href);
	});
});
