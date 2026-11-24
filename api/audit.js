// POST /api/audit  {website, business, city, trade?, email?, phone?, company_url?(honeypot)}
// Returns a JSON diagnostic the /audit page renders as a 1–2 page report.

const { analyzeSite, normalizeUrl } = require('../lib/site');
const { googleFacts, pageSpeed } = require('../lib/google');
const { scoreAudit } = require('../lib/score');
const { writeUp } = require('../lib/writeup');

const WEBHOOK = process.env.LEAD_WEBHOOK_URL || 'https://hook.us2.make.com/j1gpuwj5vyp0rsfoadnfco9nkeh6yltc';

const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: String(e.message || e) }));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};
  if (body.company_url) return res.status(200).json({ error: 'ok' }); // honeypot

  const business = String(body.business || '').trim().slice(0, 120);
  const city = String(body.city || '').trim().slice(0, 80);
  const trade = String(body.trade || 'HVAC contractor').trim().slice(0, 60);
  let website;
  try {
    website = normalizeUrl(body.website);
  } catch {
    return res.status(400).json({ error: 'Please enter your website address.' });
  }
  if (!business || !city) return res.status(400).json({ error: 'Please enter your business name and city.' });

  const gKey = process.env.GOOGLE_API_KEY;
  const t0 = Date.now();
  const [siteR, gR, speedR] = await Promise.all([
    settle(analyzeSite(website, city)),
    gKey ? settle(googleFacts({ business, city, website, trade }, gKey)) : Promise.resolve({ ok: false, e: 'no key' }),
    settle(pageSpeed(website, gKey)),
  ]);

  const facts = {
    site: siteR.ok ? siteR.v : { reachable: false, error: siteR.e },
    google: gR.ok ? gR.v : null,
    speed: speedR.ok ? speedR.v : null,
  };
  const scored = scoreAudit(facts);
  const input = { business, city, website, trade };
  const copy = await writeUp(input, facts, scored);

  const report = {
    id: Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
    input,
    facts,
    scored,
    copy,
    checks: { google: gR.ok, speed: speedR.ok, site: !!facts.site.reachable, ai: !!copy.ai },
    ms: Date.now() - t0,
  };

  // Lead notification (existing Make scenario → sheet row + email alert).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        name: String(body.name || '').slice(0, 80),
        business,
        email: String(body.email || '').slice(0, 120),
        phone: String(body.phone || '').slice(0, 40),
        biggest_pain: `AI audit: ${scored.overall}/100 (${scored.overallGrade}) → ${scored.plan.name}`,
        about: `Website: ${website} | City: ${city} | Reviews: ${facts.google?.business?.reviews ?? '?'} | Map rank: ${facts.google?.searchRank ?? 'not top 20'} | Leader: ${scored.leader ? scored.leader.name + ' (' + scored.leader.reviews + ')' : '-'} | ${copy.headline}`,
        source: 'a26locallead.co/audit',
      }),
    });
    clearTimeout(t);
  } catch {}

  return res.status(200).json(report);
};
