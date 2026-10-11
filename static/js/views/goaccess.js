/* Optional GoAccess integration. Orbit reads prepared reports, never server logs. */
import { api } from '../api.js';
import { escape, markup } from '../html.js';
import { locale, t, tHtml } from '../i18n.js';
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
      <details class="goaccess-settings" ${config.enabled ? '' : 'open'}>
        <summary>${tHtml('GoAccess integration')}</summary>
        <p>${tHtml('GoAccess prepares reports on your server. Orbit only downloads them over SSH.')}</p>
        <p class="muted">${tHtml('Configure an SSH alias and a read-only export executable. No server changes are made by Orbit.')}</p>
        <form id="goaccess-settings">
          <label><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}> ${tHtml('Enable GoAccess')}</label>
          <div class="form-row">
            <label>${tHtml('SSH alias')}<input name="host" maxlength="200" value="${escape(config.host)}" placeholder="server-alias"></label>
            <label>${tHtml('Export command')}<input name="command" maxlength="4096" value="${escape(config.command)}" placeholder="/path/to/export"></label>
          </div>
          <button class="button secondary" ${busy ? 'disabled' : ''}>${tHtml('Save integration')}</button>
        </form>
      </details>
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
    if (event.target.closest('#configure-goaccess')) {
      document.getElementById('settings-dialog').close();
      location.hash = 'goaccess';
    }
    const card = event.target.closest('[data-goaccess-report]');
    if (card) { selected = card.dataset.goaccessReport; redraw(); }
    if (!event.target.closest('#goaccess-refresh') || busy) return;
    busy = true; message = ''; redraw();
    try { snapshot = await api('/api/goaccess/refresh', {}); }
    catch (error) { message = error.message; }
    finally { busy = false; redraw(); }
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'goaccess-settings') return;
    event.preventDefault();
    const fields = new FormData(event.target);
    const integration = { enabled: fields.has('enabled'), host: fields.get('host'), command: fields.get('command') };
    busy = true;
    try {
      const config = await api('/api/settings');
      config.goaccess = integration;
      store.data.config = await api('/api/settings', config);
      message = t('Integration saved.');
    } catch (error) { message = error.message; }
    finally { busy = false; redraw(); }
  });
}
