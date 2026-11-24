// Google data: Places API (New) for the business + local competitors,
// PageSpeed Insights for mobile speed. Needs GOOGLE_API_KEY with both APIs enabled.

const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.regularOpeningHours',
  'places.photos',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

async function searchText(textQuery, key, max = 20) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({ textQuery, pageSize: max, languageCode: 'en', regionCode: 'US' }),
  });
  if (!res.ok) throw new Error('Places ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return (j.places || []).map(slim);
}

function slim(p) {
  const hours = p.regularOpeningHours || {};
  const desc = hours.weekdayDescriptions || [];
  return {
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    website: p.websiteUri || '',
    phone: p.nationalPhoneNumber || '',
    photos: (p.photos || []).length, // API returns at most 10
    category: p.primaryTypeDisplayName?.text || '',
    mapsUrl: p.googleMapsUri || '',
    open24h: desc.length > 0 && desc.every((d) => /open 24 hours/i.test(d)),
    hoursListed: desc.length > 0,
    weekendHours: desc.filter((d) => /^(Saturday|Sunday)/.test(d) && !/closed/i.test(d)).length,
    status: p.businessStatus || '',
  };
}

const hostOf = (u) => {
  try {
    return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

// Find the prospect's own listing, then the shops ranking for their main
// service search in their city.
async function googleFacts({ business, city, website, trade }, key) {
  const site = hostOf(website);
  const self = await searchText(`${business} ${city}`, key, 5);
  let me =
    self.find((p) => site && hostOf(p.website) === site) ||
    self.find((p) => p.name.toLowerCase().includes(String(business).toLowerCase().split(' ')[0])) ||
    null;

  const query = `${trade || 'HVAC contractor'} in ${city}`;
  const market = await searchText(query, key, 20);
  const rankIndex = me ? market.findIndex((p) => p.id === me.id) : -1;
  if (!me && site) {
    const viaSite = market.find((p) => hostOf(p.website) === site);
    if (viaSite) me = viaSite;
  }
  const competitors = market
    .filter((p) => !me || p.id !== me.id)
    .filter((p) => p.status !== 'CLOSED_PERMANENTLY')
    .slice(0, 3);

  return {
    query,
    found: !!me,
    business: me,
    searchRank: rankIndex >= 0 ? rankIndex + 1 : null, // position in Google's results for `query`, 1-based
    resultsChecked: market.length,
    competitors,
  };
}

async function pageSpeed(url, key) {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', url);
  u.searchParams.set('strategy', 'mobile');
  u.searchParams.set('category', 'performance');
  if (key) u.searchParams.set('key', key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(u, { signal: ctrl.signal });
    if (!res.ok) throw new Error('PageSpeed ' + res.status);
    const j = await res.json();
    const lh = j.lighthouseResult || {};
    const a = lh.audits || {};
    return {
      mobileScore: Math.round((lh.categories?.performance?.score ?? 0) * 100),
      largestContentfulPaintSec: a['largest-contentful-paint']?.numericValue
        ? +(a['largest-contentful-paint'].numericValue / 1000).toFixed(1)
        : null,
      totalBlockingMs: a['total-blocking-time']?.numericValue ? Math.round(a['total-blocking-time'].numericValue) : null,
    };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { googleFacts, pageSpeed, searchText };
