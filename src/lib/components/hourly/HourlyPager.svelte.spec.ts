import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HourlyPager from './HourlyPager.svelte';
import { currentBucket, prevHour, nextHour } from '$lib/hourly/dayNav';

describe('HourlyPager', () => {
	it('disables next-hour button on the current hour', async () => {
		render(HourlyPager, {
			selectedBucket: currentBucket(),
			youCells: {},
			partnerCells: {},
			onselect: () => {}
		});
		const next = page.getByRole('button', { name: /next hour/i });
		await expect.element(next).toBeDisabled();
	});

	it('calls onselect with previous hour when prev clicked', async () => {
		const onselect = vi.fn();
		const sel = currentBucket();
		render(HourlyPager, {
			selectedBucket: sel,
			youCells: {},
			partnerCells: {},
			onselect
		});
		await page.getByRole('button', { name: /previous hour/i }).click();
		expect(onselect).toHaveBeenCalledWith(prevHour(sel));
	});

	it('calls onselect with next hour when navigating from a past hour', async () => {
		const onselect = vi.fn();
		const sel = prevHour(currentBucket());
		render(HourlyPager, {
			selectedBucket: sel,
			youCells: {},
			partnerCells: {},
			onselect
		});
		await page.getByRole('button', { name: /next hour/i }).click();
		expect(onselect).toHaveBeenCalledWith(nextHour(sel));
	});

	it('shows "Today" jump chip on a past hour', async () => {
		render(HourlyPager, {
			selectedBucket: prevHour(currentBucket()),
			youCells: {},
			partnerCells: {},
			onselect: () => {}
		});
		await expect.element(page.getByRole('button', { name: /today/i })).toBeVisible();
	});
});
