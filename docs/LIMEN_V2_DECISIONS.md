# Limen v2 decisions (2026-10-03)

This file records the product decisions from the October 2026 ethics and research review, and what this branch changed in code. Where this file and older docs (AGENTS.md history notes, FULL_APP_INVENTORY.md, PROGRESS.md) disagree, this file wins.

## The principles behind every change

1. Limen helps build adult friendship. It is not a friend-matching app modeled on dating apps.
2. Features reduce the challenges of building friendship. They don't remove them.
3. Features help people see the other person's perspective and get out of their own head.
4. AI assists. It never does what the humans are supposed to do.
5. AI never writes, rewrites, or polishes a message. Each message is a show of care and attention.
6. Limen is not meant to be convenient. It builds the "friendship muscle" for use inside and outside the app.

## 1. AI writing removed, replaced with reflection

**What changed**
- `supabase/functions/generate-reply-draft` is retired. It returns HTTP 410. It used to write ready-to-send first-person text for replies, Honest Exit, About You, Dealbreakers, and prompts.
- `supabase/functions/reflection-coach` is new. It has two modes:
  - `check`: the model returns codes only (`missed_point`, `no_question`, `boomerask`, `nothing_of_yours`, `depth_jump`, with a topic of at most 6 words). The server turns each code into a fixed observation sentence, so model text can never be pasted as a message.
  - `mirror` ("Another way to see it"): three short readings (their circumstances, how they might see you, your fear). Verdicts about the other person are filtered out, with an exception for safety. It always closes with: "You won't know until you ask. What would you want to ask them?"
- `src/components/universal-text-box.tsx` now shows "Reflect first" questions for each context (reply, profile, exit, plan), shows the other person's "How I like care" note when one exists, and offers "Check" observations. It is labeled "Reflection coach (AI). It never writes your messages." Credits and upgrade prompts are gone.
- Every caller is updated: reply assist, thread, Honest Exit (templates removed), meetup outcome, conversation-flow prompts, intervention cards ("Reflect, then reply"), follow-up reflection, activity suggestions (no AI message prefill), and profile build.
- Copy-paste is not policed. The app simply never offers AI writing.

