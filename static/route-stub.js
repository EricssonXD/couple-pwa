// Pre-paint redirect for `/`. Loaded synchronously from app.html so it
// runs before the body parses — even when the SW serves cached `/` HTML
// offline, the user never sees a flash of the wrong screen.
//   cookie missing      → /welcome  (cached marketing page)
//   cookie=onboarding   → /onboarding
//   cookie=pulse / "1"  → /pulse
// The cookie is set + cleared by hooks.server.ts; client-readable but
// holds NO secrets — it's purely a routing flag.
(function () {
	if (location.pathname !== '/') return;
	var m = document.cookie.match(/(?:^|;\s*)ds_auth=([^;]+)/);
	var dest;
	if (!m) dest = '/welcome';
	else if (m[1] === 'onboarding') dest = '/onboarding';
	else dest = '/pulse';
	location.replace(dest);
})();
