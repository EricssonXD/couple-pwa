// Shared types for the F11 Setlog-style hour pager. Centralised here
// so both `.svelte` components and pure `.ts` helpers can import them
// without depending on a Svelte component module surface.

export type Mood = 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';

export interface TileClip {
	id: string;
	mime: string;
	playbackUrl: string;
	caption?: string | null;
}

export interface PagerCell {
	hourBucket: string;
	clip: TileClip | null;
	mood: Mood | null;
}
