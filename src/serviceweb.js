// The in-app browser per service (native ServiceWeb plugin). Used to sign in on
// the service's own site, and to make its web requests from inside that site.

import { Capacitor, registerPlugin } from '@capacitor/core';

const ServiceWeb = registerPlugin('ServiceWeb');

export const available = () => Capacitor.isNativePlatform();

// watch: part of an address; when the page gets there the panel closes by itself
export function open(service, url, { visible = false, title = '', watch = '' } = {}) {
  return ServiceWeb.open({ service, url, visible, title, watch });
}

// Android back button. Resolves true when an open panel took it.
export async function back() {
  if (!available()) return false;
  try {
    return !!(await ServiceWeb.back()).handled;
  } catch {
    return false;
  }
}

export function hide(service) {
  return ServiceWeb.hide({ service });
}

export function state(service) {
  return ServiceWeb.state({ service });
}

// fetch() inside the service page. Resolves to { status, body, url } (status 0 = failed).
export function request(service, url, { method = 'GET', headers = {}, body, timeout = 25000 } = {}) {
  return ServiceWeb.request({ service, url, method, headers, body, timeout });
}

export function forget(domains) {
  return ServiceWeb.forget({ domains: domains.join(',') });
}

export function onPage(fn) {
  return ServiceWeb.addListener('page', fn);
}

export function onClosed(fn) {
  return ServiceWeb.addListener('closed', fn);
}

// Opens the page for the user and resolves when they press "Готово" (or the
// page reaches `watch`). Resolves to { url, matched }.
export function askUser(service, url, title, { watch = '' } = {}) {
  return new Promise((resolve) => {
    let closedSub, matchSub;
    let matched = '';
    ServiceWeb.addListener('match', (ev) => {
      if (ev.service === service) matched = ev.url;
    }).then((s) => (matchSub = s));
    onClosed((ev) => {
      if (ev.service !== service) return;
      if (closedSub) closedSub.remove();
      if (matchSub) matchSub.remove();
      resolve({ url: matched || ev.url, matched: !!matched });
    }).then((s) => (closedSub = s));
    open(service, url, { visible: true, title, watch });
  });
}

// Resolves after the next page load of a service (or after `ms`).
export function nextPage(service, ms = 8000) {
  return new Promise((resolve) => {
    let sub;
    const t = setTimeout(() => {
      if (sub) sub.remove();
      resolve(null);
    }, ms);
    onPage((ev) => {
      if (ev.service !== service) return;
      clearTimeout(t);
      if (sub) sub.remove();
      resolve(ev);
    }).then((s) => (sub = s));
  });
}
