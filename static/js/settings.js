/*
 * Settings dialog. Every supported setting is edited here and validated by the
 * backend (orbit_config.py). Appearance changes preview at once; Cancel restores.
 */
import { applyReadability } from './appearance.js';
import { api } from './api.js';
import { escape, markup } from './html.js';
import { onLanguageChange, setLanguage, t, tHtml } from './i18n.js';
import { icon } from './icons.js';
import { poll } from './refresh.js';
import { render } from './render.js';
import { store } from './store.js';
import { notify } from './toast.js';

const dialog = document.getElementById('settings-dialog');
const field = (key) => document.getElementById('setting-' + key);
const intervalLabels = { mac: 'Mac storage', projects: 'Projects and Git', moon: 'Server', ddev: 'DDEV', docker: 'Docker / Colima', sizes: 'Folder sizes', services: 'Local services' };

let draft;
let detected;

/* Appearance, also applied on every redraw of the dashboard */

export function applyAppearance(config) {
  setLanguage(config.language || 'en');
  // While the dialog is open, its fields are a preview that polling must not undo.
  const preview = dialog.open && draft;
  document.documentElement.dataset.theme = preview ? field('theme').value : config.theme || 'system';
  document.documentElement.dataset.palette = preview ? field('palette').value : config.palette || 'orbit';
  applyReadability(preview ? { ...Object.fromEntries(['font_size', 'contrast', 'zoom'].map(key => [key, Number(field(key).value)])), density: field('density').value } : config);
  const serverLink = document.querySelector('nav [data-view="moon"]');
  serverLink.hidden = !config.moon_enabled;
  document.querySelector('nav [data-view="goaccess"]').hidden = !config.goaccess?.enabled;
  document.getElementById('server-nav-label').textContent = t('Servers');
  document.querySelector('nav [data-view="services"]').hidden = !config.services_enabled;
  document.querySelector('nav [data-view="docker"]').hidden = !config.docker_enabled && !config.ddev_enabled;
}

/* Tabs */

