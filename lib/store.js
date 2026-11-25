// Saves finished audit reports in Supabase so each one has a permanent link
// (a26locallead.co/audit?r=<id>) that can be emailed and shared.
const crypto = require('crypto');
const SB_URL = process.env.SUPABASE_URL || 'https://qquntqtoitdsvpkpmiai.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__elkOM-rc_DFnAcANZCQGg_iRFzIiBt';

const newId = () => {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(20), (b) => a[b % 36]).join('');
};

async function rpc(fn, args, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function saveReport(report) {
  const id = newId();
  const ok = await rpc('audit_save', { p_id: id, p_business: report.input.business, p_website: report.input.website, p_report: report });
  return ok ? id : null;
}

const getReport = (id) => rpc('audit_get', { p_id: id });

module.exports = { saveReport, getReport };
