/**
 * DuoSync domain components — barrel export.
 *
 * These are the brand-shaped, opinionated pieces that compose the
 * DuoSync experience. They depend on UI primitives (`$lib/components/ui`),
 * motion (`$lib/motion`), and design tokens (`src/routes/layout.css`).
 *
 * Routes import from this barrel:
 *   import { DistanceBubble, HeartbeatZone } from '$lib/components/duosync';
 */

export { default as DistanceBubble } from './DistanceBubble.svelte';
export { default as HeartbeatZone } from './HeartbeatZone.svelte';
export { default as PartnerAvatar } from './PartnerAvatar.svelte';
export { default as MoodWeather } from './MoodWeather.svelte';
export type Mood = 'sunny' | 'cloudy' | 'rainy' | 'night';
export { default as AnniversaryRibbon } from './AnniversaryRibbon.svelte';
export { default as GhostBanner } from './GhostBanner.svelte';
export { default as MomentCard } from './MomentCard.svelte';
export { default as BottomNav } from './BottomNav.svelte';
export { default as MemoryResurface } from './MemoryResurface.svelte';
export { default as IosInstallSheet } from './IosInstallSheet.svelte';
