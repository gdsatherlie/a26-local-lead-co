// Turns collected facts + scores into readable copy. Uses Claude when
// ANTHROPIC_API_KEY is set; otherwise falls back to rule-based text so the
// audit still works.

const MODEL = process.env.AUDIT_MODEL || 'claude-sonnet-5-5';

function fallback(input, scored) {
  const sorted = scored.sections.filter((x) => x.checked).sort((a, b) => a.score - b.score);
  const fixes = [];
  for (const s of sorted) {
    const bad = s.findings.find((f) => f.ok === false);
    if (!bad) continue;
    const map = {
      reviews: ['Ask every customer for a Google review', 'Send a review request by text after every job, with one reminder. Closing the review gap is the single biggest factor in who homeowners call.'],
      profile: ['Fill out your Google profile', 'Add hours, weekend availability, and at least 10 recent job photos. Complete profiles get more calls from the map.'],
      visibility: ['Climb the map results', 'Post weekly on your Google profile, build service and city pages, and keep listings consistent so Google ranks you higher.'],
      website: ['Make the website book jobs', 'Put a tap-to-call number at the top, add online booking, and speed up the mobile site.'],
      leads: ['Track and answer every lead', 'Add call tracking so you know which sources make the phone ring, and make sure after-hours calls are answered.'],
    };
    const [title, why] = map[s.key];
    fixes.push({ title, why, evidence: bad.text });
    if (fixes.length === 3) break;
  }
  return {
    headline: `${input.business} scores ${scored.overall}/100. ${scored.leader ? `${scored.leader.name} is the shop to beat.` : ''}`.trim(),
    summary: `We checked your Google reviews, Google profile, map ranking, website, and lead tracking against the top shops in ${input.city}. Here is where you stand and the three changes that would bring in the most calls.`,
    sectionNotes: {},
    fixes,
  };
}

async function writeUp(input, facts, scored) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...fallback(input, scored), ai: false };

  const prompt = `You write short, plain-English diagnostics for owners of home-service businesses (HVAC, plumbing, electrical). You work for a26 Local Lead Co, which sells Google review management, Google profile/local SEO, Google Ads management, and an AI receptionist add-on.

Rules:
- Use ONLY the facts and scores provided. Never invent numbers, competitors, or findings. If something was not checked, do not mention it.
- Address the owner as "you". Be direct and specific. No hype, no exclamation marks, no jargon.
- Every fix must cite a specific fact from the data in its "evidence" field.

Business: ${input.business}, ${input.city}. Website: ${input.website}.
Facts (JSON): ${JSON.stringify(facts)}
Scores and findings (JSON): ${JSON.stringify(scored)}

Return ONLY a JSON object with:
{"headline": one sentence, max 20 words, naming the biggest gap,
 "summary": 2 sentences on overall position vs local competitors,
 "sectionNotes": {"reviews": 1 sentence, "profile": 1 sentence, "visibility": 1 sentence, "website": 1 sentence, "leads": 1 sentence},
 "fixes": [3 objects {"title": max 7 words, "why": 1-2 sentences on the business impact, "evidence": the specific fact}] ordered by impact}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('Claude ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    const text = (j.content || []).map((c) => c.text || '').join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!json.fixes || !json.headline) throw new Error('Bad AI output');
    return { ...json, ai: true };
  } catch (e) {
    return { ...fallback(input, scored), ai: false, aiError: String(e.message || e) };
  }
}

module.exports = { writeUp };
