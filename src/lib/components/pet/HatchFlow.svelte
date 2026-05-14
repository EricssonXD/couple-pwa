<!--
  HatchFlow — first-visit wizard for couples without a pet yet.

  Two short steps on one screen so neither partner has to scroll-search
  for the CTA:
    1. Pick species (4 ChoiceChips in 2×2 grid, with the egg sprite
       previewed in each chip).
    2. Name the egg (InputField, 24-char cap from NAME_MAX).

  Purely presentational — parent owns the POST /api/pet/hatch fetch and
  the loading / error states.

  Props:
    - submitting   boolean — disables CTA + shows spinner
    - error        string | null — shown above the CTA via Notice
    - onSubmit     ({ species, name }) => void
-->
<script lang="ts">
	import { SPECIES, NAME_MAX, type Species } from '$lib/pet.constants';
	import Card from '$lib/components/ui/Card.svelte';
	import ChoiceChip from '$lib/components/ui/ChoiceChip.svelte';
	import InputField from '$lib/components/ui/InputField.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import Notice from '$lib/components/ui/Notice.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import PetSprite from './PetSprite.svelte';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		submitting?: boolean;
		error?: string | null;
		onSubmit: (args: { species: Species; name: string }) => void;
	}

	let { submitting = false, error = null, onSubmit }: Props = $props();

	let species = $state<Species>('fox');
	let name = $state('');

	const trimmed = $derived(name.trim());
	const valid = $derived(trimmed.length >= 1 && trimmed.length <= NAME_MAX);

	const SPECIES_LABEL: Record<Species, () => string> = {
		fox: m.pet_species_fox,
		cat: m.pet_species_cat,
		bird: m.pet_species_bird,
		capybara: m.pet_species_capybara
	};

	function submit() {
		if (!valid || submitting) return;
		onSubmit({ species, name: trimmed });
	}
</script>

<Card padding="lg" class="space-y-6">
	<header class="space-y-1">
		<h2 class="text-lg font-semibold">{m.pet_hatch_title()}</h2>
		<p class="text-sm text-base-content/70">{m.pet_hatch_subtitle()}</p>
	</header>

	<section aria-labelledby="pet-hatch-species" class="space-y-3">
		<h3
			id="pet-hatch-species"
			class="text-[11px] font-semibold tracking-wider text-base-content/60 uppercase"
		>
			{m.pet_hatch_pick_species()}
		</h3>
		<div class="grid grid-cols-2 gap-2">
			{#each SPECIES as sp (sp)}
				<ChoiceChip selected={species === sp} onclick={() => (species = sp)}>
					<span class="flex flex-col items-center gap-2">
						<PetSprite species={sp} stage="egg" mood={80} size={56} />
						<span>{SPECIES_LABEL[sp]()}</span>
					</span>
				</ChoiceChip>
			{/each}
		</div>
	</section>

	<section aria-labelledby="pet-hatch-name" class="space-y-2">
		<label
			for="pet-hatch-name-input"
			id="pet-hatch-name"
			class="block text-[11px] font-semibold tracking-wider text-base-content/60 uppercase"
		>
			{m.pet_hatch_name_label()}
		</label>
		<InputField
			id="pet-hatch-name-input"
			bind:value={name}
			maxlength={NAME_MAX}
			placeholder={m.pet_hatch_name_placeholder()}
			autocomplete="off"
		/>
		<p class="text-[11px] text-base-content/50 tabular-nums">{trimmed.length}/{NAME_MAX}</p>
	</section>

	{#if error}
		<Notice tone="error">{error}</Notice>
	{/if}

	<PillButton variant="primary" size="lg" block disabled={!valid || submitting} onclick={submit}>
		{#if submitting}
			<Spinner />
		{/if}
		{m.pet_hatch_cta()}
	</PillButton>
</Card>
