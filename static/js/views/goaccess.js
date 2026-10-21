/* Optional GoAccess integration. Orbit reads prepared reports, never server logs. */
import { api } from '../api.js';
import { escape, markup } from '../html.js';
import { locale, tHtml } from '../i18n.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { clearPageOverview, loadPageOverview, pageOverview, retryPageOverview } from './goaccess-pages.js';
import { dailyChart, dailyWindow, formatDay, isDaily, selectedDate } from './goaccess-days.js';

let snapshot = { reports: [] };
let busy = false;
let loading = false;
let message = '';
let redraw = () => {};

const selection = store.trafficSelection;
const configuredReports = () => {
  const config = store.data?.config?.goaccess;
  return config?.enabled && snapshot.source === config.host + ':' + config.command ? snapshot.reports : [];
};
const currentReport = () => configuredReports().find(item => item.id === selection.report);
const reportWindow = item => isDaily() ? dailyWindow(item) : item?.periods?.[selection.period] || (item && (selection.period === 'all' || item.status === 'waiting-for-logs') ? {summary: item.summary, file: item.file} : null);
const pageKey = () => {
  const report = currentReport();
  const range = reportWindow(report);
  return range?.file || range?.pagesAvailable ? [snapshot.source, snapshot.downloadedAt, report.id, selection.period, range.date || range.file].join('|') : null;
};

function showPages() {
  if (selection.mode !== 'pages') return;
  const key = pageKey();
  void loadPageOverview(key, selection.report, isDaily() ? selectedDate(currentReport()) : null, () => {
    if (store.view === 'goaccess' && selection.mode === 'pages' && pageKey() === key) redraw();
  });
}

function selectReport() {
  const reports = configuredReports();
  if (!reports.some(item => item.id === selection.report)) selection.report = reports[0]?.id || null;
}

export async function loadGoAccess() {
  // Do not overlap cache reads or replace an active download's result.
  if (loading || busy) return;
  loading = true;
  if (store.view === 'goaccess') redraw();

  try {
    const next = await api('/api/goaccess');
    if (next.source !== snapshot.source || next.downloadedAt !== snapshot.downloadedAt) clearPageOverview();
    snapshot = next;
    selectReport();
    message = '';
  } catch (error) {
    message = error.message;
  } finally {
    loading = false;
  }

  if (store.view === 'goaccess') { redraw(); showPages(); }
}

