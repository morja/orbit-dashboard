/* Optional GoAccess integration. Orbit reads prepared reports, never server logs. */
import { api } from '../api.js';
import { escape, markup } from '../html.js';
import { locale, tHtml } from '../i18n.js';
import { store } from '../store.js';
import { icon } from '../icons.js';

let snapshot = { reports: [] };
let selected = null;
let period = '30';
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
  const number = value => value === undefined ? '—' : Number(value).toLocaleString(locale());
  const coverage = range => {
    if (!range?.dataStart || !range?.dataEnd) return '';
    const formatter = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
    return formatter.formatRange(new Date(range.dataStart + 'T12:00:00'), new Date(range.dataEnd + 'T12:00:00'));
  };
  const prepared = item => item.generatedAt ? new Date(item.generatedAt).toLocaleString(locale()) : '';
  const window = item => item.periods?.[period] || (period === 'all' || item.status === 'waiting-for-logs' ? { summary: item.summary, file: item.file } : null);
  const current = report ? window(report) : null;
  const theme = document.documentElement.dataset.theme;
  const dark = theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  const periodLabel = period === '7' ? tHtml('Last 7 days') : period === '30' ? tHtml('Last 30 days') : tHtml('All available history');
  return markup`
    <section class="panel goaccess-toolbar">
      <label class="goaccess-period">${tHtml('Period')}<select id="goaccess-period">
        <option value="7" ${period === '7' ? 'selected' : ''}>${tHtml('Last 7 days')}</option>
        <option value="30" ${period === '30' ? 'selected' : ''}>${tHtml('Last 30 days')}</option>
        <option value="all" ${period === 'all' ? 'selected' : ''}>${tHtml('All available history')}</option>
      </select></label>
      <div class="goaccess-actions">
        ${config.enabled ? markup`<button id="goaccess-refresh" class="button secondary" ${busy ? 'disabled' : ''}>${busy ? tHtml('Loading reports…') : tHtml('Load reports')}</button>` : ''}
        <button type="button" class="button secondary setup-settings" data-settings-section="tools">${icon('settings')}${tHtml('Settings')}</button>
      </div>
      ${message ? `<p role="status" class="notice">${escape(message)}</p>` : ''}
    </section>
    ${config.enabled ? markup`
      <div class="goaccess-grid">${reports.map(item => { const range = window(item); return markup`
        <button class="panel goaccess-card" data-goaccess-report="${escape(item.id)}" aria-pressed="${String(selected === item.id)}">
          <div class="goaccess-card-heading">
            <h2 title="${escape(item.label)}">${escape(item.label)}</h2>
            <p class="goaccess-hostname muted" title="${escape(item.hostname || '')}">${item.hostname ? escape(item.hostname) : '&nbsp;'}</p>
          </div>
          <dl><div><dt>${tHtml('Requests')}</dt><dd>${item.status === 'waiting-for-logs' ? '—' : number(range?.summary.requests)}</dd></div>
              <div><dt title="${tHtml('Estimated visitors')}">${tHtml('Visitors')}</dt><dd>${item.status === 'waiting-for-logs' ? '—' : number(range?.summary.visitors)}</dd></div></dl>
          <p class="muted goaccess-card-footer" title="${range?.dataStart ? tHtml('Available data') + ': ' + escape(coverage(range)) + '. ' : ''}${item.generatedAt ? tHtml('Last prepared') + ': ' + escape(prepared(item)) : ''}">${item.status === 'waiting-for-logs' ? tHtml('Awaiting data') : !range ? tHtml('Load reports to enable date ranges.') : !range.file ? tHtml('No requests in this period.') : escape(coverage(range))}</p>
        </button>`; }).join('')}</div>
      <div class="goaccess-footnote">
      ${snapshot.downloadedAt ? `<p class="muted">${tHtml('Local copy')}: ${escape(new Date(snapshot.downloadedAt).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</p>` : ''}
      <p class="muted">${tHtml('Counts use the selected period. Current unrotated logs are excluded; visitors are daily estimates including bots.')}</p></div>
      ${!reports.length ? `<p>${tHtml('No reports yet.')}</p>` : ''}
      ${current?.file ? markup`<section class="panel"><div class="section-heading"><h2>${escape(report.label)} · ${periodLabel}</h2></div>
        <iframe class="goaccess-report" title="${escape(report.label)}" src="/api/goaccess/reports/${escape(report.id)}?period=${period}&amp;theme=${dark ? 'dark' : 'light'}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></section>` : ''}` : ''}`;
}

export function bindGoAccess(render) {
  redraw = () => render({ force: true });
  document.addEventListener('change', event => {
    if (event.target.id !== 'goaccess-period') return;
    period = event.target.value; redraw();
  });
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
