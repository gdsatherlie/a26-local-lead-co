// Lightweight abuse guard for /api/audit. Counters live in the warm function
// instance, so they reset on cold starts. The hard spending caps are the
// daily quotas set in Google Cloud and the Anthropic console; this layer stops
// one visitor from hammering the form and avoids re-running the same site.

const PER_IP_HOUR = Number(process.env.AUDIT_PER_IP_HOUR || 3);
const PER_IP_DAY = Number(process.env.AUDIT_PER_IP_DAY || 6);
const DAILY_MAX = Number(process.env.AUDIT_DAILY_MAX || 150);
const CACHE_MS = 6 * 60 * 60 * 1000;

const ipHits = new Map(); // ip -> [timestamps]
const cache = new Map(); // host -> {at, report}
let day = '';
let dayCount = 0;

const today = () => new Date().toISOString().slice(0, 10);

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || 'unknown';
}

function cached(host) {
  const c = cache.get(host);
  if (c && Date.now() - c.at < CACHE_MS) return c.report;
  if (c) cache.delete(host);
  return null;
}

function remember(host, report) {
  cache.set(host, { at: Date.now(), report });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
}

// Returns null when allowed, or a reason string when blocked. Counts the hit.
function take(ip) {
  const now = Date.now();
  if (day !== today()) {
    day = today();
    dayCount = 0;
  }
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 86400000);
  if (hits.filter((t) => now - t < 3600000).length >= PER_IP_HOUR) return 'ip_hour';
  if (hits.length >= PER_IP_DAY) return 'ip_day';
  if (dayCount >= DAILY_MAX) return 'daily_max';
  hits.push(now);
  ipHits.set(ip, hits);
  dayCount += 1;
  if (ipHits.size > 5000) ipHits.delete(ipHits.keys().next().value);
  return null;
}

// Durable per-visitor limit in Supabase (counts survive cold starts and are
// shared across instances). Only a salted SHA-256 of the IP is sent. The key
// is the project's publishable key; it can only call audit_take().
const crypto = require('crypto');
const SB_URL = process.env.SUPABASE_URL || 'https://qquntqtoitdsvpkpmiai.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__elkOM-rc_DFnAcANZCQGg_iRFzIiBt';

async function takeDurable(ip) {
  const visitor = crypto.createHash('sha256').update('a26-audit:' + ip).digest('hex');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(SB_URL + '/rest/v1/rpc/audit_take', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_visitor: visitor }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error('supabase ' + res.status);
    const reason = await res.json();
    if (reason) return reason;
    // Also count locally so the instance-level daily ceiling still applies.
    return take(ip);
  } catch {
    return take(ip); // fall back to in-memory counting
  }
}

module.exports = { clientIp, cached, remember, take, takeDurable };
