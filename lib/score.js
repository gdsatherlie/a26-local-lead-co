// Deterministic scoring. Grades and findings come from code so every number in
// the report traces back to a fact we collected; the AI only writes the prose.

const grade = (s) => (s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F');
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function scoreAudit({ site, google, speed }) {
  const me = google?.business || null;
  const comps = google?.competitors || [];
  const leader = comps.reduce((a, c) => (c.reviews > (a?.reviews || 0) ? c : a), null);
  const sections = [];

  // 1. Reviews
  {
    const f = [];
    let s = 0;
    if (!google) {
      f.push({ ok: null, text: 'Google data not checked in this run.' });
    } else if (!me) {
      f.push({ ok: false, text: 'We could not find a Google Business Profile matching this business and city.' });
    } else {
      const top = leader?.reviews || 0;
      const ratio = top ? me.reviews / top : 1;
      s += Math.min(60, ratio * 60);
      s += me.rating >= 4.7 ? 40 : me.rating >= 4.4 ? 28 : me.rating >= 4.0 ? 15 : 5;
      f.push({ ok: me.reviews >= top, text: `${me.reviews.toLocaleString()} Google reviews, ${me.rating ?? 'no'} star rating.` });
      if (leader) f.push({ ok: me.reviews >= leader.reviews, text: `Most-reviewed competitor nearby: ${leader.name}, ${leader.reviews.toLocaleString()} reviews at ${leader.rating}.` });
      if (top > me.reviews) f.push({ ok: false, text: `Gap to the leader: ${(top - me.reviews).toLocaleString()} reviews.` });
    }
    sections.push({ key: 'reviews', label: 'Google reviews', score: clamp(s), findings: f });
  }

  // 2. Google Business Profile
  {
    const f = [];
    let s = 0;
    if (me) {
      s += 20;
      s += me.hoursListed ? 15 : 0;
      f.push({ ok: me.hoursListed, text: me.hoursListed ? 'Business hours are listed.' : 'No business hours listed on Google.' });
      s += me.open24h ? 20 : me.weekendHours ? 12 : 0;
      f.push({ ok: me.open24h || me.weekendHours > 0, text: me.open24h ? 'Listed as open 24 hours.' : me.weekendHours ? 'Open at least one weekend day.' : 'Listed as closed on weekends.' });
      if (me.photos > 0) {
        s += Math.min(25, me.photos * 2.5);
        f.push({ ok: me.photos >= 10, text: me.photos >= 10 ? 'Profile has 10+ photos.' : `Only ${me.photos} photos on the profile.` });
      } else s += 15; // photo count unavailable from Google: neutral
      s += me.website ? 20 : 0;
      if (!me.website) f.push({ ok: false, text: 'No website linked on the Google profile.' });
    } else if (google) {
      f.push({ ok: false, text: 'Profile not found, so homeowners searching Google may not see you on the map.' });
    } else f.push({ ok: null, text: 'Google data not checked in this run.' });
    sections.push({ key: 'profile', label: 'Google profile', score: clamp(s), findings: f });
  }

  // 3. Map visibility
  {
    const f = [];
    let s = 0;
    if (google) {
      const r = google.searchRank;
      s = r ? (r <= 3 ? 100 : r <= 5 ? 75 : r <= 10 ? 50 : 30) : 10;
      f.push({
        ok: !!r && r <= 3,
        text: r
          ? `Shows up #${r} on Google for "${google.query}".`
          : `Not in the top ${google.resultsChecked} Google results for "${google.query}".`,
      });
      if (comps.length) f.push({ ok: null, text: `Top results: ${comps.map((c) => c.name).join(', ')}.` });
    } else f.push({ ok: null, text: 'Map ranking not checked in this run.' });
    sections.push({ key: 'visibility', label: 'Map visibility', score: clamp(s), findings: f });
  }

  // 4. Website
  {
    const f = [];
    let s = 0;
    if (site?.reachable) {
      s += site.clickToCallLinks > 0 ? 15 : 0;
      f.push({ ok: site.clickToCallLinks > 0, text: site.clickToCallLinks > 0 ? 'Phone number is tap-to-call on mobile.' : 'Phone number is not tap-to-call on mobile.' });
      s += site.phoneNearTop ? 10 : 0;
      f.push({ ok: site.phoneNearTop, text: site.phoneNearTop ? 'Phone number is visible at the top of the page.' : 'Phone number is not visible at the top of the homepage.' });
      s += site.onlineBooking ? 15 : site.hasContactForm ? 8 : 0;
      f.push({ ok: site.onlineBooking, text: site.onlineBooking ? 'Customers can request or book service online.' : site.hasContactForm ? 'Contact form only, no online booking.' : 'No way to book or request service online.' });
      s += Math.min(20, site.servicePages * 2);
      f.push({ ok: site.servicePages >= 6, text: site.servicePages === 1 ? 'Only 1 service page found.' : `${site.servicePages} service pages found.` });
      s += site.cityMentioned ? 10 : 0;
      if (!site.cityMentioned) f.push({ ok: false, text: 'Your city is not mentioned on the homepage.' });
      s += site.https ? 5 : 0;
      s += site.localBusinessSchema ? 5 : 0;
      if (speed) {
        s += speed.mobileScore >= 70 ? 20 : speed.mobileScore >= 50 ? 12 : speed.mobileScore >= 30 ? 6 : 0;
        f.push({ ok: speed.mobileScore >= 50, text: `Mobile speed score ${speed.mobileScore}/100${speed.largestContentfulPaintSec ? `, main content loads in ${speed.largestContentfulPaintSec}s` : ''}.` });
      } else s += 10;
    } else {
      f.push({ ok: false, text: `We could not load the website${site?.error ? ` (${site.error})` : ''}.` });
    }
    sections.push({ key: 'website', label: 'Website', score: clamp(s), findings: f });
  }

  // 5. Lead capture & tracking
  {
    const f = [];
    let s = 0;
    if (site?.reachable) {
      s += site.googleAdsTag ? 30 : 0;
      f.push({ ok: site.googleAdsTag, text: site.googleAdsTag ? 'Google Ads tracking is installed, so you are likely running Google ads.' : 'No Google Ads tracking found, so you are likely not running Google ads (or not tracking them).' });
      s += site.callTracking ? 25 : 0;
      f.push({ ok: site.callTracking, text: site.callTracking ? 'Call tracking is installed.' : 'No call tracking, so you cannot see which ads or listings make the phone ring.' });
      s += site.analyticsTag ? 15 : 0;
      if (!site.analyticsTag) f.push({ ok: false, text: 'No website analytics found.' });
      const after = me?.open24h || site.mentions247OrEmergency;
      s += after ? 15 : 0;
      f.push({ ok: !!after, text: after ? 'Advertises 24/7 or emergency service.' : 'No after-hours or emergency service mentioned.' });
      s += site.chatWidget ? 15 : 0;
    } else f.push({ ok: null, text: 'Not checked because the website did not load.' });
    sections.push({ key: 'leads', label: 'Lead capture and tracking', score: clamp(s), findings: f });
  }

  const weights = { reviews: 0.3, profile: 0.15, visibility: 0.2, website: 0.2, leads: 0.15 };
  const checked = { reviews: !!google, profile: !!google, visibility: !!google, website: !!site?.reachable, leads: !!site?.reachable };
  sections.forEach((x) => {
    x.checked = checked[x.key];
    x.grade = x.checked ? grade(x.score) : '–';
  });
  const live = sections.filter((x) => x.checked);
  const wsum = live.reduce((a, x) => a + weights[x.key], 0) || 1;
  const overall = clamp(live.reduce((a, x) => a + x.score * weights[x.key], 0) / wsum);

  // Plan recommendation
  const rev = me?.reviews || 0;
  const byKey = Object.fromEntries(sections.map((x) => [x.key, x]));
  let plan;
  const siteReady = !byKey.website.checked || byKey.website.score >= 55;
  if (rev >= 100 && byKey.reviews.score >= 55 && siteReady) {
    plan = { name: 'Lead Engine', price: '$1,997/mo + ad spend', why: 'Your reviews are strong enough to convert paid traffic. The next gain is Google Local Services Ads and Search Ads, tracked to booked jobs.' };
  } else if (rev >= 100 && !siteReady) {
    plan = { name: 'Local Growth', price: '$797/mo', why: 'Your reviews are solid, but your website is not ready to turn ad clicks into booked jobs. Fix the site and Google profile first, then add ads.' };
  } else if (byKey.visibility.score < 55 || byKey.profile.score < 55) {
    plan = { name: 'Local Growth', price: '$797/mo', why: 'You need more reviews and a stronger Google profile and website to climb the map results before paying for ads.' };
  } else {
    plan = { name: 'Google Reviews', price: '$297/mo', why: 'The fastest win is closing the review gap with the shops ranking above you.' };
  }
  const addReceptionist = !(me?.open24h) && !site?.chatWidget;

  return {
    overall,
    overallGrade: grade(overall),
    sections,
    plan,
    addReceptionist,
    leader: leader ? { name: leader.name, reviews: leader.reviews, rating: leader.rating } : null,
    meReviews: me ? me.reviews : null,
  };
}

module.exports = { scoreAudit, grade };