**Why**
- AI-suggested replies make messages more positive, but people who are suspected of using AI are judged as less cooperative and less warm ([Hohenstein et al., 2023](https://www.nature.com/articles/s41598-023-30938-9)). AI-mediated writing also shifts what people say ([Jakesch et al., 2023](https://pubmed.ncbi.nlm.nih.gov/36881628/)).
- Recipients value effortful messages more ([Liu et al., 2023](https://www.sciencedaily.com/releases/2023/09/230911141009.htm)).
- Sycophantic AI makes users more convinced they are right and less willing to repair conflict, so the mirror does not side with the user ([Cheng et al., 2025](https://arxiv.org/abs/2510.01395)).
- Perspective-taking works best when people actually ask the other person, which is why every mirror reading ends by sending the user back to ask ([Eyal, Steffel & Epley, 2018](https://pubmed.ncbi.nlm.nih.gov/29620401/)).
- People see boomerasking (asking a question only to answer it yourself) as insincere ([Brooks & Yeomans](https://spiral.imperial.ac.uk/entities/publication/714aec36-1023-4cde-bedf-3de8da60f958)).

## 2. "How I like care"

- New field `profiles.care_style` (the user's own words, at most 400 characters), entered in Profile build under About you.
- It is shown only to people you are connected with, inside Reflect ("How they said they like care"), through the `get_connection_care_style` RPC. It is never used for matching.
- Why: feeling understood, cared for, and validated is the core of responsiveness ([Reis and colleagues; see Impett et al., 2024](https://journals.sagepub.com/doi/10.1177/09637214231217663)). Asking "how would they like to be responded to" is more accurate when based on what they actually said.

## 3. Discovery and capacity

- The Browse tab is hidden (`href: null` in `(tabs)/_layout.tsx`).
- Everyone gets 3 suggestions per rolling 7 days (`generate-match-suggestions`), and suggestions no longer cost credits.
- Capacity is flat for everyone: 3 active connections and 5 pending hellos. Graduated connections do not count toward the active cap.
- Why: more options lead to less satisfaction and lower commitment ([D'Angelo & Toma](https://news.wisc.edu/online-dating-study-shows-too-many-choices-can-lead-to-dissatisfaction/)). Friendship needs a lot of time together, roughly 94 hours to become casual friends and 164 hours to become friends ([Hall, 2019](https://journals.sagepub.com/doi/full/10.1177/0265407518761225)), so focus matters more than volume.

## 4. Graduation

Graduation now has one mechanism only: the Friendship Journey `graduation_checkpoint`, computed by `graduation_stage()`.

| Stage | Trigger | What happens |
|---|---|---|
| Ready check | At least 6 occurred meetups, the first at least 8 weeks ago, each person proposed at least 2 meetups, and a rhythm is set | Each person is asked privately, "Could you two keep this going outside Limen?" Options: Yes / Not yet / I'm not sure this is a friendship. Asked again after 28 days. |
| Mutual yes | Both answer Yes | The connection becomes `graduated` for both, and both see a graduation message. Neither person ever sees a non-matching answer. |
| Decision point | 10 meetups, or 6 months since the connection began | A choice is required: Graduate, Keep going here for now (with a private written reason), or Close this honestly (opens Honest Exit). Asked again every 60 days. |
| After graduation | 1 and 3 months later | The existing 30/90-day continuation check-ins. |

- The old `graduate_connection` RPC, which let one person graduate a connection alone, now requires both people to have answered Yes. The old `GraduationModal` path in the thread is disabled.
- Why: balanced give-and-take, where both people make plans, is a core ingredient of close bonds ([Social Connection Guidelines](https://www.socialconnectionguidelines.org/en/evidence-briefs/how-do-we-develop-close-social-bonds)). Friendships form over weeks to months ([Hall, 2019](https://journals.sagepub.com/doi/full/10.1177/0265407518761225)). The thresholds are judgment calls built around the founder's "10 meetups within 6 months" idea. Validate them with pilot data, for example by checking whether graduated pairs are still meeting at 3 months.
- Note: "since the connection began" uses `connections.created_at`.

## 5. Stories and curiosity

- **Stories:** `profiles.stories` holds up to 3 entries of `{prompt_key, text}`, each up to 1,200 characters. Users write them in their own words to character prompts (see `src/lib/stories.ts`). There is no AI writing. Reflect offers memory-jogging questions only. There is deliberately no "Ask me about..." hook.
- **Viewer rotation:** each viewer sees the stories in a different but stable order, so different readers start from different stories.
- **Curiosity notes:** while reading a profile, the reader can privately write "I wonder..." (stored in the `curiosity_notes` table, visible only to its author). The app asks, "Is this about a fact, or about them?" It never suggests the question.
- **Check observations in replies:** these cover boomerasking, not sharing anything of your own, not asking anything back, and jumping much deeper than either of you has shared.
- Why: curiosity creates closeness, even in small talk ([Kashdan et al., 2011](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-6494.2010.00697.x)), and it can be trained ([Schutte & Malouff, 2023](https://link.springer.com/article/10.1007/s12144-022-03107-w)). Curiosity starts with a gap the reader notices for themselves ([Loewenstein](https://www.cmu.edu/dietrich/sds/docs/loewenstein/Information%20Gaps%20published%20version.pdf)). That is why "Ask me about" fails: it fills the gap for every reader.

## 6. Monetization

- No Premium, no AI credits, no capacity for sale, no ads, and no venue, employer, or health-plan deals.
- The Premium screen (`src/app/premium.tsx`) is now "How Limen is paid for." Settings shows "Membership: Free during the pilot." The referral copy no longer promises Premium.
- Plan (`src/lib/monetization.ts`): start with a free pilot. Later, offer a pick-your-price Journey pass for about 6 months (Free with no questions asked, $18, $30 suggested, or $60 to cover you and one other person). It will need new non-renewing store products, which aren't built yet.
- Why: paying for more matches sells options instead of focus (see section 3). Pick-your-price with a social cause can work well ([Gneezy et al., 2010](https://pubmed.ncbi.nlm.nih.gov/20647467/)). Apple's Small Business Program lowers the store fee to 15% ([Apple](https://developer.apple.com/app-store/small-business-program/)).
- The legacy IAP code (`src/lib/ai-credits.ts`, `src/lib/premium.ts`, and receipt validation) is still in the repo but no longer reachable from the UI. Remove it in a later cleanup.

## 7. Not changed on purpose

- **Read receipts:** `read_at` is still never shown to the sender.

## 8. Still to build (deferred)

- The writer's private "what people asked you" view for Stories.
- "Wonder before meeting": two private curiosity notes before each meetup, and "Did you learn either?" afterward. The older pre-meetup curiosity prompts were removed earlier and are not restored here.
- Question-depth labels (fact / experience / meaning) in Check, plus "Follow the thread" when a reply arrives.
- A weekly curiosity practice outside the app.
- Store products for the Journey pass.
- A mutual "Interested" gate before chat. Not verified in code yet.
- A selfie/liveness check before the first meetup.

## Deployment checklist

1. Apply the migrations `20261003000000_limen_v2_flat_caps_care_style_graduation.sql` and `20261003000001_limen_v2_stories_and_curiosity_notes.sql`.
2. Deploy the edge functions: `supabase functions deploy reflection-coach`, `generate-reply-draft` (the 410 stub), and `generate-match-suggestions`. `reflection-coach` uses the same Anthropic and Supabase secrets as the old draft function.
3. If you have local, uncommitted migrations (for example `20260831000000`, video guidance), check whether they redefine any function in the first migration above: `create_connection_with_capacity_check`, `reinitiate_ended_connection`, `my_connection_capacity`, `get_active_intervention`, `advance_friendship_stage`, `get_ai_gate_status`, `record_ai_usage`, `submit_graduation_readiness`, or `graduate_connection`.
