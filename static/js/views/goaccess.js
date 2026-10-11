/* Optional GoAccess integration. Orbit reads prepared reports, never server logs. */
import { api } from '../api.js';
import { escape, markup } from '../html.js';
import { locale, tHtml } from '../i18n.js';
import { store } from '../store.js';

let snapshot = { reports: [] };
let selected = null;
let busy = false;
let message = '';
let redraw = () => {};

export async function loadGoAccess() {
  try { snapshot = await api('/api/goaccess'); } catch (error) { message = error.message; }
  if (store.view === 'goaccess') redraw();
}

export function goaccessView() {
  const config = store.data?.config?.goaccess || { enabled: false, host: '', command: '' };
  const reports = snapshot.source === config.host + ':' + config.command ? snapshot.reports : [];
  const report = reports.find(item => item.id === selected);
  const number = value => Number(value || 0).toLocaleString(locale());
  return markup`
    <section class="panel goaccess-toolbar">
      <button type="button" class="button secondary setup-settings" data-settings-section="tools">${tHtml('GoAccess integration')}</button>
      ${config.enabled ? markup`<button id="goaccess-refresh" class="button secondary" ${busy ? 'disabled' : ''}>${busy ? tHtml('Loading reports…') : tHtml('Load reports')}</button>` : ''}
      ${snapshot.downloadedAt && config.enabled ? `<p class="muted">${tHtml('Local copy')}: ${escape(new Date(snapshot.downloadedAt).toLocaleString(locale()))}</p>` : ''}
      ${message ? `<p role="status" class="notice">${escape(message)}</p>` : ''}
    </section>
    ${config.enabled ? markup`
      <div class="goaccess-grid">${reports.map(item => markup`
        <button class="panel goaccess-card" data-goaccess-report="${escape(item.id)}" aria-pressed="${String(selected === item.id)}">
          <h2>${escape(item.label)}</h2>
          ${item.hostname ? `<p class="goaccess-hostname muted">${escape(item.hostname)}</p>` : ''}
          <dl><div><dt>${tHtml('Requests')}</dt><dd>${number(item.summary.requests)}</dd></div>
              <div><dt>${tHtml('Estimated visitors')}</dt><dd>${number(item.summary.visitors)}</dd></div></dl>
          <p class="muted">${item.status === 'waiting-for-logs' ? tHtml('Waiting for dedicated logs') : tHtml('Last prepared') + ': ' + escape(new Date(item.generatedAt).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</p>
        </button>`).join('')}</div>
      <p class="muted">${tHtml('Reports cover imported logs, with up to one year of history. Visitor counts are estimates; requests include assets, bots and APIs.')}</p>
      ${!reports.length ? `<p>${tHtml('No reports yet.')}</p>` : ''}
      ${report?.file ? markup`<section class="panel"><div class="section-heading"><h2>${escape(report.label)}</h2></div>
        <iframe class="goaccess-report" title="${escape(report.label)}" src="/api/goaccess/reports/${escape(report.id)}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></section>` : ''}` : ''}`;
}

export function bindGoAccess(render) {
  redraw = () => render({ force: true });
  document.addEventListener('click', async event => {
    const card = event.target.closest('[data-goaccess-report]');
    if (card) { selected = card.dataset.goaccessReport; redraw(); }
    if (!event.target.closest('#goaccess-refresh') || busy) return;
    busy = true; message = ''; redraw();
    try { snapshot = await api('/api/goaccess/refresh', {}); }
    catch (error) { message = error.message; }
    finally { busy = false; redraw(); }
  });
}
