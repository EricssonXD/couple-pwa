-- DuoSync — Daily Question seed prompts (M8).
--
-- Idempotent: each prompt is identified by a stable hash of prompt_en
-- via ON CONFLICT DO NOTHING using a unique partial expression.
--
-- We don't want to add a unique constraint on the catalog text (free-form),
-- so we use a guard table to track which seeds have been applied.

create table if not exists public._seed_marker (
	key text primary key,
	applied_at timestamptz not null default now()
);

do $$
declare
	prompts text[][] := array[
		array['What''s one small thing I did this week that made you smile?', '本週我做的哪件小事令你會心一笑？'],
		array['If we had a free Sunday tomorrow, how would you want to spend it together?', '若明日是空白的星期日，你想怎樣與我共度？'],
		array['What''s a place you''d love to visit with me one day?', '有哪個地方，你想有一天與我同往？'],
		array['Describe today in three words.', '用三個字描述今天。'],
		array['What''s something you''re looking forward to this month?', '本月你最期待甚麼？'],
		array['What''s one thing I could do more of for you?', '我可以為你多做哪一件事？'],
		array['Share a memory of us that''s been on your mind lately.', '近來常想起的我們的回憶是哪一段？'],
		array['What made you laugh today?', '今日令你發笑的是甚麼？'],
		array['What''s something you''re proud of yourself for this week?', '本週你最為自己驕傲的是甚麼？'],
		array['If you could relive one day with me, which would it be?', '若可重活一天與我，你選哪一天？'],
		array['What''s a song that reminds you of us?', '哪首歌會令你想起我們？'],
		array['What''s one thing you wish I knew about you?', '你最希望我知道你的甚麼？'],
		array['What''s your favorite small ritual we share?', '我們之間哪個小儀式是你最愛？'],
		array['How are you really, today?', '今日你真實的感受是？'],
		array['What''s a worry you''re carrying right now?', '此刻你心中的憂慮是？'],
		array['What''s something kind someone did for you recently?', '近來誰對你做過甚麼貼心的事？'],
		array['If you had one extra hour today, how would you use it?', '若今天多一小時，你想做甚麼？'],
		array['What''s a dream you haven''t told me about yet?', '有甚麼夢想你還未告訴我？'],
		array['What does feeling loved look like to you this week?', '本週對你而言，被愛是甚麼模樣？'],
		array['What''s something you appreciated about me today?', '今日你對我感激的是甚麼？'],
		array['What was the best part of your day?', '今天最好的部分是？'],
		array['What was the hardest part of your day?', '今天最難的部分是？'],
		array['What''s a habit you''d like us to build together?', '你想我們一起培養甚麼習慣？'],
		array['What food would you most want to share with me right now?', '此刻你最想與我分享甚麼食物？'],
		array['What''s a question you''ve been wanting to ask me?', '有哪條問題你一直想問我？'],
		array['What''s a sound from today that stuck with you?', '今天哪個聲音留在你心？'],
		array['What''s a small win you had this week?', '本週你有哪件小成就？'],
		array['Who in your life are you grateful for today, besides me?', '今天除了我，你還感激誰？'],
		array['What''s a way I can support you tomorrow?', '明天我可以怎樣支持你？'],
		array['What''s something silly you remembered recently?', '近來想起甚麼傻事？'],
		array['What season fits us best, and why?', '哪個季節最像我們？為何？'],
		array['What''s one thing you''d change about today if you could?', '今天若可改一事，你會改甚麼？'],
		array['Describe me using a kind of weather.', '用一種天氣形容我。'],
		array['What''s something small you find beautiful?', '哪些小事物令你覺得美？'],
		array['What''s one thing you wish we did more often?', '有甚麼事你希望我們多做？'],
		array['What''s a kindness you witnessed today?', '今日你見證了甚麼善意？'],
		array['What''s a flavor that takes you back somewhere?', '哪種味道會把你帶回某處？'],
		array['When did you last feel completely calm?', '你上次完全平靜是何時？'],
		array['If our day had a soundtrack, what would today''s song be?', '若今日有主題曲，會是哪首？'],
		array['What''s something you forgive yourself for today?', '今日你原諒自己甚麼？'],
		array['What part of our home do you love most?', '我們家中哪一處你最愛？'],
		array['Pick a color for our day. Why that one?', '為我們的一天選個顏色，為何選這個？'],
		array['What''s a tiny adventure we could try this week?', '本週我們可作甚麼小冒險？'],
		array['Tell me about a stranger you noticed today.', '今天注意到的陌生人是？'],
		array['What''s a smell that means home to you?', '哪種氣味對你而言是家？'],
		array['What''s a story from your childhood I haven''t heard yet?', '有哪個童年故事我未聽過？'],
		array['What gives you energy lately? What drains it?', '近來甚麼給你能量？甚麼耗去？'],
		array['What does rest look like to you these days?', '近來休息對你而言是甚麼樣子？'],
		array['What''s something you''re curious about right now?', '此刻你對甚麼好奇？'],
		array['How do you want to feel by the end of this week?', '本週末你想感受到甚麼？'],
		array['Pick a word for us this month.', '為我們本月選一個字。'],
		array['What was a turning point this year, even a small one?', '今年的轉捩點是甚麼，哪怕很小？'],
		array['What''s a tradition you''d like us to start?', '你想我們開始甚麼傳統？'],
		array['What''s the bravest thing you did this month?', '本月你做過最勇敢的事是？'],
		array['What''s something I do that makes you feel safe?', '我做甚麼會令你覺得安全？'],
		array['What does your perfect morning look like?', '你心中的完美早晨是甚麼樣子？'],
		array['What does your perfect evening look like?', '你心中的完美晚上是甚麼樣子？'],
		array['Tell me one thing that''s been on your mind today.', '告訴我今日一直放在心上的一件事。'],
		array['What''s a question you''re sitting with right now?', '近來你心中盤旋的是哪條問題？'],
		array['How would you describe us to a stranger?', '若向陌生人形容我們，你會怎麼說？']
	];
	row text[];
begin
	if not exists (select 1 from public._seed_marker where key = 'daily_question_v1') then
		foreach row slice 1 in array prompts loop
			insert into public.daily_question (prompt_en, prompt_zh)
			values (row[1], row[2]);
		end loop;
		insert into public._seed_marker (key) values ('daily_question_v1');
	end if;
end$$;
