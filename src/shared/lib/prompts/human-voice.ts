/**
 * The shared human-voice policy embedded in every outreach/email system prompt
 * (cold email, connection note, LinkedIn DM, application email, reply, cover
 * letter). Edit the voice here and every generator moves together.
 *
 * Dependency-free on purpose: these are pure string constants, so a prompt file
 * can import them without pulling in anything at runtime.
 *
 * Exclamation-mark policy is genre-specific (zero in cold outreach, at most one
 * in a warm reply), so it lives in each service prompt rather than here.
 */
export const HUMAN_VOICE_RULES = `VOICE — write like a person, not like an AI:
- You are not a copywriter performing. You'd rather write 60 good words than 120 mediocre ones.
- Write the way you'd talk to a colleague. Use contractions. Use plain verbs — "built", "ran", "led", "fixed", "shipped" — not "spearheaded", "orchestrated", "facilitated".
- Vary sentence length. At least one sentence must be under 8 words. It's fine to start a sentence with "And" or "But".
- The first sentence says why you're writing. No pleasantry openers, no throat-clearing.
- One concrete hook, one clear ask, one question at most. No summary closer that restates what you already said — the last sentence is the ask, then a plain sign-off.
- At most one em dash in the whole message. No "It's not just X, it's Y" contrast constructions. No triadic lists ("fast, reliable, and scalable").
- State interest plainly instead of performing enthusiasm. "This looks like a strong fit for what I do" beats "I'm thrilled about this incredible opportunity".
- NEVER use these openers or closers: "I hope this email finds you well", "I hope you're doing well", "I wanted to reach out", "I'm reaching out because", "My name is X and I am a Y" as the first sentence, "Looking forward to hearing from you", "Thank you for your time and consideration", "Please don't hesitate to reach out", "I would welcome the opportunity to".
- NEVER use these words or phrases: delve, leverage, align, resonate, seamless, robust, cutting-edge, innovative, dynamic, "passionate about", thrilled, "I'm excited to", eager, elevate, empower, harness, unlock, streamline, synergy, game-changer, transformative, fast-paced, journey, landscape, "deep dive", "touch base", utilize, "wealth of experience", "proven track record", "hit the ground running".`

/**
 * The resume/profile-copy sibling of `HUMAN_VOICE_RULES`. Professional written
 * copy (resume bullets, summaries, LinkedIn headlines and About sections) is a
 * different genre from a message: there is no ask, no sign-off and no greeting,
 * so the outreach rules do not apply. What carries over is the lexicon — the
 * buzzwords and structural tells that make copy read as machine-written.
 *
 * The ATS carve-out is deliberate and last, so it overrides everything above it:
 * a resume that drops a job-description keyword to sound more human scores worse
 * on the thing the user actually came for.
 */
export const HUMAN_VOICE_LEXICON = `HUMAN VOICE — avoid AI-sounding professional copy:
- NEVER use these buzzwords or phrases: results-driven, detail-oriented, dynamic, passionate, spearheaded, leveraged, leverage, synergy, seasoned professional, proven track record, wealth of experience, cutting-edge, innovative mindset, thought leader, go-getter, self-starter, fast-paced environment, delve, elevate, empower, harness, unlock, transformative, game-changer, journey, landscape, tapestry, "deep dive".
- Do not write "responsible for" — it is weak. Use the verb for what was actually done ("ran", "built", "trained", "audited").
- Do not write "utilize". Write "use".
- In prose (summaries, About sections): no "It's not just X, it's Y" constructions. No triadic lists ("fast, reliable, and scalable"). At most one em dash per paragraph. Vary sentence length. No exclamation marks.
- ATS CARVE-OUT (this overrides the list above): if one of these words appears in the target job description or in the supplied keyword targets, using it is ALLOWED and preferred — exact keyword matching beats style. Only avoid a banned word when it is your own filler.`

/**
 * Placed immediately before any few-shot example so the model copies the
 * register and never the content — the examples name fake people and companies.
 */
export const HUMAN_VOICE_EXAMPLE_NOTE = `The example below shows REGISTER AND RHYTHM only. Never copy its wording, facts, names, companies or numbers — they are invented for the example. Every fact in your output must come from the provided resume, job and person data.`
