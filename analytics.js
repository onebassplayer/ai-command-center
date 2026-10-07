/* Traffic only. Enhanced measurement is disabled in this product's GA4 stream. */
(() => {
  'use strict';
  const ID = 'G-Z1NRNC8MV7';
  const HOST = 'jigbench.com';
  const TITLE = 'JigBench';
  if (location.hostname !== HOST || !['/', '/index.html'].includes(location.pathname)) return;
  const KEY = 'moonshot-traffic-consent-v1';
  const panel = document.getElementById('analytics-choice');
  const manage = document.getElementById('analytics-manage');
  let started = false;
  let previousFocus;
  const safeUrl = new URL('https://' + HOST + '/');
  const incoming = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const value = incoming.get(key);
    if (value && /^[a-z0-9_-]{1,80}$/i.test(value)) safeUrl.searchParams.set(key, value);
  }
  let referrer = '';
  try { referrer = new URL(document.referrer).origin + '/'; } catch {}
  function enable() {
    window['ga-disable-' + ID] = false;
    if (started) return;
    started = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', ID, {
      page_location: safeUrl.href, page_referrer: referrer, page_title: TITLE,
      allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_expires: 15552000
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    document.head.append(script);
  }
  function disable() {
    window['ga-disable-' + ID] = true;
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of ['', '; Domain=' + HOST, '; Domain=.' + HOST]) {
        document.cookie = name + '=; Max-Age=0; Path=/' + domain + '; SameSite=Lax; Secure';
      }
    }
  }
  function choose(value) {
    try { localStorage.setItem(KEY, JSON.stringify({value, expires: Date.now() + 15552000000})); } catch {}
    if (value === 'accepted') enable(); else disable();
    panel.hidden = true;
    if (previousFocus) previousFocus.focus();
  }
  document.getElementById('analytics-accept').addEventListener('click', () => choose('accepted'));
  document.getElementById('analytics-decline').addEventListener('click', () => choose('declined'));
  manage.addEventListener('click', () => {
    previousFocus = manage; panel.hidden = false;
    document.getElementById('analytics-accept').focus();
  });
  let choice;
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.expires > Date.now()) choice = saved.value; } catch {}
  if (choice === 'accepted') enable();
  else if (choice !== 'declined') panel.hidden = false;
})();
