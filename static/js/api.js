/* Requests to the local Orbit backend. */
import { systemMessage, t } from './i18n.js';

/*
 * Changes carry the local action key. The Mac app injects it as window.orbitActionKey;
 * browser mode receives it once in the address (#key=…) and keeps it in this browser.
 */
const keyInAddress = location.hash.match(/^#key=([a-f0-9]{64})$/)?.[1];
if (keyInAddress) {
  try { localStorage.setItem('orbit-action-key', keyInAddress); } catch { /* Private mode: the key lasts for this page. */ }
  history.replaceState(null, '', location.pathname + '#overview');
}

function actionKey() {
  if (window.orbitActionKey || keyInAddress) return window.orbitActionKey || keyInAddress;
  try { return localStorage.getItem('orbit-action-key') || ''; } catch { return ''; }
}

/** GET without data, POST with data. Errors carry a translated message. */
export async function api(path, data) {
  const options = data === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orbit-Key': actionKey() },
    body: JSON.stringify(data),
  };
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(systemMessage(value.error) || t('Request failed'));
  return value;
}

/** The dashboard state; with a tag the backend answers 304 while nothing changed. */
export const fetchState = (tag) => fetch('/api/state', { headers: tag ? { 'If-None-Match': tag } : {} });
