// POST /api/audit  {website, business, city, trade?, email?, phone?, company_url?(honeypot)}
// Returns a JSON diagnostic the /audit page renders as a 1–2 page report.

const { analyzeSite, normalizeUrl } = require('../lib/site');
const { googleFacts, pageSpeed } = require('../lib/google');
const { scoreAudit } = require('../lib/score');
const { writeUp } = require('../lib/writeup');
const limit = require('../lib/limit');
const { saveReport, addLead } = require('../lib/store');

const WEBHOOK = process.env.LEAD_WEBHOOK_URL || 'https://hook.us2.make.com/j1gpuwj5vyp0rsfoadnfco9nkeh6yltc';

async function logLead(payload) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify(payload) });
    clearTimeout(t);
  } catch {}
}

const BUSY = "You've reached today's limit for instant audits. We have your details and will email your full report within one business day.";

// Internal runs (a26 staff building call sheets): no visitor limit, no prospect
// email, no follow-ups, no lead alert. Only the SHA-256 of the token is stored here.
const INTERNAL_HASH = 'ee5c36a5fcc4ff9d37eaa81a91ee61a4196e4e24402ffdee54a56d587020e867';
const isInternal = (req) => {
  const t = String(req.headers['x-a26-internal'] || '');
  return !!t && require('crypto').createHash('sha256').update(t).digest('hex') === INTERNAL_HASH;
};

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

  const contact = {
    name: String(body.name || '').slice(0, 80),
    business,
    email: String(body.email || '').slice(0, 120),
    phone: String(body.phone || '').slice(0, 40),
  };
  let host = '';
  try { host = new URL(website).hostname.replace(/^www\./, ''); } catch {}

  const internal = isInternal(req);
  const hit = internal ? null : limit.cached(host);
  if (hit) return res.status(200).json({ ...hit, cached: true });

  const blocked = internal ? null : await limit.takeDurable(limit.clientIp(req));
  if (blocked) {
    await logLead({ ...contact, biggest_pain: `AI audit (rate-limited: ${blocked}) - send report manually`, about: `Website: ${website} | City: ${city} | Trade: ${trade}`, source: 'a26locallead.co/audit' });
    return res.status(429).json({ error: BUSY, limited: blocked });
  }

  const gKey = process.env.GOOGLE_API_KEY;
  const t0 = Date.now();
  const [siteR, gR, speedR] = await Promise.all([
    settle(analyzeSite(website, city)),
    gKey ? settle(googleFacts({ business, city, website, trade }, gKey)) : Promise.resolve({ ok: false, e: 'no key' }),
    settle(pageSpeed(website, gKey)),
  ]);

  if (!gR.ok && /429|RESOURCE_EXHAUSTED|quota/i.test(gR.e || '')) {
    await logLead({ ...contact, biggest_pain: 'AI audit (Google quota reached) - send report manually', about: `Website: ${website} | City: ${city} | Trade: ${trade}`, source: 'a26locallead.co/audit' });
    return res.status(429).json({ error: BUSY, limited: 'google_quota' });
  }

  const facts = {
    site: siteR.ok ? siteR.v : { reachable: false, error: siteR.e },
    google: gR.ok ? gR.v : null,
    speed: speedR.ok ? speedR.v : null,
  };
  const scored = scoreAudit(facts);
  const input = { business, city, website, trade };
  const copy = await writeUp(input, facts, scored, 54000 - (Date.now() - t0));

  const report = {
    id: Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
    input,
    facts,
    scored,
    copy,
    checks: { google: gR.ok, speed: speedR.ok, site: !!facts.site.reachable, ai: !!copy.ai, aiKey: !!process.env.ANTHROPIC_API_KEY, aiError: copy.aiError ? String(copy.aiError).slice(0, 120) : undefined },
    ms: Date.now() - t0,
  };

  try {
    const rid = await saveReport(report);
    if (rid) {
      report.reportId = rid;
      report.reportUrl = `https://a26locallead.co/audit?r=${rid}`;
      if (contact.email && !internal) await addLead(rid, contact.email).catch(() => {});
    }
  } catch {}

  // Lead notification (existing Make scenario → sheet row + email alert).
  if (!internal) await logLead({
    ...contact,
    biggest_pain: `AI audit: ${scored.overall}/100 (${scored.overallGrade}) → ${scored.plan.name}`,
    about: `Website: ${website} | City: ${city} | Reviews: ${facts.google?.business?.reviews ?? '?'} | Map rank: ${facts.google?.searchRank ?? 'not top 20'} | Leader: ${scored.leader ? scored.leader.name + ' (' + scored.leader.reviews + ')' : '-'} | ${copy.headline}`,
    source: 'a26locallead.co/audit',
    report_url: report.reportUrl || '',
    score: scored.overall,
    plan: scored.plan.name,
    headline: copy.headline,
    fix1: (copy.fixes && copy.fixes[0] && copy.fixes[0].title) || '',
  });

  if (gR.ok && copy.ai && !internal) limit.remember(host, report);
  return res.status(200).json(report);
};
