<!--
  /pet — habitat / hatch screen.

  Reads initial snapshot from +page.server.ts (loadCoupleAnyStatus +
  getPetState). Then on the client:
    - if snapshot.pet === null → render <HatchFlow>; on submit POST
      /api/pet/hatch and replace the snapshot.
    - else → habitat: large <PetSprite>, name (with rename inline),
      <MoodHungerBars>, coin balance, equipped chips, and a
      placeholder shop card (Phase 4 will wire real items).
  A 30 s $effect re-projects mood/hunger decay locally using
  projectDecay() so the bars feel alive between reloads. Realtime
  pet_state_changed broadcasts will replace the snapshot on the
  next phase; this page already tolerates that by re-deriving from
  `snapshot`.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { PetSprite, MoodHungerBars, HatchFlow, CoinIcon } from '$lib/components/pet';
	import { projectDecay, type PetSnapshot, type Species } from '$lib/pet.constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let snapshot = $state<PetSnapshot>(untrack(() => data.snapshot));

	// Local decayed mood/hunger so bars drift between server polls.
	let liveMood = $state(untrack(() => data.snapshot.pet?.mood ?? 0));
	let liveHunger = $state(untrack(() => data.snapshot.pet?.hunger ?? 0));

	function reproject() {
		const p = snapshot.pet;
		if (!p) return;
		const out = projectDecay(
			{
				mood: p.mood,
				hunger: p.hunger,
				moodUpdatedAt: new Date(p.moodUpdatedAt),
				hungerUpdatedAt: new Date(p.hungerUpdatedAt)
			},
			new Date()
		);
		liveMood = out.mood;
		liveHunger = out.hunger;
	}

	$effect(() => {
		reproject();
	});

	const tickTimer = setInterval(reproject, 30_000);
	onDestroy(() => clearInterval(tickTimer));

	// Hatch flow ----------------------------------------------------------
	let hatching = $state(false);
	let hatchError = $state<string | null>(null);

	async function onHatch(payload: { species: Species; name: string }) {
		hatching = true;
		hatchError = null;
		try {
			const res = await fetch('/api/pet/hatch', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				hatchError = body.message ?? 'Could not hatch right now.';
				return;
			}
			snapshot = (await res.json()) as PetSnapshot;
		} catch {
			hatchError = 'Network hiccup — try again.';
		} finally {
			hatching = false;
		}
	}

	// Rename --------------------------------------------------------------
	let renaming = $state(false);
	let renameValue = $state('');
	let renameError = $state<string | null>(null);
	let renameSubmitting = $state(false);

	function startRename() {
		renameValue = snapshot.pet?.name ?? '';
		renameError = null;
		renaming = true;
	}

	async function submitRename() {
		renameSubmitting = true;
		renameError = null;
		try {
			const res = await fetch('/api/pet', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: renameValue })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				renameError = body.message ?? 'Could not rename.';
				return;
			}
			snapshot = (await res.json()) as PetSnapshot;
			renaming = false;
		} catch {
			renameError = 'Network hiccup — try again.';
		} finally {
			renameSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.pet_title()} · DuoSync</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-md px-4 pt-6 pb-32">
	<header class="mb-6 flex items-center justify-between">
		<a
			href={resolve('/pulse')}
			class="text-sm font-semibold text-base-content/60 transition hover:text-base-content"
		>
			← {m.pulse_title()}
		</a>
		<div
			class="inline-flex items-center gap-1 rounded-full bg-base-200 px-3 py-1 text-sm font-semibold tabular-nums"
		>
			<CoinIcon size={14} />
			<span>{snapshot.wallet.coins}</span>
		</div>
	</header>

	{#if snapshot.welcomeBack}
		<Notice tone="success" class="mb-4">{m.pet_welcome_back()}</Notice>
	{/if}

	{#if !snapshot.pet}
		<HatchFlow submitting={hatching} error={hatchError} onSubmit={onHatch} />
	{:else}
		{@const p = snapshot.pet}
		<section class="flex flex-col items-center gap-3">
			<PetSprite species={p.species} stage={p.stage} mood={liveMood} size={160} />
			{#if !renaming}
				<div class="flex items-center gap-2">
					<h1 class="text-2xl font-semibold tracking-tight">{p.name}</h1>
					<button
						type="button"
						class="text-xs font-semibold text-base-content/60 underline-offset-2 hover:underline"
						onclick={startRename}
					>
						{m.pet_rename_button()}
					</button>
				</div>
			{:else}
				<form
					class="flex w-full max-w-xs flex-col gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						void submitRename();
					}}
				>
					<label class="flex flex-col gap-1.5 text-left">
						<span class="text-xs font-semibold tracking-wider text-base-content/60 uppercase"
							>{m.pet_hatch_name_label()}</span
						>
						<InputField bind:value={renameValue} maxlength={24} disabled={renameSubmitting} />
					</label>
					{#if renameError}
						<Notice tone="error">{renameError}</Notice>
					{/if}
					<div class="flex justify-end gap-2">
						<PillButton
							variant="subtle"
							size="sm"
							onclick={() => (renaming = false)}
							disabled={renameSubmitting}
						>
							{m.pet_rename_cancel()}
						</PillButton>
						<PillButton type="submit" size="sm" disabled={renameSubmitting}>
							{#if renameSubmitting}<Spinner size={14} />{/if}
							{m.pet_rename_save()}
						</PillButton>
					</div>
				</form>
			{/if}
			<p class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
				{p.stage === 'egg'
					? m.pet_stage_egg()
					: p.stage === 'baby'
						? m.pet_stage_baby()
						: m.pet_stage_grown()}
				· {m.pet_xp_label({ xp: p.xp })}
			</p>
		</section>

		<section class="mt-6">
			<MoodHungerBars mood={liveMood} hunger={liveHunger} />
		</section>

		<section class="mt-6">
			<Card padding="md">
				<p class="text-sm leading-relaxed text-base-content/70">
					{m.pet_shop_coming_soon()}
				</p>
			</Card>
		</section>
	{/if}
</main>
