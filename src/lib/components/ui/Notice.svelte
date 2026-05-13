<!--
  Notice — inline status banner for form errors, save failures, retryable
  warnings, and friendly heads-up messages. Sits inline above an input or
  beneath a section header. Use Card (tone='danger') instead for full
  destructive zones; this is for short messages, not surfaces.

  Tones (matched to daisyUI semantic colors so they re-skin with the theme):
    - error    bg-error/10, border-error/30, text-error  (default)
    - warning  bg-warning/10, border-warning/30, text-warning-content
    - info     bg-info/10, border-info/30, text-info-content
    - success  bg-success/10, border-success/30, text-success-content

  Sizes:
    - sm  py-2 px-3 text-xs   (dense forms)
    - md  py-2.5 px-3 text-sm (default)

  Props:
    - tone     'error' | 'warning' | 'info' | 'success'  (default 'error')
    - size     'sm' | 'md'                                (default 'md')
    - role     'alert' | 'status'                         (default 'alert')
    - class    extra className passthrough
    - children snippet — message body
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'error' | 'warning' | 'info' | 'success';
	type Size = 'sm' | 'md';

	interface Props {
		tone?: Tone;
		size?: Size;
		role?: 'alert' | 'status';
		class?: string;
		children: Snippet;
	}

	let {
		tone = 'error',
		size = 'md',
		role = 'alert',
		class: className = '',
		children
	}: Props = $props();

	const toneClass = $derived(
		{
			error: 'bg-error/10 border-error/30 text-error',
			warning: 'bg-warning/15 border-warning/40 text-warning-content',
			info: 'bg-info/10 border-info/30 text-info-content',
			success: 'bg-success/10 border-success/30 text-success-content'
		}[tone]
	);

	const sizeClass = $derived(
		{
			sm: 'px-3 py-2 text-xs',
			md: 'px-3 py-2.5 text-sm'
		}[size]
	);
</script>

<div {role} class="rounded-[var(--radius-field)] border {toneClass} {sizeClass} {className}">
	{@render children()}
</div>
