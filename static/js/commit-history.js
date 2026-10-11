import { api } from './api.js';
import { escape, markup } from './html.js';
import { relativeTime, formatDateTime } from './format.js';
import { t, tHtml } from './i18n.js';
import { store } from './store.js';
import { icon } from './icons.js';

// Share one short-lived history cache between mini previews and the status dialog.
const cache = new Map();
let dialog;
let openedId;
let selectedTab;
let revision = 0;

export function loadCommits(id) {
  let entry = cache.get(id);
  if (!entry || entry.expires < Date.now()) {
    const promise = api(`/api/projects/${id}/commits`);
    entry = { expires: Date.now() + 30000, promise };
    cache.set(id, entry);
    promise.catch(() => { if (cache.get(id) === entry) cache.delete(id); });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return entry.promise;
}

const fileStates = { '?': 'New', M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict', T: 'Type changed' };
function fileRow(file) {
  const state = fileStates[file.status.trim()[0]];
  const staged = file.status[0] !== ' ' && file.status !== '??' ? ' · staged' : '';
  return `<div><code>${escape(file.path)}</code><span>${escape(state ? t(state) : file.status)}${staged}</span></div>`;
}

async function selectTab(tab) {
  selectedTab = tab;
  const current = ++revision;
  const project = store.data.projects.find(project => project.id === openedId);
  if (!project) return;
  for (const button of dialog.querySelectorAll('[data-git-tab]')) {
    const selected = button.dataset.gitTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  const panel = dialog.querySelector('.git-status-content');
  panel.setAttribute('aria-labelledby', `git-tab-${tab}`);
  if (tab === 'files') {
    const remaining = project.git.files_remaining;
    panel.innerHTML = markup`
      <div class="git-files">${(project.git.files || []).map(fileRow)}</div>
      ${!project.git.files?.length && `<p class="muted">${escape(t('Clean'))}</p>`}
      ${remaining > 0 && `<p class="muted">${tHtml('Another {count} more entries. Run git status in your terminal for the full list.', { count: remaining })}</p>`}
      <p class="muted">${tHtml('Preview from the last project check · up to twelve entries. New folders may appear as a single entry.')}</p>
    `;
    return;
  }
  panel.innerHTML = `<p class="muted">${escape(t('Loading commits…'))}</p>`;
  try {
    const { commits } = await loadCommits(openedId);
    if (!dialog.open || current !== revision) return;
    const rows = commits.map(commit => `<div><code>${escape(commit.id)}</code><div class="git-history-message">${escape(commit.subject)}<time title="${escape(formatDateTime(commit.timestamp))}" datetime="${new Date(commit.timestamp * 1000).toISOString()}">${escape(relativeTime(commit.timestamp))}</time></div></div>`).join('');
    panel.innerHTML = rows ? `<div class="git-files git-history">${rows}</div>` : `<p class="muted">${escape(t('No commits yet'))}</p>`;
  } catch {
    if (dialog.open && current === revision) panel.textContent = t('Commit history unavailable');
  }
}

export function openGitStatus(id, tab = 'files') {
  const project = store.data.projects.find(project => project.id === id);
  if (!project) return;
  openedId = id;
  const git = project.git;
  const tracking = git.has_remote === false ? t('No remote') : git.upstream || t('No tracking branch');
  const difference = Number.isInteger(git.ahead) && Number.isInteger(git.behind)
    ? `↑ ${git.ahead} · ↓ ${git.behind}` : t('Comparison unavailable');
  dialog.innerHTML = markup`
    <div class="dialog-heading"><div><div class="eyebrow">${escape(t('Git status'))}</div><h2>${escape(project.name)}</h2></div>
      <button class="icon-button close-git" aria-label="${escape(t('Close'))}">${icon('close')}</button></div>
    <p class="path">${escape(project.display_path || project.path)}</p>
    <div class="git-status-summary"><span>${icon('branch')}<b>${escape(git.branch || '—')}</b></span><span>${escape(tracking)}</span><span title="${escape(t('Compared with the last locally known upstream state.'))}">${escape(difference)}</span></div>
    <div class="git-status-tabs" role="tablist" aria-label="${escape(t('Git status'))}">
      <button id="git-tab-files" role="tab" data-git-tab="files" aria-controls="git-status-panel">${escape(t('Changed files'))} · ${git.changed ?? '—'}</button>
      <button id="git-tab-history" role="tab" data-git-tab="history" aria-controls="git-status-panel">${escape(t('History'))}</button>
    </div>
    <div class="git-status-content" id="git-status-panel" role="tabpanel" tabindex="0"></div>
    <div class="dialog-actions"><button class="button primary open-terminal" data-id="${id}">${icon('terminal')}${escape(t('Open in terminal'))}</button></div>
  `;
  dialog.setAttribute('aria-label', t('Git status'));
  if (!dialog.open) dialog.showModal();
  selectTab(tab);
}

export function bindCommitHistory() {
  dialog = document.createElement('dialog');
  dialog.id = 'git-dialog';
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    // A queued close event may arrive after the dialog has already reopened.
    if (!dialog.open) { openedId = null; revision++; }
  });
  document.addEventListener('click', event => {
    const branch = event.target.closest('.branch-history');
    const files = event.target.closest('.git-preview');
    if (branch) openGitStatus(branch.dataset.commits, 'history');
    if (files) openGitStatus(files.dataset.id, 'files');
    if (event.target.closest('.close-git')) dialog.close();
    const tab = event.target.closest('[data-git-tab]');
    if (tab) selectTab(tab.dataset.gitTab);
  });
  dialog.addEventListener('keydown', event => {
    if (!event.target.matches('[data-git-tab]')) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tab = event.key === 'Home' ? 'files' : event.key === 'End' ? 'history' : selectedTab === 'files' ? 'history' : 'files';
    selectTab(tab);
    dialog.querySelector(`[data-git-tab="${tab}"]`).focus();
  });
}
