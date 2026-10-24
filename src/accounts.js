// Signing in to the music services from inside the app (Zvuk with Sber ID or a
// phone number, Yandex Music with Yandex ID) and out again.

import * as zvuk from './zvuk.js';
import * as ya from './yandex.js';
import * as web from './serviceweb.js';
import { NAMES } from './online.js';
import { logError, save, load } from './settings.js';
import { toast } from './util.js';

const listeners = new Set();
export function onAccountsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(service) {
  // the feed is built from the main service: rebuild it next time
  const f = load('feed', null);
  if (f) save('feed', { ...f, at: 0 });
  for (const fn of listeners) fn(service);
}

const CLIENT = { zvuk, yandex: ya };
let busy = '';

export const isBusy = (service) => busy === service;

// Opens the service's sign-in page inside the app. Resolves true when signed in.
export async function connect(service) {
  if (busy) return false;
  if (!web.available()) {
    toast('Вход через сервис работает в приложении на телефоне', 4000);
    return false;
  }
  busy = service;
  changed(service);
  try {
    const r = await CLIENT[service].loginViaWeb();
    const who = service === 'yandex' ? r.name || r.login : '';
    toast(`${service === 'yandex' ? 'Яндекс Музыка подключена' : 'Звук подключён'}${who ? ': ' + who : ''}`, 3500);
    return true;
  } catch (e) {
    logError('login:' + service, e);
    toast(e.message || 'Не получилось войти', 5000);
    return false;
  } finally {
    busy = '';
    changed(service);
  }
}

export const notify = (service) => changed(service);

export async function disconnect(service) {
  try {
    await CLIENT[service].logout();
  } catch (e) {
    logError('logout:' + service, e);
  }
  changed(service);
  toast(`${NAMES[service]}: ты вышел из аккаунта`);
}

export function loggedIn(service) {
  return CLIENT[service].isLoggedIn();
}
