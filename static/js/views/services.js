/* Local background services. Personal annotations never change launchd or cron. */
import { api } from '../api.js';
import { ago } from '../format.js';
import { escape, markup } from '../html.js';
import { t, tHtml, locale } from '../i18n.js';
import { store } from '../store.js';
import { notify } from '../toast.js';

const statusLabels = {running: 'Running', waiting: 'Waiting for next start', failed: 'Last run failed', disabled: 'Disabled', not_loaded: 'Not loaded', unknown: 'Unknown', scheduled: 'Scheduled'};
const originLabels = {apple: 'Apple', third_party: 'Third party', own: 'My services'};
const preference = row => store.data.config.service_preferences?.[row.id] || {};
const isOwn = row => preference(row).own ?? row.is_own ?? false;
const origin = row => isOwn(row) ? 'own' : row.origin;
const basename = path => String(path || '').split('/').filter(Boolean).at(-1) || '–';
const definitionType = row => row.kind === 'cron' ? t('Cron job') : row.scope === 'system' ? 'LaunchDaemon' : 'LaunchAgent';

function scheduleLabel(row) {
  return ['On demand', 'Keep alive', 'At load'].includes(row.schedule) ? t(row.schedule) : row.schedule.startsWith('Every ') ? t('Every {seconds} seconds', {seconds: row.schedule.split(' ')[1]}) : row.schedule;
}

function select(key, label, options) {
  return markup`<label>${escape(label)} <select data-service-filter="${key}" aria-label="${escape(label)}">
    ${options.map(([value, text]) => markup`<option value="${value}" ${store.servicesSelection[key] === value ? 'selected' : ''}>${escape(text)}</option>`)}
  </select></label>`;
}

function rowMarkup(row) {
  const personal = preference(row);
  return markup`<tr data-service-id="${row.id}">
    <td><button class="icon-button" data-service-favorite="${row.id}" aria-label="${escape(t('Favorite'))}" aria-pressed="${String(!!personal.favorite)}">${personal.favorite ? '★' : '☆'}</button></td>
    <td class="service-name">
      <strong>${escape(row.display_name || row.name)}</strong>${row.display_name && row.display_name !== row.name && markup`<small class="service-identifier" title="${escape(row.name)}">${escape(row.name)}</small>`}
      ${personal.description && markup`<p>${escape(personal.description)}</p>`}<small>${escape(definitionType(row))} · ${escape(t(originLabels[origin(row)]))} · ${row.scope === 'user' ? tHtml('Current user') : tHtml('System-wide')}</small></td>
    <td><span class="badge ${row.status === 'failed' ? 'red' : row.status === 'running' ? '' : 'gray'}">${escape(t(statusLabels[row.status] || 'Unknown'))}</span>${row.pid > 0 && markup`<small>PID ${row.pid}</small>`}${row.exit_code != null && markup`<small>${tHtml('Exit code')} ${row.exit_code}</small>`}</td>
    <td>${escape(scheduleLabel(row))}</td>
    <td class="service-program"><div>${escape(basename(row.program))}</div>${row.script && markup`<small>${escape(basename(row.script))}</small>`}</td>
    <td><button class="button secondary" data-service-edit="${row.id}">${tHtml('Details')}</button></td>
  </tr>`;
}

export function servicesView() {
  if (!store.data.config.services_enabled) return `<div class="panel">${tHtml('Local service checks are disabled. Enable them in Settings → Tools.')}</div>`;
  const data = store.data.services || {items: [], notices: []};
  const selection = store.servicesSelection;
  const rows = data.items.filter(row => {
    const personal = preference(row);
    return (!selection.favorites || personal.favorite) &&
      (selection.origin === 'all' || origin(row) === selection.origin) &&
      (selection.scope === 'all' || row.scope === selection.scope) &&
      (selection.kind === 'all' || row.kind === selection.kind) &&
      (selection.status === 'all' || row.status === selection.status) &&
      [row.name, row.display_name, row.program, row.script, row.path, personal.description].join(' ').toLocaleLowerCase(locale()).includes(selection.query.toLocaleLowerCase(locale()));
  }).sort((a, b) => a.name.localeCompare(b.name, locale(), {numeric: true}));
  const hiddenPersonal = selection.origin === 'own' && !rows.length ? data.items.filter(isOwn).length : 0;
  const empty = hiddenPersonal
    ? markup`<p>${tHtml('{count} personal services are hidden by the other filters.', {count: hiddenPersonal})}</p><button class="button secondary" id="services-show-own">${tHtml('Show all my services')}</button>`
    : data.checked_at ? (selection.origin === 'own' ? tHtml('No personal services match these filters. Reset the other filters or mark a service as yours in Details.') : tHtml('No services match this selection.')) : tHtml('Checking');
  return markup`
    ${(data.notices || []).map(message => markup`<div class="notice">${escape(t(message))}</div>`)}
    <section class="panel services-panel">
      <div class="section-heading"><h2>${tHtml('Local services')}</h2><span>${escape(ago(data.checked_at))}</span></div>
      <div class="integration-toolbar">
        <label class="search-box"><input id="services-search" value="${escape(selection.query)}" placeholder="${escape(t('Search services …'))}" aria-label="${escape(t('Search services …'))}"></label>
        ${select('origin', t('Origin'), [['all', t('All')], ...Object.entries(originLabels).map(([key, value]) => [key, t(value)])])}
        ${select('scope', t('Runs as'), [['all', t('All')], ['user', t('Current user')], ['system', t('System-wide')]])}
        ${select('kind', t('Type'), [['all', t('All')], ['launchd', 'launchd'], ['cron', 'Cron']])}
        ${select('status', t('Status'), [['all', t('All')], ...Object.entries(statusLabels).map(([key, value]) => [key, t(value)])])}
        <label><input type="checkbox" data-service-filter="favorites" ${selection.favorites ? 'checked' : ''}> ${tHtml('Favorites only')}</label>
        <button class="button secondary" id="services-reset">${tHtml('Reset filters')}</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th aria-label="${escape(t('Favorite'))}" title="${escape(t('Favorite'))}">☆</th><th>${tHtml('Name')}</th><th>${tHtml('Status')}</th><th>${tHtml('Schedule')}</th><th>${tHtml('Program')}</th><th>${tHtml('Details')}</th></tr></thead>
        <tbody>${rows.length ? rows.map(rowMarkup) : markup`<tr><td colspan="6">${empty}</td></tr>`}</tbody>
      </table></div>
      <p class="scope">${tHtml('{shown} of {total} services', {shown: rows.length, total: data.items.length})}. ${tHtml('Reads launchd definitions and accessible crontabs. A waiting job is not a failure. Cron execution results and run times are unavailable.')}</p>
    </section>`;
}

