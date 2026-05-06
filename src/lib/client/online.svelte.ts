// Reactive online/offline indicator. Returns a $state object with a single
// boolean property `online` that updates as the browser fires events.

import { onMount } from 'svelte';

export function createOnlineStatus() {
	let online = $state(true);

	onMount(() => {
		online = navigator.onLine;
		const on = () => (online = true);
		const off = () => (online = false);
		addEventListener('online', on);
		addEventListener('offline', off);
		return () => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
		};
	});

	return {
		get online() {
			return online;
		}
	};
}
