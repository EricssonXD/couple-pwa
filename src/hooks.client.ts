import type { HandleClientError } from '@sveltejs/kit';
import { report } from '$lib/error-reporter';

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	const { id, message: safe } = report(error, {
		side: 'client',
		url: event.url.pathname + event.url.search,
		route: event.route?.id ?? null,
		status,
		message
	});
	return { message: safe, errorId: id };
};
