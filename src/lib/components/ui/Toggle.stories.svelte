<!--
  Toggle stories — U9 baseline.

  bits-ui Switch wrapper. Stories cover bare switch, label only, label
  + hint, disabled, and the checked variant.
-->
<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Toggle from './Toggle.svelte';

	const { Story } = defineMeta({
		title: 'UI/Toggle',
		component: Toggle,
		tags: ['autodocs']
	});
</script>

<Story name="Off" args={{ checked: false }} />
<Story name="On" args={{ checked: true }} />
<Story name="WithLabel" args={{ checked: false, label: 'Notifications' }} />
<Story
	name="WithLabelAndHint"
	args={{ checked: true, label: 'Ghost mode', hint: '隱身 15 分鐘' }}
/>
<Story name="Disabled" args={{ checked: false, label: 'Sync', disabled: true }} />
<Story name="DisabledOn" args={{ checked: true, label: 'Sync', disabled: true }} />
