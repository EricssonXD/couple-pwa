<!--
  Push notification CTA (N1). Lives in /settings under the existing
  "ghost" / theme controls. Never auto-prompts — the toggle calls
  Notification.requestPermission() inside a user gesture (required by
  Safari) and, on grant, posts the subscription to /api/push/subscribe.

  N4 will layer on iOS-standalone detection and the
  "Add to Home Screen first" hint.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { detectSupport, disablePush, enablePush, getCurrentSubscription } from '$lib/client/push';

	let supported = $state(true);
	let permission = $state<NotificationPermission | 'unknown'>('unknown');
	let subscribed = $state(false);
	let busy = $state(false);
	let message = $state<string | null>(null);

	onMount(async () => {
		const s = detectSupport();
		if (s.kind !== 'supported') {
			supported = false;
			return;
		}
		permission = Notification.permission;
		const sub = await getCurrentSubscription();
		subscribed = !!sub;
	});

	async function onToggle(next: boolean) {
		if (busy) return;
		busy = true;
		message = null;
		try {
			if (next) {
				const r = await enablePush();
				if (r.ok) {
					subscribed = true;
					permission = 'granted';
				} else if (r.reason === 'denied') {
					permission = 'denied';
					message = 'Notification permission was denied.';
				} else if (r.reason === 'no_key') {
					message = 'Push is not configured on this server yet.';
				} else if (r.reason === 'unsupported') {
					supported = false;
				} else {
					message = 'Could not enable notifications. Try again later.';
				}
			} else {
				await disablePush();
				subscribed = false;
			}
		} finally {
			busy = false;
		}
	}
</script>

{#if supported}
	<div class="space-y-2 rounded-lg border border-base-300 p-4">
		<div class="flex items-center justify-between gap-3">
			<div>
				<div class="font-medium">Push notifications</div>
				<div class="text-xs opacity-70">
					Get a quiet ping when your partner arrives somewhere or drops a moment near you.
				</div>
			</div>
			<Toggle
				checked={subscribed}
				disabled={busy || permission === 'denied'}
				onchange={(v) => onToggle(v)}
			/>
		</div>
		{#if permission === 'denied'}
			<p class="text-xs text-warning">
				Notifications are blocked in your browser settings. Re-enable them there first.
			</p>
		{/if}
		{#if message}
			<p class="text-xs opacity-80">{message}</p>
		{/if}
	</div>
{/if}
