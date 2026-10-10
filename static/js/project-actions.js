/* Actions on a single project: note dialog, Git file preview, terminal, editor and Finder. */
import { api } from './api.js';
import { escape, markup } from './html.js';
import { t, tHtml } from './i18n.js';
import { icon } from './icons.js';
import { poll } from './refresh.js';
import { store } from './store.js';
import { notify } from './toast.js';

let editingId = null;

const findProject = (id) => store.data.projects.find((project) => project.id === id);

function openNote(id) {
  const project = findProject(id);
  if (!project) return;
  editingId = id;
  document.getElementById('dialog-title').textContent = project.name;
  document.getElementById('dialog-path').textContent = project.path;
  document.getElementById('next-step').value = project.next_step;
  document.getElementById('project-state').value = project.state;
  document.getElementById('project-priority').value = project.priority;
  document.getElementById('project-dialog').showModal();
}

async function saveNote(event) {
  event.preventDefault();
  const button = document.getElementById('save-note');
  button.disabled = true;
  try {
    await api(`/api/projects/${editingId}`, {
      next_step: document.getElementById('next-step').value,
      state: document.getElementById('project-state').value,
      priority: document.getElementById('project-priority').value,
    });
    document.getElementById('project-dialog').close();
    notify(t('Project note saved'));
    await poll();
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

const fileStates = { '?': 'New', M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict', T: 'Type changed' };

// Git porcelain status: the first column is the index, so anything but a space or ?? is staged.
function fileRow(file) {
  const state = fileStates[file.status.trim()[0]];
  const staged = file.status[0] !== ' ' && file.status !== '??' ? ' · staged' : '';
  return `<div><code>${escape(file.path)}</code><span>${escape(state ? t(state) : file.status)}${staged}</span></div>`;
}

function showGitFiles(id) {
  const project = findProject(id);
  if (!project) return;
  let dialog = document.getElementById('git-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'git-dialog';
    document.body.append(dialog);
  }
  const remaining = project.git.files_remaining;
  dialog.innerHTML = markup`
    <div class="dialog-heading">
      <div><div class="eyebrow">${tHtml('CHANGED GIT FILES')}</div><h2>${escape(project.name)}</h2></div>
      <button class="icon-button close-git" aria-label="${escape(t('Close'))}">${icon('close')}</button>
    </div>
    <p class="path">${escape(project.display_path || project.path)}</p>
    <div class="git-files">${(project.git.files || []).map(fileRow)}</div>
    ${remaining > 0 && `<p class="muted">${tHtml('Another {count} more entries. Run git status in your terminal for the full list.', { count: remaining })}</p>`}
    <p class="muted">${tHtml('Preview from the last project check · up to twelve entries. New folders may appear as a single entry.')}</p>
    <div class="dialog-actions">
      <button class="button primary open-terminal" data-id="${project.id}">${icon('terminal')}${tHtml('Open in terminal')}</button>
    </div>
  `;
  dialog.showModal();
}

async function runAction(button, action, message) {
  button.disabled = true;
  try {
    await api(`/api/projects/${button.dataset.id}/${action}`, {});
    if (message) notify(message);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

export function bindProjectActions() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    const edit = target.closest('.edit-project');
    if (edit) openNote(edit.dataset.id);
    const preview = target.closest('.git-preview');
    if (preview) showGitFiles(preview.dataset.id);
    if (target.closest('.close-git')) document.getElementById('git-dialog').close();
    if (target.closest('.close-dialog')) document.getElementById('project-dialog').close();
    const terminal = target.closest('.open-terminal');
    if (terminal) runAction(terminal, 'terminal', t('Opening the project in your terminal'));
    const editor = target.closest('.open-editor');
    if (editor) runAction(editor, 'editor');
    const folder = target.closest('.open-folder');
    if (folder) runAction(folder, 'open');
  });
  document.getElementById('project-form').addEventListener('submit', saveNote);
}
