// The offline page must be statically prerenderable so the service worker can
// cache its HTML at install time and serve it without hitting the network.
export const prerender = true;
export const ssr = true;