function selectTab(key, focus = false) {
  const tab = dialog.querySelector(`[data-settings-tab="${key}"]`);
  if (!tab) return;
  for (const item of dialog.querySelectorAll('[data-settings-tab]')) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  dialog.querySelector('.settings-panels').scrollTop = 0;
  if (focus) {
    tab.focus();
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

// Arrow keys, Home and End move between tabs, as in native tab lists.
function moveTab(event) {
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const step = event.key === 'ArrowRight' ? 1 : -1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
  selectTab(tabs[next].dataset.settingsTab, true);
}

// Reveal the first invalid field, even when it belongs to an inactive tab or a closed folder row.
let revealing = false;
function revealInvalidField(event) {
  if (revealing) return;
  const panel = event.target.closest('[role="tabpanel"]');
  if (!panel) return;
  revealing = true;
  const row = event.target.closest('details');
  if (row) {
    row.hidden = false;
    row.open = true;
  }
  selectTab(panel.id.replace('settings-panel-', ''));
  setTimeout(() => { revealing = false; }, 0);
}

/* Project folders */

export function sourceRow(source = {}) {
  const row = document.createElement('details');
  row.open = !source.path;
  row.className = 'settings-source';
  const meta = [source.category, source.group].filter(Boolean).join(' · ');
  row.innerHTML = markup`
    <summary>
      <strong class="source-title">${escape(source.path || t('New folder'))}</strong>
      <span class="source-meta">${escape(meta)}</span>
    </summary>
    <div class="source-heading">
      <label>${tHtml('Project folder')}<input data-source="path" required placeholder="~/Projects" value="${escape(source.path || '')}"></label>
    </div>
    <div class="form-row">
      <label>${tHtml('Category')}<input data-source="category" maxlength="80" value="${escape(source.category || t('Projects'))}"></label>
      <label>${tHtml('Group')}<input data-source="group" maxlength="80" placeholder="${escape(t('Derived from subfolders'))}" value="${escape(source.group || '')}"></label>
    </div>
    <label class="settings-toggle"><input type="checkbox" data-source="archived" ${source.archived ? 'checked' : ''}>${tHtml('Archive projects here by default')}</label>
    <label class="settings-toggle"><input type="checkbox" data-source="plain_folders" ${source.plain_folders !== false ? 'checked' : ''}>${tHtml('Include direct folders without project files')}</label>
    <div class="source-actions">
      <button type="button" class="button secondary remove-source">${icon('close')}${tHtml('Remove project folder')}</button>
      <div class="source-removal" role="group" aria-label="${escape(t('Remove project folder'))}" hidden>
        <p>${tHtml('Remove this project folder from Orbit? Files on your Mac will stay untouched. The change takes effect when you save settings.')}</p>
        <div class="source-removal-actions">
          <button type="button" class="button secondary cancel-remove-source">${tHtml('Cancel')}</button>
          <button type="button" class="button confirm-remove-source">${tHtml('Remove folder')}</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('settings-sources').append(row);
}

// The summary shows path, category and group while a row is closed.
function updateSourceSummary(event) {
  const row = event.target.closest('.settings-source');
  if (!row) return;
  const value = (key) => row.querySelector(`[data-source="${key}"]`).value;
  row.querySelector('.source-title').textContent = value('path') || t('New folder');
  row.querySelector('.source-meta').textContent = ['category', 'group'].map(value).filter(Boolean).join(' · ');
}

function filterSources() {
  const query = document.getElementById('settings-source-search').value.trim().toLocaleLowerCase();
  for (const row of document.querySelectorAll('#settings-sources .settings-source')) {
    row.hidden = !['path', 'category', 'group'].some((key) => row.querySelector(`[data-source="${key}"]`).value.toLocaleLowerCase().includes(query));
  }
}

function addSource() {
  document.getElementById('settings-source-search').value = '';
  filterSources();
  sourceRow();
  document.querySelector('#settings-sources .settings-source:last-child input').focus();
}

/* Servers */

function serverRow(server = {}) {
  const row = document.createElement('div');
  row.className = 'settings-server settings-source';
  row.innerHTML = markup`
    <div class="settings-heading">
      <label class="settings-toggle"><input type="checkbox" data-server="enabled" ${server.enabled ? 'checked' : ''}>${tHtml('Check server')}</label>
      <button type="button" class="icon-button remove-server" aria-label="${escape(t('Remove server'))}">${icon('close')}</button>
    </div>
    <div class="form-row">
      <label>${tHtml('Display name')}<input data-server="label" maxlength="80" value="${escape(server.label || '')}"></label>
      <label>${tHtml('SSH alias')}<input data-server="host" placeholder="${escape(t('my-server'))}" value="${escape(server.host || '')}"></label>
    </div>
    <label class="settings-toggle"><input type="checkbox" data-server="show_in_overview" ${server.show_in_overview !== false ? 'checked' : ''}>${tHtml('Show in overview')}</label>
    <label class="settings-toggle"><input type="checkbox" data-server="automatic" ${server.automatic ? 'checked' : ''}>${tHtml('Allow automatic read-only SSH queries')}</label>
    <p class="muted">${tHtml('One SSH connection every five minutes or longer. Reads system, RAM and disk data. No installation, sudo or port scanning. Saving activates this permission.')}</p>
    <label class="settings-toggle"><input type="checkbox" data-server="probe_services" ${server.probe_services ? 'checked' : ''}>${tHtml('Also read running services')}</label>
    <label class="settings-toggle"><input type="checkbox" data-server="probe_ports" ${server.probe_ports ? 'checked' : ''}>${tHtml('Also read listening ports')}</label>
    <p class="muted">${tHtml('Leave the status command empty for automatic SSH only, or keep it to combine both sources.')}</p>
    <label>${tHtml('Server status command')}<input data-server="command" value="${escape(server.command ?? '')}"></label>
    <label>${tHtml('Website links')}<textarea data-server="website_links" rows="2" placeholder="app.example.com = https://app.example.com/dashboard">${escape(Object.entries(server.website_links || {}).map(([label, url]) => `${label} = ${url}`).join('\n'))}</textarea></label>
    <p class="muted">${tHtml('Optional custom links, one website label = URL per line. Changes only the link opened in Orbit, not the server check.')}</p>
  `;
  document.getElementById('settings-servers').append(row);
}

function addServer() {
  serverRow();
  document.querySelector('.settings-server:last-child [data-server="label"]').focus();
}

/* Intervals */

function intervalFields(config) {
  const intervals = Object.entries(config.intervals).map(([key, seconds]) => markup`
    <label>
      ${tHtml(intervalLabels[key])}<input type="number" data-interval="${key}" min="${key === 'sizes' ? 300 : 15}" max="86400" required value="${seconds}"><span class="muted">${key === 'projects' ? tHtml('Seconds, in the background') : tHtml('Seconds')}</span>
    </label>
  `);
  const dashboard = markup`
    <label>
      ${tHtml('Projects and Git in the foreground')}<input type="number" id="setting-projects_foreground_interval" min="15" max="86400" required value="${config.projects_foreground_interval}"><span class="muted">${tHtml('Seconds, while the window is active')}</span>
    </label>
    <label>
      ${tHtml('Dashboard view')}<input type="number" id="setting-ui_refresh" min="5" max="300" required value="${config.ui_refresh}"><span class="muted">${tHtml('Seconds, while the window is active')}</span>
    </label>
    <label class="settings-toggle"><input type="checkbox" id="setting-projects_background_enabled" ${config.projects_background_enabled ? 'checked' : ''}>${tHtml('Check projects in the background')}</label>
    <p class="muted">${tHtml('When disabled, project and folder-size checks pause in the background. Returning to the foreground checks projects immediately. Checks already running finish normally.')}</p>
  `;
  return intervals.join('') + dashboard;
}

/* Environment detection */

async function detectSetup(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    detected = await api('/api/detect');
    const known = new Set([...document.querySelectorAll('[data-source="path"]')].map((input) => input.value));
    detected.sources = detected.sources.filter((source) => !known.has(source.path));
    const tools = Object.entries(detected.tools).filter(([, found]) => found).map(([name]) => name);
    const found = [tools.join(', ') || t('no optional tools'), ...(detected.editors.length ? [detected.editors.join(', ')] : [])].join(' · ');
    const suggestions = detected.sources.map((source, index) => markup`
      <label class="settings-toggle"><input type="checkbox" data-suggestion="${index}" checked>${escape(source.path)}</label>
    `);
    document.getElementById('settings-detection').innerHTML = markup`
      <p class="muted">${tHtml('Detected: {tools}', { tools: escape(found) })}</p>
      ${suggestions}
      <button type="button" class="button secondary" id="apply-detection">${tHtml('Apply selection and tools')}</button>
      <p class="muted">${tHtml('Existing folders are kept. Changes take effect only after saving.')}</p>
    `;
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

function applyDetection(event) {
  if (!event.target.closest('#apply-detection')) return;
  for (const input of document.querySelectorAll('[data-suggestion]:checked')) sourceRow(detected.sources[Number(input.dataset.suggestion)]);
  for (const key of ['ddev', 'docker']) if (detected.tools[key]) field(key + '_enabled').checked = true;
  if (field('terminal').value === 'auto' && detected.tools.cmux) field('terminal').value = 'cmux';
  if (field('editor').value === 'none' && detected.editors.length) field('editor').value = detected.editors[0];
  document.getElementById('settings-detection').replaceChildren();
}

/* Opening and saving */

function validateGoAccessFields() {
  const enabled = field('goaccess_enabled').checked;
  for (const key of ['goaccess_host', 'goaccess_command']) field(key).required = enabled;
}


export async function openSettings(section = 'appearance') {
  try {
    draft = await api('/api/settings');
    document.getElementById('settings-source-search').value = '';
    document.getElementById('settings-sources').replaceChildren();
    draft.sources.forEach((source) => sourceRow(source));
    document.getElementById('settings-servers').replaceChildren();
    draft.servers.forEach((server) => serverRow(server));
    for (const key of ['scan_depth', 'terminal', 'editor', 'theme', 'palette', 'language', 'density']) field(key).value = draft[key];
    for (const key of ['font_size', 'contrast', 'zoom']) {
      const select = field(key);
      select.querySelectorAll('[data-custom]').forEach(option => option.remove());
      const value = String(draft[key] ?? 100);
      // Keep an existing percentage between the new five-percent steps.
      if (![...select.options].some(option => option.value === value)) {
        const option = new Option(value + '%', value);
        option.dataset.custom = 'true';
        select.add(option);
      }
      select.value = value;
    }
    for (const key of ['services_enabled', 'ddev_enabled', 'docker_enabled', 'remember_list_preferences', 'show_next_step', 'show_storage', 'show_last_changed', 'show_ddev']) field(key).checked = draft[key];
    field('goaccess_enabled').checked = Boolean(draft.goaccess?.enabled);
    field('goaccess_host').value = draft.goaccess?.host || '';
    field('goaccess_command').value = draft.goaccess?.command || '';
    validateGoAccessFields();
    field('excluded_dirs').value = draft.excluded_dirs.join('\n');
    field('category_order').value = (draft.category_order || []).join('\n');
    document.getElementById('settings-intervals').innerHTML = intervalFields(draft);
    document.getElementById('settings-detection').replaceChildren();
    document.getElementById('settings-error').hidden = true;
    selectTab(typeof section === 'string' ? section : 'appearance');
    dialog.showModal();
  } catch (error) {
    notify(error.message);
  }
}

const rowValues = (row, attribute) => Object.fromEntries([...row.querySelectorAll(`[data-${attribute}]`)]
  .map((input) => [input.dataset[attribute], input.type === 'checkbox' ? input.checked : input.value]));

function collectSettings() {
  const config = structuredClone(draft);
  config.sources = [...document.querySelectorAll('#settings-sources .settings-source')].map((row) => rowValues(row, 'source'));
  config.servers = [...document.querySelectorAll('.settings-server')].map((row) => {
    const server = rowValues(row, 'server');
    server.website_links = Object.fromEntries(server.website_links.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error(t('Use website label = URL for each custom link.'));
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
    return server;
  });
  for (const key of ['terminal', 'editor', 'theme', 'palette', 'language', 'density']) config[key] = field(key).value;
  for (const key of ['services_enabled', 'ddev_enabled', 'docker_enabled', 'remember_list_preferences', 'show_next_step', 'show_storage', 'show_last_changed', 'show_ddev']) config[key] = field(key).checked;
  config.goaccess = { enabled: field('goaccess_enabled').checked, host: field('goaccess_host').value, command: field('goaccess_command').value };
  // The single legacy server fields are replaced by the server list.
  Object.assign(config, { moon_enabled: false, moon_host: '', moon_command: 'moon-status', moon_label: 'Server' });
  for (const key of ['font_size', 'contrast', 'zoom']) config[key] = Number(field(key).value);
  config.scan_depth = Number(field('scan_depth').value);
  config.category_order = field('category_order').value.split('\n').map(value => value.trim()).filter(Boolean);
  config.excluded_dirs = field('excluded_dirs').value.split('\n').map((value) => value.trim()).filter(Boolean);
  config.ui_refresh = Number(field('ui_refresh').value);
  config.projects_foreground_interval = Number(field('projects_foreground_interval').value);
  config.projects_background_enabled = field('projects_background_enabled').checked;
  config.intervals = Object.fromEntries([...document.querySelectorAll('[data-interval]')].map((input) => [input.dataset.interval, Number(input.value)]));
  return config;
}

async function saveSettings(event) {
  event.preventDefault();
  const button = document.getElementById('save-settings');
  const errorBox = document.getElementById('settings-error');
  button.disabled = true;
  errorBox.hidden = true;
  try {
    store.data.config = await api('/api/settings', collectSettings());
    dialog.close();
    render({ force: true });
    notify(t('Settings saved. Your workspace is updating.'));
    await poll();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
}

export function bindSettings() {
  onLanguageChange(() => {
    if (!dialog.open) return;
    // Translate generated interval labels without discarding unsaved values.
    const config = { ...draft, ui_refresh: Number(field('ui_refresh').value),
      projects_foreground_interval: Number(field('projects_foreground_interval').value),
      projects_background_enabled: field('projects_background_enabled').checked,
      intervals: Object.fromEntries([...document.querySelectorAll('[data-interval]')].map(input => [input.dataset.interval, Number(input.value)])) };
    document.getElementById('settings-intervals').innerHTML = intervalFields(config);
  });
  field('goaccess_enabled').addEventListener('change', validateGoAccessFields);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.data?.config) applyAppearance(store.data.config);
  });
  for (const key of ['font_size', 'contrast', 'zoom']) field(key).addEventListener('input', () => applyAppearance(store.data.config));
  document.getElementById('reset-readability').addEventListener('click', () => {
    for (const key of ['font_size', 'contrast', 'zoom']) field(key).value = 100;
    applyAppearance(store.data.config);
  });
  const tabs = dialog.querySelector('[role="tablist"]');
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-settings-tab]');
    if (tab) selectTab(tab.dataset.settingsTab);
  });
  tabs.addEventListener('keydown', moveTab);
  document.getElementById('settings-form').addEventListener('invalid', revealInvalidField, true);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('.close-settings')) dialog.close();
    event.target.closest('.remove-server')?.closest('.settings-server').remove();
    const source = event.target.closest('.settings-source');
    if (source && event.target.closest('.remove-source')) {
      source.querySelector('.remove-source').hidden = true;
      source.querySelector('.source-removal').hidden = false;
      source.querySelector('.cancel-remove-source').focus();
    }
    if (source && event.target.closest('.cancel-remove-source')) {
      source.querySelector('.source-removal').hidden = true;
      source.querySelector('.remove-source').hidden = false;
      source.querySelector('.remove-source').focus();
    }
    if (source && event.target.closest('.confirm-remove-source')) {
      const next = source.nextElementSibling?.querySelector('summary')
        || source.previousElementSibling?.querySelector('summary')
        || document.getElementById('add-source');
      source.remove();
      next.focus();
    }
  });
  // Closing without saving restores the saved appearance.
  dialog.addEventListener('close', () => {
    if (store.data?.config) applyAppearance(store.data.config);
  });
  for (const key of ['theme', 'palette', 'language', 'density']) field(key).addEventListener('change', () => applyAppearance(store.data.config));

  document.getElementById('settings-sources').addEventListener('input', updateSourceSummary);
  document.getElementById('settings-source-search').addEventListener('input', filterSources);
  document.getElementById('add-source').addEventListener('click', addSource);
  document.getElementById('add-server').addEventListener('click', addServer);
  document.getElementById('detect-setup').addEventListener('click', detectSetup);
  document.getElementById('settings-detection').addEventListener('click', applyDetection);

  for (const id of ['settings', 'settings-topbar']) document.getElementById(id).addEventListener('click', openSettings);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.setup-settings');
    if (button) openSettings(button.dataset.settingsSection || 'appearance');
  });
}
