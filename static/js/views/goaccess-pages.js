/* A page-focused view of saved GoAccess counts. No report scripts run here. */
import { api } from '../api.js';
import { escape, markup } from '../html.js';
import { locale, tHtml } from '../i18n.js';
import { store } from '../store.js';

const results = new Map();
const pageSize = 25;
const number = value => value === null || value === undefined ? '—' : Number(value).toLocaleString(locale());

export function clearPageOverview() {
  results.clear();
}

export async function loadPageOverview(key, report, redraw) {
  if (!key || results.has(key)) return;
  const result = {loading: true};
  results.set(key, result);
  redraw();
  try {
    result.data = await api(`/api/goaccess/pages/${encodeURIComponent(report)}?period=${store.trafficSelection.period}`);
  } catch (error) {
    result.error = error.message;
  } finally {
    result.loading = false;
    if (store.view === 'goaccess') redraw();
  }
}

function groupedPages(rows, merged) {
  if (!merged) return rows;
  const groups = new Map();
  for (const row of rows) {
    const path = row.path.replace(/^\/(en|de)(?=\/|$)/, '') || '/';
    const existing = groups.get(path);
    if (existing) {
      existing.requests += row.requests;
      existing.paths.push(row.path);
      // The same visitor may use both languages; their counts cannot be added.
      existing.visitors = null;
    } else {
      groups.set(path, {...row, path, paths: [row.path]});
    }
  }
  return [...groups.values()];
}

export function pageOverview(key) {
  const result = results.get(key);
  if (!result || result.loading) return `<p class="muted" role="status">${tHtml('Loading page overview…')}</p>`;
  if (result.error) return markup`<p role="status" class="notice">${escape(result.error)}</p>
    <button class="button secondary" id="goaccess-pages-retry">${tHtml('Try again')}</button>`;
  const data = result.data;
  if (!data?.available) return `<p class="muted">${tHtml('This report has no readable page data. The technical report is still available.')}</p>`;

  const selection = store.trafficSelection;
  const all = groupedPages(data.rows, selection.merged);
  const query = selection.query.trim().toLocaleLowerCase();
  const rows = all.filter(row => (row.paths || [row.path]).some(path => path.toLocaleLowerCase().includes(query)));
  rows.sort((a, b) => selection.sort === 'path' ? a.path.localeCompare(b.path, locale()) :
    (b[selection.sort] ?? -1) - (a[selection.sort] ?? -1) || a.path.localeCompare(b.path, locale()));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  selection.page = Math.min(selection.page, pageCount);
  const visible = rows.slice((selection.page - 1) * pageSize, selection.page * pageSize);
  const max = all.reduce((highest, row) => Math.max(highest, row.requests), 1);

  return markup`
    ${data.partial ? `<p class="notice goaccess-page-note" role="status">${tHtml('The URL list may be incomplete. Counts cover the available rows.')}</p>` : ''}
    <dl class="goaccess-page-metrics">
      <div><dt>${tHtml('Page requests')}</dt><dd>${number(data.requests)}</dd></div>
      <div><dt>${tHtml('Different pages')}</dt><dd>${number(all.length)}</dd></div>
    </dl>
    <p class="muted goaccess-page-description">${tHtml('GET requests to content URLs. Assets, technical endpoints and admin pages are filtered out.')}</p>
    <div class="goaccess-page-filters">
      <label class="goaccess-page-search">${tHtml('Search pages')}
        <input id="goaccess-search" type="search" value="${escape(selection.query)}" placeholder="/teachers" autocomplete="off">
      </label>
      <label>${tHtml('Sort pages')}<select id="goaccess-page-sort">
        <option value="requests" ${selection.sort === 'requests' ? 'selected' : ''}>${tHtml('Most requested')}</option>
        <option value="visitors" ${selection.sort === 'visitors' ? 'selected' : ''}>${tHtml('Most visitors')}</option>
        <option value="path" ${selection.sort === 'path' ? 'selected' : ''}>${tHtml('Page path')}</option>
      </select></label>
      <label class="goaccess-page-merge"><input id="goaccess-page-merge" type="checkbox" ${selection.merged ? 'checked' : ''}>${tHtml('Combine English and German paths')}</label>
    </div>
    <div class="table-wrap"><table class="goaccess-page-table">
      <thead><tr><th scope="col">${tHtml('Page path')}</th><th scope="col">${tHtml('Page requests')}</th><th scope="col">${tHtml('Estimated visitors')}</th></tr></thead>
      <tbody>${visible.map(row => markup`<tr>
        <td><div class="goaccess-page-path">${escape(row.path)}</div>
          ${row.paths?.length > 1 ? `<div class="muted goaccess-page-variants">${row.paths.map(escape).join(' · ')}</div>` : ''}</td>
        <td class="goaccess-page-count"><span>${number(row.requests)}</span><span class="goaccess-page-bar" aria-hidden="true" style="--page-share:${Math.round(row.requests / max * 100)}%"></span></td>
        <td class="goaccess-page-visitors">${number(row.visitors)}</td>
      </tr>`).join('') || `<tr><td colspan="3" class="empty">${query ? tHtml('No pages match your search.') : tHtml('No content page requests in this report.')}</td></tr>`}</tbody>
    </table></div>
    <div class="goaccess-page-pagination">
      <p class="muted" role="status">${tHtml('Showing {start} to {end} of {total} pages', {start: number(rows.length ? (selection.page - 1) * pageSize + 1 : 0), end: number(Math.min(selection.page * pageSize, rows.length)), total: number(rows.length)})}</p>
      <div><button class="button secondary" data-goaccess-page="-1" ${selection.page <= 1 ? 'disabled' : ''}>${tHtml('Previous page')}</button>
      <span>${tHtml('Page {page} of {pages}', {page: number(selection.page), pages: number(pageCount)})}</span>
      <button class="button secondary" data-goaccess-page="1" ${selection.page >= pageCount ? 'disabled' : ''}>${tHtml('Next page')}</button></div>
    </div>
    <p class="muted goaccess-page-note">${tHtml('Log estimates may include bots, redirects and failed requests. Visitor counts are daily estimates and are not added across pages or URL variants.')}</p>
    ${selection.merged ? `<p class="muted goaccess-page-note">${tHtml('Combined paths add request counts. Visitors are shown only when a row has a single URL variant.')}</p>` : ''}`;
}

export function retryPageOverview(key) {
  results.delete(key);
}
