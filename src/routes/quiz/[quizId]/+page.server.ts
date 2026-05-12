import { error, redirect } from '@sveltejs/kit';
import { loadQuiz, QuizValidationError } from '$lib/server/services/quiz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, params }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	try {
		const pack = await loadQuiz(params.quizId, fetch);
		// Hand the client the pack metadata only — questions live in the
		// runner page so this overview stays light.
		return {
			pack: {
				id: pack.id,
				title: pack.title,
				description: pack.description,
				questionCount: pack.questions.length
			}
		};
	} catch (e) {
		if (e instanceof QuizValidationError) error(404, e.code);
		throw e;
	}
};
