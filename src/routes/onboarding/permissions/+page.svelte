<!--
  /onboarding/permissions — third onboarding step.

  Runs after the user has paired with their partner, before they land
  on /pulse for the first time. Walks them through the two
  permissions DuoSync actually needs:

    1. Geolocation — for the live pulse map.
    2. Notifications — so the partner's pings can ping back.

  Both are *optional*. Skipping just leaves the toggles in /settings
  for later. The page is idempotent — refreshing reflects whatever
  state the browser is in. We mark `duosync.onboarded.perms=1` in
  localStorage on Continue so we don't loop the user back here on
  every visit.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import MapPinIcon from 'phosphor-svelte/lib/MapPinIcon';
	import BellIcon from 'phosphor-svelte/lib/BellIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import { enablePush } from '$lib/client/push';

	let geoState = $state<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
	let pushState = $state<'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported'>('idle');
	let busy = $state(false);

	async function askGeolocation() {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			geoState = 'denied';
			return;
		}
		geoState = 'requesting';
		await new Promise<void>((res) => {
			navigator.geolocation.getCurrentPosition(
				() => {
					geoState = 'granted';
					res();
				},
				() => {
					geoState = 'denied';
					res();
				},
				{ enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
			);
		});
	}

	async function askPush() {
		pushState = 'requesting';
		const result = await enablePush();
		if (result.ok) {
			pushState = 'granted';
		} else if (result.reason === 'unsupported') {
			pushState = 'unsupported';
		} else {
			pushState = 'denied';
		}
	}

	async function finish() {
		busy = true;
		try {
			localStorage.setItem('duosync.onboarded.perms', '1');
		} catch {
			// private mode — fine, we just won't remember.
		}
		await goto(resolve('/pulse'), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>{m.onboarding_perms_title()} · DuoSync</title>
</svelte:head>

<main class="min-h-screen bg-base-100 px-5 py-10">
	<section class="mx-auto flex w-full max-w-md flex-col gap-6">
		<header class="space-y-2 text-center">
			<h1 class="text-display text-3xl tracking-tight">{m.onboarding_perms_title()}</h1>
			<p class="text-sm text-base-content/70">{m.onboarding_perms_intro()}</p>
		</header>

		<div class="space-y-4">
			<div class="rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 p-4">
				<div class="flex items-start gap-3">
					<Icon icon={MapPinIcon} size={20} weight="duotone" class="mt-0.5 text-primary" />
					<div class="flex-1">
						<h2 class="font-semibold">{m.onboarding_perms_geo_title()}</h2>
						<p class="mt-1 text-xs text-base-content/70">{m.onboarding_perms_geo_body()}</p>
					</div>
					{#if geoState === 'granted'}
						<Icon icon={CheckCircleIcon} size={22} weight="fill" class="text-success" />
					{/if}
				</div>
				{#if geoState !== 'granted'}
					<PillButton
						variant="outline"
						block
						class="mt-3"
						onclick={askGeolocation}
						disabled={geoState === 'requesting'}
					>
						{geoState === 'requesting'
							? m.onboarding_perms_requesting()
							: geoState === 'denied'
								? m.onboarding_perms_geo_retry()
								: m.onboarding_perms_geo_btn()}
					</PillButton>
				{/if}
			</div>

			<div class="rounded-[var(--radius-card)] border border-base-content/10 bg-base-200 p-4">
				<div class="flex items-start gap-3">
					<Icon icon={BellIcon} size={20} weight="duotone" class="mt-0.5 text-primary" />
					<div class="flex-1">
						<h2 class="font-semibold">{m.onboarding_perms_push_title()}</h2>
						<p class="mt-1 text-xs text-base-content/70">{m.onboarding_perms_push_body()}</p>
					</div>
					{#if pushState === 'granted'}
						<Icon icon={CheckCircleIcon} size={22} weight="fill" class="text-success" />
					{/if}
				</div>
				{#if pushState !== 'granted' && pushState !== 'unsupported'}
					<PillButton
						variant="outline"
						block
						class="mt-3"
						onclick={askPush}
						disabled={pushState === 'requesting'}
					>
						{pushState === 'requesting'
							? m.onboarding_perms_requesting()
							: pushState === 'denied'
								? m.onboarding_perms_push_retry()
								: m.onboarding_perms_push_btn()}
					</PillButton>
				{/if}
				{#if pushState === 'unsupported'}
					<p class="mt-3 text-xs text-base-content/60">{m.onboarding_perms_push_unsupported()}</p>
				{/if}
			</div>
		</div>

		<PillButton size="lg" block onclick={finish} disabled={busy}>
			{m.onboarding_perms_continue()}
		</PillButton>
	</section>
</main>
