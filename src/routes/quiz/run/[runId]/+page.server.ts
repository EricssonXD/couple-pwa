import { error, redirect } from '@sveltejs/kit';
import { getProjectedRun, loadQuiz, QuizValidationError } from '$lib/server/services/quiz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, params }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	try {
		const run = await getProjectedRun({
			runId: params.runId,
			coupleId: locals.couple.id,
			viewerId: locals.user.id
		});
		// If the run is fully complete, send them straight to the reveal.
		if (run.reveal) redirect(303, `/quiz/run/${run.id}/results`);
		const pack = await loadQuiz(run.quizId, fetch);
		return { run, pack };
	} catch (e) {
		if (e instanceof QuizValidationError) error(404, e.code);
		throw e;
	}
};
