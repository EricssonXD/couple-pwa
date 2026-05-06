// Add-to-home-screen prompt helper. Captures the `beforeinstallprompt` event on
// Chromium-based browsers so the UI can offer an install button at a chosen
// moment (rather than the browser's default mini-infobar).
//
// On iOS Safari there is no programmatic install prompt; UI should detect
// `isIosSafari()` and show a hint to use Share → Add to Home Screen instead.

interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function initInstallPrompt(): void {
	if (typeof window === 'undefined') return;
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
	});
	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
	});
}

export function canInstall(): boolean {
	return deferredPrompt !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	if (!deferredPrompt) return 'unavailable';
	await deferredPrompt.prompt();
	const choice = await deferredPrompt.userChoice;
	deferredPrompt = null;
	return choice.outcome;
}

export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(window.navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

export function isIosSafari(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	const isIos =
		/iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
	const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
	return isIos && isSafari;
}
