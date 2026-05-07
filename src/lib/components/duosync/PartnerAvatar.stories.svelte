<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PartnerAvatar from './PartnerAvatar.svelte';

	const { Story } = defineMeta({
		title: 'DuoSync/PartnerAvatar',
		component: PartnerAvatar,
		tags: ['autodocs']
	});
</script>

<Story
	name="Online"
	args={{ displayName: 'Mira', avatarEmoji: '🌸', presence: 'online', batteryPct: 78 }}
/>
<Story
	name="LowBattery"
	args={{ displayName: 'Mira', avatarEmoji: '🌸', presence: 'online', batteryPct: 12 }}
/>
<Story
	name="Charging"
	args={{
		displayName: 'Mira',
		avatarEmoji: '🌸',
		presence: 'online',
		batteryPct: 45,
		charging: true
	}}
/>
<Story
	name="Ghost"
	args={{ displayName: 'Mira', avatarEmoji: '🌸', presence: 'ghost', batteryPct: null }}
/>
<Story
	name="Offline"
	args={{ displayName: 'Mira', avatarEmoji: '🌸', presence: 'offline', batteryPct: null }}
/>
