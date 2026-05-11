<!--
  Push notification CTA (N1 + N4). Lives in /settings under the existing
  "ghost" / theme controls. Never auto-prompts — the toggle calls
  Notification.requestPermission() inside a user gesture (required by
  Safari) and, on grant, posts the subscription to /api/push/subscribe.

  iOS-specific UX (N4): if we detect iOS without standalone-mode, we
  swap the toggle for an "Add to Home Screen first" hint instead of
  letting the user tap a control that will silently fail.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { detectSupport, disablePush, enablePush, getCurrentSubscription } from '$lib/client/push';
	import { detectPlatform, iosPushEligibility, type PlatformInfo } from '$lib/client/platform';

	let supported = $state(true);
	let permission = $state<NotificationPermission | 'unknown'>('unknown');
	let subscribed = $state(false);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let platform = $state<PlatformInfo>({
		isIOS: false,
		isIPadOS: false,
		isStandalone: false,
		iosVersion: null
	});

	let iosBlock = $derived.by(() => {
		if (!platform.isIOS) return null;
		const r = iosPushEligibility(platform);
		return r.ok ? null : r.reason;
	});

	onMount(async () => {
		platform = detectPlatform();
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
			{#if iosBlock === 'not_standalone' || iosBlock === 'too_old'}
				<span class="text-xs opacity-60">iOS setup required</span>
			{:else}
				<Toggle
					checked={subscribed}
					disabled={busy || permission === 'denied'}
					onchange={(v) => onToggle(v)}
				/>
			{/if}
		</div>
		{#if iosBlock === 'not_standalone'}
			<div class="rounded-md bg-base-200 p-3 text-xs">
				<p class="mb-1 font-medium">Add DuoSync to your Home Screen first</p>
				<ol class="list-decimal space-y-0.5 pl-4 opacity-80">
					<li>Tap the Share button in Safari.</li>
					<li>Choose <span class="font-medium">Add to Home Screen</span>.</li>
					<li>Open DuoSync from the new icon, then come back here.</li>
				</ol>
				<p class="mt-2 opacity-70">iOS only delivers push to installed PWAs (16.4+).</p>
			</div>
		{:else if iosBlock === 'too_old'}
			<p class="text-xs text-warning">
				Push needs iOS 16.4 or newer. Update iOS in Settings → General → Software Update.
			</p>
		{:else if permission === 'denied'}
			<p class="text-xs text-warning">
				Notifications are blocked in your browser settings. Re-enable them there first.
			</p>
		{/if}
		{#if message}
			<p class="text-xs opacity-80">{message}</p>
		{/if}
	</div>
{/if}
