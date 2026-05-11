// Pre-paint redirect for `/` and `/welcome`. Loaded synchronously from
// app.html so it runs before the body parses — even when the SW serves
// cached HTML offline, a signed-in user never sees a flash of the
// anonymous welcome page (or a redirect-bounce off `/`).
//
// Routing matrix, by `ds_auth` cookie value:
//   path \ cookie  | (none)        | onboarding   | pulse / "1"
//   ---------------+---------------+--------------+--------------
//   /              | /welcome      | /onboarding  | /pulse
//   /welcome       | (stay)        | /onboarding  | /pulse
//
// The cookie is set + cleared by hooks.server.ts; client-readable but
// holds NO secrets — purely a routing flag. Treats any unknown cookie
// value as "no session" so a corrupt value can't strand a real user.
(function () {
	var path = location.pathname;
	if (path !== '/' && path !== '/welcome') return;

	var match = document.cookie.match(/(?:^|;\s*)ds_auth=([^;]+)/);
	var hint = match ? match[1] : null;
	var dest = null;

	if (hint === 'onboarding') {
		dest = '/onboarding';
	} else if (hint === 'pulse' || hint === '1') {
		dest = '/pulse';
	} else if (path === '/') {
		// Anonymous root visitor — push them to the marketing page.
		dest = '/welcome';
	}

	// Skip the redirect if it would be a no-op (e.g. anonymous user
	// already at /welcome). Use replace() so the stub URL doesn't end
	// up in the back-stack.
	if (dest && dest !== path) location.replace(dest);
})();
