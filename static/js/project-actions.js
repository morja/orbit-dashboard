/* Actions on a single project: note dialog, Git file preview, terminal, editor and Finder. */
import { api } from './api.js';
import { t } from './i18n.js';
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
