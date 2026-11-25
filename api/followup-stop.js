// POST /api/followup-stop  {email, reason?}  -> stops audit follow-ups for that address.
// Called by Make when a prospect replies to team@ or books a call. Only ever
// turns follow-ups off, so it is safe without auth.
const { stopLead } = require('../lib/store');

module.exports = async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const raw = String(body.email || (req.query && req.query.email) || '');
  const m = raw.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/i);
  if (!m) return res.status(200).json({ ok: false, reason: 'no email' });
  try {
    await stopLead(m[0].toLowerCase(), String(body.reason || 'reply').slice(0, 40));
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false });
  }
};
