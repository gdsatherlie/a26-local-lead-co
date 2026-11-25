// POST /api/onboard {plan, session, data, company_url(honeypot)}
// Saves a new client's setup details and alerts Duncan via the lead scenario.
const crypto = require('crypto');
const SB_URL = process.env.SUPABASE_URL || 'https://qquntqtoitdsvpkpmiai.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__elkOM-rc_DFnAcANZCQGg_iRFzIiBt';
const WEBHOOK = process.env.LEAD_WEBHOOK_URL || 'https://hook.us2.make.com/j1gpuwj5vyp0rsfoadnfco9nkeh6yltc';

const LABELS = {
  business: 'Business', contact: 'Contact', email: 'Email', mobile: 'Mobile', website: 'Website', gbp: 'Google profile',
  cities: 'Cities', services: 'Top services', jobValue: 'Avg job', hours: 'Hours', emergency: 'Emergency calls',
  gbpAccess: 'GBP access', jobSystem: 'Job system', jobsPerWeek: 'Jobs/week', alertPhone: 'Bad-review alerts', replyName: 'Reply as',
  sitePlatform: 'Site platform', siteManager: 'Site managed by', siteAccess: 'Site access',
  adsAccount: 'Ads account', adsId: 'Ads ID', lsa: 'LSA', budget: 'Ad budget', licenseDocs: 'License docs',
  mainPhone: 'Main phone', phoneCarrier: 'Phone provider', calendar: 'Booking calendar', callRules: 'Call rules',
  addReceptionist: 'Adding receptionist', notes: 'Notes',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  if (body.company_url) return res.status(200).json({ ok: true });
  const plan = String(body.plan || '').slice(0, 20);
  const data = {};
  for (const [k, v] of Object.entries(body.data || {})) {
    if (LABELS[k] !== undefined) data[k] = typeof v === 'boolean' ? v : String(v).slice(0, 1500);
  }
  if (!data.business || !data.email) return res.status(400).json({ error: 'Please add your business name and email' });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/onboarding_save`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_plan: plan, p_session: String(body.session || '').slice(0, 200), p_data: data }),
    });
    if (!r.ok || (await r.text()) !== 'true') throw new Error('save failed');
  } catch {
    return res.status(502).json({ error: 'We could not save that' });
  }

  const summary = Object.entries(data).filter(([k]) => !['business', 'email', 'mobile', 'contact'].includes(k))
    .map(([k, v]) => `${LABELS[k]}: ${v}`).join(' | ');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        name: data.contact || '', business: data.business, email: data.email, phone: data.mobile || '',
        biggest_pain: `NEW CLIENT ONBOARDING: ${plan}${data.addReceptionist ? ' + receptionist' : ''}`,
        about: summary.slice(0, 3000), source: 'a26locallead.co/onboard',
      }),
    });
    clearTimeout(t);
  } catch {}
  return res.status(200).json({ ok: true, ref: crypto.randomBytes(3).toString('hex') });
};
