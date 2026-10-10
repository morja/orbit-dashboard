/* Project list: category tabs, state filters, search, group and the sortable table. */
import { ddevBadge, gitBadge } from '../badges.js';
import { ago, bytes, relativeTime } from '../format.js';
import { escape, markup } from '../html.js';
import { locale, systemMessage, t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { saveListPreferences } from '../list-preferences.js';

export const stateNames = { active: 'Active', paused: 'Paused', blocked: 'Blocked', done: 'Done', archived: 'Archived' };

const statusFilters = {
  changes: { label: 'Uncommitted changes', test: (project) => project.git?.status === 'dirty' },
  unpushed: { label: 'Local commits', test: (project) => project.git?.ahead > 0 },
  running: { label: 'DDEV running', test: (project) => project.ddev?.status === 'running' },
  notes: { label: 'With a next step', test: (project) => !!project.next_step },
  paused: { label: 'Paused', test: (project) => project.state === 'paused' },
  blocked: { label: 'Blocked', test: (project) => project.state === 'blocked' },
};


const categoryOf = (project) => project.category || t('Other');

/**
 * One predicate serves the table and the counts on every filter.
 * Overrides replace single filters, for example to count a category tab.
 */
function matches(project, overrides = {}) {
  const filters = store.filters;
  const selection = { archive: filters.showArchived ? 'all' : 'current', ...filters, ...overrides };
  if (selection.archive === 'current' && project.state === 'archived') return false;
  if (selection.archive === 'archived' && project.state !== 'archived') return false;
  if (selection.status !== 'all' && !statusFilters[selection.status]?.test(project)) return false;
  if (selection.category !== 'all' && categoryOf(project) !== selection.category) return false;
  if (selection.group !== 'all' && project.group !== selection.group) return false;
  const text = `${project.name} ${project.path} ${project.next_step} ${project.git?.branch || ''}`;
  return text.toLowerCase().includes(selection.query.toLowerCase());
}

const countWhere = (overrides) => store.data.projects.filter((project) => matches(project, overrides)).length;

const isFiltered = () => {
  const { query, status, group, category, showArchived } = store.filters;
  return !!query || status !== 'all' || group !== 'all' || category !== 'all' || showArchived;
};

const sortValues = {
  size: (project) => project.size.bytes,
  activity: (project) => project.last_modified,
  name: (project) => project.name,
  next_step: (project) => project.next_step || null,
  git: (project) => (['none', 'unknown', 'archived'].includes(project.git.status) ? null : (project.git.conflicts || 0) * 10000 + (project.git.changed || 0) + (project.git.ahead || 0) / 1000),
  ddev: (project) => ({ running: 3, stopped: 2, paused: 2, unregistered: 1, none: 0 })[project.ddev.status],
};

export function filteredProjects() {
  const { key, direction } = store.sort;
  const value = sortValues[key] || sortValues.activity;
  return store.data.projects.filter((project) => matches(project)).sort((a, b) => {
    const left = value(a);
    const right = value(b);
    // Missing values stay at the bottom in both directions.
    if (left == null && right != null) return 1;
    if (right == null && left != null) return -1;
    const compared = left == null ? 0 : typeof left === 'string' ? left.localeCompare(right, locale()) : left - right;
    return compared * (direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, locale());
  });
}

/* Table */

function avatar(project) {
  const color = `var(--avatar-${parseInt(project.id.slice(0, 2), 16) % 6 + 1})`;
  const initials = project.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
  return `<span class="project-avatar" style="background:${color}">${escape(initials)}</span>`;
}

function gitPreview(project) {
  if (!project.git.changed || !project.git.files?.length) return gitBadge(project.git);
  const files = project.git.files.slice(0, 3).map((file) => file.path).join('\n');
  const title = `${files}\n${t('Click to preview files')}`;
  return `<button class="git-preview" data-id="${project.id}" title="${escape(title)}">${gitBadge(project.git)}</button>`;
}

function branchLine(git) {
  if (!git.branch) return '';
  const ahead = git.ahead > 0 ? ` · ↑${git.ahead}` : '';
  const behind = git.behind > 0 ? ` · ↓${git.behind}` : '';
  return `<div class="branch">${icon('branch')}${escape(git.branch)}${ahead}${behind}</div>`;
}

function sizeCell(size) {
  const title = systemMessage(size.error) || ago(size.checked_at);
  const value = size.error && size.bytes == null ? t('Not measurable') : bytes(size.bytes);
  const incomplete = size.error && size.bytes != null ? ' *' : '';
  return `<td class="size-cell" title="${escape(title)}">${escape(value)}${incomplete}</td>`;
}

function rowActions(project) {
  const config = store.data.config;
  const name = project.name;
  const button = (action, label, title, iconName) => `<button class="icon-button ${action}" data-id="${project.id}" aria-label="${escape(label)}" title="${escape(title)}">${icon(iconName)}</button>`;
  return markup`
    <div class="row-actions">
      ${config?.editor !== 'none' && button('open-editor', t('{name} open in editor', { name }), t('Open in editor'), 'external')}
      ${config?.terminal !== 'none' && button('open-terminal', t('{name} open in terminal', { name }), t('Open in terminal'), 'terminal')}
      ${button('open-folder', t('{name} open in Finder', { name }), t('Open in Finder'), 'folder')}
      ${project.ddev.url && `<a class="icon-button" href="${escape(project.ddev.url)}" target="_blank" rel="noopener noreferrer" title="${escape(t('Open local website'))}" aria-label="${escape(t('Open local website'))}">${icon('external')}</a>`}
      ${button('edit-project', t('{name} edit', { name }), t('Edit project note'), 'edit')}
    </div>
  `;
}

const showDdev = () => store.data.config?.ddev_enabled === true && store.data.config?.show_ddev !== false;
const showStorage = () => store.data.config?.show_storage !== false;
const showLastChanged = () => store.data.config?.show_last_changed !== false;
const showNextStep = () => store.data.config?.show_next_step !== false;

function projectRow(project) {
  const git = project.git;
  const gitTitle = t('Staged: {staged}, unstaged: {unstaged}, untracked: {untracked}. Last locally known upstream state.', { staged: git.staged || 0, unstaged: git.unstaged || 0, untracked: git.untracked || 0 });
  const priority = project.priority === 'high' ? ` · ${t('High priority')}` : '';
  return markup`
    <tr>
      <td class="project-cell">
        <div class="project-name">
          ${avatar(project)}
          <button class="name-button edit-project" data-id="${project.id}" title="${escape(project.path)}">
            <strong>${escape(project.name)}</strong>
            <small>${escape(project.group)}${escape(priority)}</small>
            <span class="project-path" data-display-path="${escape(project.display_path || project.path)}" data-full-path="${escape(project.path)}" title="${escape(project.path)}">${escape(project.display_path || project.path)}</span>
          </button>
        </div>
      </td>
      ${showStorage() && sizeCell(project.size)}
      <td class="git-cell" title="${escape(gitTitle)}">${gitPreview(project)}${branchLine(git)}</td>
      ${showLastChanged() && markup`<td class="modified-cell" title="${escape(t('File change or commit, excluding dependencies and build folders'))}${project.last_modified ? ' · ' + escape(new Date(project.last_modified * 1000).toLocaleString(locale())) : ''}">${project.last_modified ? escape(relativeTime(project.last_modified)) : '–'}</td>`}
      ${showDdev() && `<td class="ddev-cell">${ddevBadge(project.ddev)}</td>`}
      ${showNextStep() && markup`<td class="next-cell">
        <button class="note-button edit-project ${project.next_step ? '' : 'empty'}" data-id="${project.id}">${escape(project.next_step || t('+ Record next step'))}</button>
        ${project.state !== 'active' && `<div class="project-status">${tHtml(stateNames[project.state])}</div>`}
      </td>`}
      <td class="actions-cell">${rowActions(project)}</td>
    </tr>
  `;
}

function columnHeader(label, key, className = '') {
  const active = store.sort.key === key;
  const ascending = store.sort.direction === 'asc';
  const direction = active ? (ascending ? 'ascending' : 'descending') : 'none';
  const arrow = active ? (ascending ? '↑' : '↓') : '↕';
  return markup`
    <th class="${className}" aria-sort="${direction}">
      <button class="column-sort" data-sort="${key}" title="${escape(t('Sort by {column}', { column: label }))}">${escape(label)}<span aria-hidden="true">${arrow}</span></button>
    </th>
  `;
}

// Distribute spare width across useful columns instead of inflating only the name.
function columnWidths() {
  const columns = [{weight:3.2}, ...(showStorage() ? [{weight:1}] : []), {weight:1.4}, ...(showLastChanged() ? [{weight:1.6}] : []),
    ...(showDdev() ? [{weight:1.1}] : []), ...(showNextStep() ? [{weight:2, className:'next-column'}] : []), {weight:1.4}];
  const total = columns.reduce((sum, column) => sum + column.weight, 0);
  return columns.map(column => `<col class="${column.className || ''}" style="width:${column.weight / total * 100}%">`).join('');
}

export function projectTable() {
  const projects = filteredProjects();
  const visible = store.view === 'overview' ? projects.slice(0, 8) : projects;
  const reading = store.data.checking.includes('projects') && !store.data.projects.length;
  const empty = `<tr><td colspan="${3 + Number(showStorage()) + Number(showLastChanged()) + Number(showDdev()) + Number(showNextStep())}" class="empty">${tHtml(reading ? 'Reading projects …' : 'No projects match this selection.')}</td></tr>`;
  return markup`
    <table class="project-table">
      <colgroup>${columnWidths()}</colgroup>
      <thead>
        <tr>
          ${columnHeader(t('Project'), 'name')}
          ${showStorage() && columnHeader(t('Storage'), 'size')}
          ${columnHeader(t('Git status'), 'git')}
          ${showLastChanged() && columnHeader(t('Last changed'), 'activity')}
          ${showDdev() && columnHeader('DDEV', 'ddev')}
          ${showNextStep() && columnHeader(t('Next step'), 'next_step', 'next-heading')}
          <th>${tHtml('Open')}</th>
        </tr>
      </thead>
      <tbody>${visible.length ? visible.map(projectRow) : empty}</tbody>
    </table>
  `;
}

/* Filters */

// Category tabs follow the archive switch: the archive folder only appears while archived projects are shown.
export function categoryBar() {
  const { category, showArchived } = store.filters;
  const inScope = store.data.projects.filter((project) => matches(project, { category: 'all', status: 'all', group: 'all', query: '' }));
  const order = store.data.config?.category_order?.length ? store.data.config.category_order : (store.data.config?.sources || []).map(source => source.category);
  const rank = name => order.includes(name) ? order.indexOf(name) : order.length;
  const categories = [...new Set([...inScope.map(categoryOf), ...(category === 'all' ? [] : [category])])]
    .sort((a, b) => rank(a) - rank(b));
  const entries = [['all', t('All')], ...categories.map((name) => [name, name])]
    .map(([key, label]) => ({ key, label, count: countWhere({ category: key, group: 'all' }) }));
  const tabs = entries.map(({ key, label, count }) => markup`
    <button type="button" class="category-tab" data-category="${escape(key)}" aria-pressed="${String(category === key)}">
      ${escape(label)}<span class="filter-count">${count}</span>
    </button>
  `);
  const options = entries.map(({ key, label, count }) => markup`
    <option value="${escape(key)}" ${category === key ? 'selected' : ''}>${escape(key === 'all' ? t('All categories') : label)} (${count})</option>
  `);
  return markup`
    <div class="category-tabs" role="group" aria-label="${escape(t('Project category'))}">${tabs}</div>
    <select id="category-select" aria-label="${escape(t('Project category'))}">${options}</select>
    <label class="archive-switch">
      <input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}>${tHtml('Show archived')}<span class="filter-count">${countWhere({ archive: 'archived' })}</span>
    </label>
  `;
}

// A second click on an active state filter removes it again.
export function statusChips() {
  return Object.entries(statusFilters).filter(([key]) => key !== 'running' || store.data.config?.ddev_enabled).map(([key, { label }]) => {
    const active = store.filters.status === key;
    const count = countWhere({ status: key });
    if (key === 'blocked' && !count && !active) return '';
    return markup`
      <button type="button" class="filter" data-filter="${key}" aria-pressed="${String(active)}" ${!count && !active ? 'disabled' : ''}>
        ${tHtml(label)}<span class="filter-count">${count}</span>${active && icon('close')}
      </button>
    `;
  }).join('');
}

export function groupOptions() {
  const { category, group } = store.filters;
  const groups = [...new Set(store.data.projects.filter((project) => category === 'all' || categoryOf(project) === category).map((project) => project.group))].sort();
  const options = groups.map((name) => `<option ${group === name ? 'selected' : ''} value="${escape(name)}">${escape(name)}</option>`);
  return markup`<option value="all">${tHtml('All groups')}</option>${options}`;
}

export function resultBar() {
  if (!isFiltered()) return '';
  const shown = `<b>${filteredProjects().length}</b>`;
  return markup`
    <span>${tHtml('{shown} of {total} projects', { shown, total: store.data.projects.length })}</span>
    <button type="button" class="reset-filters">${tHtml('Reset filters')}</button>
  `;
}

export function projectCount() {
  const count = filteredProjects().length;
  const shown = store.view === 'overview' ? Math.min(8, count) : count;
  return t('{shown} of {total} projects', { shown, total: store.data.projects.length });
}

export function projectSection() {
  const data = store.data;
  const headingAside = store.view === 'overview'
    ? `<a class="button text" href="#projects">${tHtml('All projects')} ${icon('arrow')}</a>`
    : `<span>${escape(ago(data.projects_checked_at))}</span>`;
  const sizesNote = data.checking.includes('sizes') ? 'Measuring folder sizes in the background …' : 'Folder sizes exclude Docker volumes';
  return markup`
    <section class="project-section">
      <div class="section-heading">
        <h2>${tHtml('Your projects')} <span class="count">${data.projects.length}</span></h2>
        ${headingAside}
      </div>
      <div class="project-tools">
        <div class="category-bar" id="category-bar">${categoryBar()}</div>
        <div class="tool-row">
          <label class="search-box" aria-label="${escape(t('Search projects'))}">
            ${icon('search')}<input id="search" placeholder="${escape(t('Search projects or next steps …'))}" value="${escape(store.filters.query)}" autocomplete="off">
          </label>
          <div class="filters" id="status-filters" role="group" aria-label="${escape(t('Project state'))}">${statusChips()}</div>
          <select id="group" aria-label="${escape(t('Project group'))}">${groupOptions()}</select>
        </div>
      </div>
      <div class="result-bar" id="result-bar">${resultBar()}</div>
      <div class="table-wrap" id="project-table">${projectTable()}</div>
      <div class="table-footer">
        <span id="project-count">${escape(projectCount())}</span>
        <span>${tHtml(sizesNote)}</span>
      </div>
    </section>
  `;
}

/** Redraw filters and table without rebuilding the search field, then restore focus. */
export function updateProjects() {
  saveListPreferences();
  const focused = document.activeElement;
  const focusKey = ['category', 'filter', 'sort'].find((key) => focused?.dataset?.[key] !== undefined);
  const focusValue = focusKey && focused.dataset[focusKey];
  document.getElementById('category-bar').innerHTML = categoryBar();
  document.getElementById('status-filters').innerHTML = statusChips();
  document.getElementById('group').innerHTML = groupOptions();
  document.getElementById('result-bar').innerHTML = resultBar();
  document.getElementById('project-table').innerHTML = projectTable();
  document.getElementById('project-count').textContent = projectCount();
  if (!focusKey) return;
  const candidates = [...document.querySelectorAll(`[data-${focusKey}]`)];
  candidates.find((element) => element.dataset[focusKey] === focusValue && !element.classList.contains('metric-filter'))?.focus();
}

/* Interaction */

function selectCategory(value) {
  store.filters.category = value;
  store.filters.group = 'all';
  updateProjects();
}

function resetFilters() {
  Object.assign(store.filters, { status: 'all', query: '', category: 'all', group: 'all', showArchived: false });
  document.getElementById('search').value = '';
  updateProjects();
}

function sortBy(key) {
  const sort = store.sort;
  if (sort.key === key) sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
  else sort.direction = ['name', 'next_step'].includes(key) ? 'asc' : 'desc';
  sort.key = key;
  updateProjects();
}

/** Filter shortcuts from the overview open the project list with that filter. */
function showFilteredProjects(status) {
  store.projectLists.projects.filters.status = status;
  store.projectLists.projects.filters.showArchived = false;
  saveListPreferences();
  location.hash = 'projects';
}

export function bindProjectEvents() {
  document.addEventListener('click', (event) => {
    const category = event.target.closest('[data-category]');
    if (category) selectCategory(category.dataset.category);
    if (event.target.closest('.reset-filters:not([data-list-reset])')) resetFilters();
    const column = event.target.closest('[data-sort]');
    if (column) sortBy(column.dataset.sort);
    const filter = event.target.closest('[data-filter]');
    if (filter?.classList.contains('metric-filter')) showFilteredProjects(filter.dataset.filter);
    else if (filter) {
      store.filters.status = store.filters.status === filter.dataset.filter ? 'all' : filter.dataset.filter;
      updateProjects();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id !== 'search') return;
    store.filters.query = event.target.value;
    updateProjects();
  });

  document.addEventListener('change', (event) => {
    const { id, value, checked } = event.target;
    if (id === 'group') {
      store.filters.group = value;
      updateProjects();
    }
    if (id === 'category-select') selectCategory(value);
    if (id === 'show-archived') {
      store.filters.showArchived = checked;
      // Leave a category that no longer has projects once the archive is hidden again.
      const { category } = store.filters;
      if (category !== 'all' && !countWhere({ category, status: 'all', group: 'all', query: '' })) {
        store.filters.category = 'all';
        store.filters.group = 'all';
      }
      updateProjects();
      document.getElementById('show-archived').focus();
    }
  });
}
