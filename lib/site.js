// Website analyzer: fetches a prospect's homepage and pulls out the facts a
// local-service buyer cares about. No dependencies; tolerant of messy HTML.

const UA =
  'Mozilla/5.0 (compatible; a26AuditBot/1.0; +https://a26locallead.co/audit)';

function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) throw new Error('No website given');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const url = new URL(u);
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

async function fetchText(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url, text };
  } finally {
    clearTimeout(t);
  }
}

const strip = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const first = (re, s) => {
  const m = s.match(re);
  return m ? strip(m[1]).slice(0, 300) : '';
};

function analyzeHtml(html, finalUrl, city) {
  const lower = html.toLowerCase();
  const text = strip(html);
  const textLower = text.toLowerCase();
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');

  const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const metaDescription =
    (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
      [])[1] || '';
  const h1 = first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);

  const phoneRe = /(\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}\b)/g;
  const phones = [...new Set((text.match(phoneRe) || []).map((p) => p.replace(/\D/g, '')))];
  const telLinks = (html.match(/href=["']tel:/gi) || []).length;
  const bodyStart = html.search(/<body[\s>]/i);
  const topText = strip(html.slice(bodyStart > 0 ? bodyStart : 0)).split(' ').slice(0, 120).join(' ');
  const phoneInFirstScreen = /(\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}\b)/.test(topText);

  const hasForm = /<form[\s>]/i.test(html);
  const bookingWidgets = [
    ['ServiceTitan', /servicetitan/i],
    ['Housecall Pro', /housecallpro|housecall pro/i],
    ['Jobber', /getjobber|jobber\.com/i],
    ['Calendly', /calendly/i],
    ['Schedule Engine', /scheduleengine|schedule engine/i],
    ['Podium', /podium/i],
    ['Birdeye', /birdeye/i],
    ['NiceJob', /nicejob/i],
    ['Broadly', /broadly/i],
  ]
    .filter(([, re]) => re.test(html))
    .map(([n]) => n);
  const onlineBooking =
    /book (online|now|a service|an appointment)|schedule (online|service|now|an appointment)|request (service|an appointment)/i.test(
      text
    ) || bookingWidgets.some((w) => ['ServiceTitan', 'Housecall Pro', 'Jobber', 'Calendly', 'Schedule Engine'].includes(w));

  const chatWidget = /intercom|drift\.com|tawk\.to|livechat|podium|birdeye|hubspot.*chat|messenger|smith\.ai|webchat/i.test(html);
  const reviewWidget = /elfsight|trustindex|birdeye|nicejob|podium|reviews widget|google reviews/i.test(html);
  const schemaLocal = /"@type"\s*:\s*"(LocalBusiness|HVACBusiness|Plumber|Electrician|HomeAndConstructionBusiness|RoofingContractor|GeneralContractor)"/i.test(html);
  const mobileViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const https = finalUrl.startsWith('https://');
  const gtag = /googletagmanager|gtag\(|google-analytics/i.test(html);
  const adsTag = /AW-\d{6,}|googleadservices|conversion\.js/i.test(html);
  const metaPixel = /fbq\(|connect\.facebook\.net/i.test(html);
  const callTracking = /callrail|calltrackingmetrics|ctm\.js|whatconverts|calltracking/i.test(html);
  const emergency = /24\/7|24 hours|emergency/i.test(text);
  const financing = /financ(e|ing)/i.test(text);
  const cityMentioned = city ? textLower.includes(String(city).toLowerCase()) : null;
  const copyrightYear = (text.match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/i) || [])[1] || '';

  // internal links → rough service/location page signal
  const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => !/^(mailto|tel|javascript):/i.test(h))
    .map((h) => {
      try {
        return new URL(h, finalUrl);
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.hostname.replace(/^www\./, '') === host)
    .map((u) => u.pathname.replace(/\/+$/, '') || '/');
  const uniqPaths = [...new Set(links)];
  const serviceWords = /(furnace|heating|cooling|air-?condition|ac-|hvac|heat-?pump|boiler|duct|plumb|water-?heater|drain|sewer|electric|generator|repair|install|maintenance|tune)/i;
  const servicePages = uniqPaths.filter((p) => serviceWords.test(p));
  const locationPages = uniqPaths.filter((p) => /(service-area|areas?-we-serve|locations?|\/cities|-in-[a-z]|near-me)/i.test(p));
  const hasBlog = uniqPaths.some((p) => /blog|news|articles/i.test(p));
  const hasReviewsPage = uniqPaths.some((p) => /review|testimonial/i.test(p));

  return {
    url: finalUrl,
    host,
    title,
    metaDescription: metaDescription.slice(0, 300),
    h1,
    wordCount: text.split(' ').length,
    phonesFound: phones.slice(0, 3),
    clickToCallLinks: telLinks,
    phoneNearTop: phoneInFirstScreen,
    hasContactForm: hasForm,
    onlineBooking,
    toolsDetected: bookingWidgets,
    chatWidget,
    reviewWidgetOnSite: reviewWidget,
    localBusinessSchema: schemaLocal,
    mobileViewport,
    https,
    analyticsTag: gtag,
    googleAdsTag: adsTag,
    metaPixel,
    callTracking,
    mentions247OrEmergency: emergency,
    mentionsFinancing: financing,
    cityMentioned,
    copyrightYear,
    internalPages: uniqPaths.length,
    servicePages: servicePages.length,
    servicePageExamples: servicePages.slice(0, 6),
    locationPages: locationPages.length,
    hasBlog,
    hasReviewsPage,
  };
}

async function analyzeSite(website, city) {
  const url = normalizeUrl(website);
  const started = Date.now();
  try {
    const r = await fetchText(url);
    if (!r.text || r.text.length < 200) {
      return { url, reachable: false, status: r.status, error: 'Site returned little or no content' };
    }
    return {
      reachable: true,
      status: r.status,
      loadMs: Date.now() - started,
      ...analyzeHtml(r.text, r.finalUrl || url, city),
    };
  } catch (e) {
    return { url, reachable: false, error: String(e.message || e) };
  }
}

module.exports = { analyzeSite, analyzeHtml, normalizeUrl };