export function servicesSummary() {
  if (!store.data.config.services_enabled) return '';
  const rows = (store.data.services?.items || []).filter(row => preference(row).favorite);
  if (!rows.length) return '';
  return markup`<section class="panel"><div class="section-heading"><h2><a href="#services">${tHtml('Favorite services')}</a></h2></div>
    ${rows.map(row => markup`<a class="service-summary" href="#services"><strong>${escape(preference(row).description || row.name)}</strong><span class="${row.status === 'failed' ? 'service-failed' : ''}">${escape(t(statusLabels[row.status] || 'Unknown'))}</span></a>`)}
  </section>`;
}

export function bindServicesEvents(render) {
  const content = document.getElementById('content');
  const dialog = document.getElementById('service-dialog');
  let editing;
  async function save(id, value) {
    store.data.config = await api('/api/services/' + id, value);
    render();
  }
  content.addEventListener('input', event => {
    if (event.target.id !== 'services-search') return;
    store.servicesSelection.query = event.target.value;
    render();
  });
  content.addEventListener('change', event => {
    const key = event.target.dataset.serviceFilter;
    if (!key) return;
    store.servicesSelection[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    event.target.blur();
    render();
  });
  content.addEventListener('click', async event => {
    const favorite = event.target.closest('[data-service-favorite]');
    const edit = event.target.closest('[data-service-edit]');
    if (event.target.closest('#services-show-own')) {
      Object.assign(store.servicesSelection, {query: '', origin: 'own', scope: 'all', status: 'all', kind: 'all', favorites: false});
      render();
    }
    if (event.target.closest('#services-reset')) {
      Object.assign(store.servicesSelection, {query: '', origin: 'all', scope: 'all', status: 'all', kind: 'all', favorites: false});
      render();
    }
    if (favorite) {
      const row = store.data.services.items.find(row => row.id === favorite.dataset.serviceFavorite);
      favorite.disabled = true;
      try { await save(row.id, {...preference(row), favorite: !preference(row).favorite}); }
      catch (error) { notify(error.message); favorite.disabled = false; }
    }
    if (edit) {
      editing = store.data.services.items.find(row => row.id === edit.dataset.serviceEdit);
      document.getElementById('service-label').textContent = editing.name;
      document.getElementById('service-description').value = preference(editing).description || '';
      document.getElementById('service-own').checked = !!isOwn(editing);
      document.getElementById('service-facts').innerHTML = markup`<dl class="service-facts">
        <dt>${tHtml('Type')}</dt><dd>${escape(definitionType(editing))}</dd>
        <dt>${tHtml('Status')}</dt><dd>${escape(t(statusLabels[editing.status] || 'Unknown'))}</dd>
        <dt>${tHtml('Schedule')}</dt><dd>${escape(scheduleLabel(editing))}</dd>
        ${editing.pid > 0 && markup`<dt>PID</dt><dd>${editing.pid}</dd>`}
        ${editing.exit_code != null && markup`<dt>${tHtml('Exit code')}</dt><dd>${editing.exit_code}</dd>`}
        <dt>${tHtml('Program')}</dt><dd>${escape(editing.program || '–')}</dd>
        ${editing.script && markup`<dt>${tHtml('Script')}</dt><dd>${escape(editing.script)}</dd>`}
        <dt>${tHtml('Configuration')}</dt><dd>${escape(editing.path)}</dd>
      </dl>`;
      document.getElementById('service-ownership-hint').textContent = editing.is_own
        ? t('Detected from a program or script in your home folder, or your user crontab. You can change this classification.')
        : t('Mark services you created yourself. Running under your user account alone does not make a service yours.');
      document.getElementById('service-favorite').checked = !!preference(editing).favorite;
      dialog.showModal();
    }
  });
  document.getElementById('service-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('service-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('service-save');
    button.disabled = true;
    try {
      await save(editing.id, {description: document.getElementById('service-description').value, own: document.getElementById('service-own').checked, favorite: document.getElementById('service-favorite').checked});
      dialog.close();
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  });
}
