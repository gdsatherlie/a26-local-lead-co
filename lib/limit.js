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

module.exports = { clientIp, cached, remember, take };
