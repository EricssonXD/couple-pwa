import * as m from '$lib/paraglide/messages';

export type PetMoodState = 'fine' | 'peckish' | 'sleepy' | 'resting';

/**
 * Map (mood, hunger) → warm-decay state per pet-system.md §1.
 * Priority: resting (severe) → fine (good belly + good mood) → peckish (mid hunger) → sleepy (low mood).
 * Spec triggers — fine: mood ≥ 70 ∧ hunger ≤ 30 · peckish: hunger 30–60 ·
 * sleepy: mood 30–60 ∧ hunger ≤ 60 · resting (floor): mood ≤ 30 ∨ hunger ≥ 60.
 */
export function deriveMoodState(mood: number, hunger: number): PetMoodState {
	if (mood <= 30 || hunger >= 60) return 'resting';
	if (mood >= 70 && hunger <= 30) return 'fine';
	if (hunger >= 30) return 'peckish';
	return 'sleepy';
}

export function moodStateCopy(state: PetMoodState, name: string): string {
	switch (state) {
		case 'fine':
			return m.pet_state_fine({ name });
		case 'peckish':
			return m.pet_state_peckish({ name });
		case 'sleepy':
			return m.pet_state_sleepy({ name });
		case 'resting':
			return m.pet_state_resting({ name });
	}
}