export function goaccessView() {
  const config = store.data?.config?.goaccess || { enabled: false, host: '', command: '' };
  const reports = configuredReports();
  const report = currentReport();
  const {period, report: selected} = selection;
  const number = value => value === undefined ? '—' : Number(value).toLocaleString(locale());
  const coverage = range => {
    if (range?.date) return formatDay(range.date);
    if (!range?.dataStart || !range?.dataEnd) return '';
    const formatter = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
    return formatter.formatRange(new Date(range.dataStart + 'T12:00:00'), new Date(range.dataEnd + 'T12:00:00'));
  };
  const prepared = item => item.generatedAt ? new Date(item.generatedAt).toLocaleString(locale()) : '';
  const current = reportWindow(report);
  const theme = document.documentElement.dataset.theme;
  const dark = theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  const periodLabel = isDaily() ? formatDay(selectedDate(report)) : period === '7' ? tHtml('Last 7 days') : period === '30' ? tHtml('Last 30 days') : tHtml('All available history');
  return markup`
    <section class="panel goaccess-toolbar">
      <label class="goaccess-period">${tHtml('Period')}<select id="goaccess-period">
        <option value="today" ${period === 'today' ? 'selected' : ''}>${tHtml('Today')}</option>
        <option value="yesterday" ${period === 'yesterday' ? 'selected' : ''}>${tHtml('Yesterday')}</option>
        <option value="date" ${period === 'date' ? 'selected' : ''}>${tHtml('Specific day')}</option>
        <option value="7" ${period === '7' ? 'selected' : ''}>${tHtml('Last 7 days')}</option>
        <option value="30" ${period === '30' ? 'selected' : ''}>${tHtml('Last 30 days')}</option>
        <option value="all" ${period === 'all' ? 'selected' : ''}>${tHtml('All available history')}</option>
      </select></label>
      ${period === 'date' ? `<label class="goaccess-period">${tHtml('Date')}<input type="date" id="goaccess-date" value="${escape(selection.date)}"></label>` : ''}
      <div class="goaccess-actions">
        ${config.enabled ? markup`<button id="goaccess-refresh" class="button secondary" ${busy || loading ? 'disabled' : ''}>${busy || loading ? tHtml('Loading reports…') : tHtml('Load reports')}</button>` : ''}
        <button type="button" class="button secondary setup-settings" data-settings-section="tools">${icon('settings')}${tHtml('Settings')}</button>
      </div>
      ${message ? `<p role="status" class="notice">${escape(message)}</p>` : ''}
    </section>
    ${config.enabled ? markup`
      <div class="goaccess-grid">${reports.map(item => { const range = reportWindow(item); return markup`
        <button class="panel goaccess-card" data-goaccess-report="${escape(item.id)}" aria-pressed="${String(selected === item.id)}">
          <div class="goaccess-card-heading">
            <h2 title="${escape(item.label)}">${escape(item.label)}</h2>
            <p class="goaccess-hostname muted" title="${escape(item.hostname || '')}">${item.hostname ? escape(item.hostname) : '&nbsp;'}</p>
          </div>
          <dl><div><dt>${isDaily() && item.daily?.scope === 'successful-content-get' ? tHtml('Page requests') : tHtml('All requests')}</dt><dd>${item.status === 'waiting-for-logs' ? '—' : number(range?.summary.requests)}</dd></div>
              <div><dt title="${tHtml('Estimated visitors')}">${tHtml('Visitors')}</dt><dd>${item.status === 'waiting-for-logs' ? '—' : number(range?.summary.visitors)}</dd></div></dl>
          <p class="muted goaccess-card-footer" title="${range?.dataStart ? tHtml('Available data') + ': ' + escape(coverage(range)) + '. ' : ''}${item.generatedAt ? tHtml('Last prepared') + ': ' + escape(prepared(item)) : ''}">${item.status === 'waiting-for-logs' ? tHtml('Awaiting data') : !range ? tHtml('Load reports to enable date ranges.') : range.daily ? range.missing ? tHtml('No saved data for this day.') : escape(coverage(range)) : !range.file ? tHtml('No requests in this period.') : escape(coverage(range))}</p>
        </button>`; }).join('')}</div>
      <div class="goaccess-footnote">
      ${snapshot.downloadedAt ? `<p class="muted">${tHtml('Local copy')}: ${escape(new Date(snapshot.downloadedAt).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</p>` : ''}
      <p class="muted">${isDaily() ? tHtml('Daily counts use the saved snapshot. Missing data is shown as unavailable, not zero.') : tHtml('Date-range totals use prepared reports without the current log. The daily chart uses its own snapshot shown below.')}</p></div>
      ${!reports.length ? `<p>${tHtml('No reports yet.')}</p>` : ''}
      ${report ? markup`<section class="panel goaccess-pages"><div class="section-heading"><h2>${escape(report.label)}</h2><span>${periodLabel}</span></div>
        <div class="goaccess-view-switch" role="group" aria-label="${tHtml('Traffic view')}">
          <button class="button secondary" data-goaccess-mode="pages" aria-pressed="${String(selection.mode === 'pages')}">${tHtml('Visited pages')}</button>
          <button class="button secondary" data-goaccess-mode="technical" aria-pressed="${String(selection.mode === 'technical')}" ${isDaily() ? 'disabled' : ''}>${tHtml('Technical report')}</button>
        </div>
        ${selection.mode === 'pages' ? dailyChart(report) : ''}
        ${current?.daily ? current.missing ? `<p class="notice">${tHtml('No saved data for this day. Load reports to get a newer snapshot.')}</p>` : current.pagesAvailable ? pageOverview(pageKey(), true) : `<p class="notice">${tHtml('Daily page details require an updated server export. The chart still shows the available daily visitor totals.')}</p>` : current?.file ? selection.mode === 'pages' ? pageOverview(pageKey()) : markup`
          <iframe class="goaccess-report" title="${escape(report.label)}" src="/api/goaccess/reports/${escape(report.id)}?period=${period}&amp;theme=${dark ? 'dark' : 'light'}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>` : `<p class="muted">${!current ? tHtml('Load reports to enable date ranges.') : report.status === 'waiting-for-logs' ? tHtml('Awaiting data') : tHtml('No requests in this period.')}</p>`}
      </section>` : ''}` : ''}`;
}

export function bindGoAccess(render) {
  redraw = () => render({ force: true });
  document.addEventListener('input', event => {
    if (event.target.id !== 'goaccess-search') return;
    selection.query = event.target.value;
    selection.page = 1;
    redraw();
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'goaccess-period') {
      selection.period = event.target.value;
      if (isDaily()) selection.mode = 'pages';
      if (selection.period === 'date' && !selection.date) selection.date = selectedDate({...currentReport()}) || new Date().toISOString().slice(0, 10);
      selection.page = 1;
      redraw(); showPages();
    } else if (event.target.id === 'goaccess-date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return;
      selection.date = event.target.value; selection.page = 1; redraw(); showPages();
    } else if (event.target.id === 'goaccess-page-sort') {
      selection.sort = event.target.value; selection.page = 1; redraw();
    } else if (event.target.id === 'goaccess-page-merge') {
      selection.merged = event.target.checked; selection.page = 1; redraw();
    }
  });
  document.addEventListener('click', async event => {
    const day = event.target.closest('[data-goaccess-day]');
    if (day) {
      selection.date = day.dataset.goaccessDay; selection.period = 'date'; selection.mode = 'pages';
      selection.page = 1; redraw(); showPages();
    }
    const card = event.target.closest('[data-goaccess-report]');
    if (card) { selection.report = card.dataset.goaccessReport; selection.page = 1; redraw(); showPages(); }
    const mode = event.target.closest('[data-goaccess-mode]');
    if (mode) { selection.mode = mode.dataset.goaccessMode; redraw(); showPages(); }
    const pagination = event.target.closest('[data-goaccess-page]');
    if (pagination) { selection.page = Math.max(1, selection.page + Number(pagination.dataset.goaccessPage)); redraw(); }
    if (event.target.closest('#goaccess-pages-retry')) { retryPageOverview(pageKey()); showPages(); }
    if (!event.target.closest('#goaccess-refresh') || busy || loading) return;
    busy = true; message = ''; redraw();
    try { snapshot = await api('/api/goaccess/refresh', {}); clearPageOverview(); selectReport(); }
    catch (error) { message = error.message; }
    finally { busy = false; redraw(); showPages(); }
  });
}
