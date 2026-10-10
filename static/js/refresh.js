/*
 * Keeping the dashboard current. The window asks for new values only while it is
 * active: every ui_refresh seconds, and every second while the progress bar shows.
 * Unchanged state is answered with 304 and not redrawn.
 */
import { api, fetchState } from './api.js';
import { formatTime } from './format.js';
import { escape } from './html.js';
import { t } from './i18n.js';
import { render } from './render.js';
import { store } from './store.js';
import { notify } from './toast.js';

// Checks shown in the top bar. Folder sizes run long and have their own note below the table.
const visibleChecks = ['projects', 'moon', 'ddev', 'docker'];

let stateTag = null;
let lastRender = 0;
let fetching = false;
let timer;
let manualRefreshSince = 0;
// Starts active: an embedded WebKit view may report no focus until its first focus event.
let windowActive = true;

export const noteRender = () => { lastRender = Date.now(); };

/**
 * The bar appears for the first check after a start, while older saved values are
 * shown, and after Refresh. Routine background checks only change the label.
 */
function activity() {
  const data = store.data;
  const running = data.checking.filter((name) => visibleChecks.includes(name));
  const restoring = running.some((name) => {
    const checked = name === 'projects' ? data.projects_checked_at : data[name]?.checked_at;
    return !checked || new Date(checked) < new Date(data.started_at);
  });
  if (manualRefreshSince && !running.length && Date.now() - manualRefreshSince > 1500) manualRefreshSince = 0;
  return { running, prominent: restoring || !!manualRefreshSince };
}

function activityText(running) {
  const progress = store.data.progress?.projects;
  if (running.includes('projects')) {
    return progress?.total ? t('Checking projects · {done} of {total}', progress) : t('Finding projects');
  }
  if (running[0] === 'moon') return t('Checking servers');
  const names = { ddev: 'DDEV', docker: 'Docker' };
  if (running.length) return t('{name} is being checked', { name: names[running[0]] });
  return t('Up to date · {time}', { time: formatTime() });
}

export function updateActivity() {
  const { running, prominent } = activity();
  document.getElementById('live-label').innerHTML = `<span class="local-dot"></span><span>${escape(activityText(running))}</span>`;
  const bar = document.getElementById('refresh-progress');
  const progress = store.data.progress?.projects;
  const determinate = running.includes('projects') && progress?.total > 0;
  bar.hidden = !prominent || !running.length;
  bar.classList.toggle('indeterminate', !determinate);
  bar.firstElementChild.style.width = determinate ? `${Math.max(3, progress.done / progress.total * 100)}%` : '';
  document.getElementById('refresh').classList.toggle('busy', prominent && running.length > 0);
}

export async function poll() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetchState(stateTag);
    if (response.status !== 304 && !response.ok) throw new Error(t('Request failed'));
    document.getElementById('connection-error').hidden = true;
    if (response.status === 304) {
      // Relative times such as "3 min ago" still need an occasional redraw.
      if (Date.now() - lastRender > 60000) render();
      return;
    }
    stateTag = response.headers.get('ETag');
    store.data = await response.json();
    render();
  } catch {
    document.getElementById('connection-error').hidden = false;
    document.getElementById('live-label').textContent = t('Connection lost');
  } finally {
    fetching = false;
  }
}

export function schedulePoll() {
  clearTimeout(timer);
  const seconds = store.data && activity().prominent ? 1 : store.data?.config?.ui_refresh || 10;
  timer = setTimeout(async () => {
    if (windowActive && !document.hidden) await poll();
    schedulePoll();
  }, seconds * 1000);
}

async function refreshNow(event) {
  const button = event.currentTarget;
  button.disabled = true;
  manualRefreshSince = Date.now();
  try {
    await api('/api/refresh', {});
    await poll();
    schedulePoll();
  } catch (error) {
    notify(error.message);
  } finally {
    setTimeout(() => { button.disabled = false; }, 1500);
  }
}

export function startRefreshing() {
  document.getElementById('refresh').addEventListener('click', refreshNow);
  window.addEventListener('focus', () => {
    windowActive = true;
    poll();
  });
  window.addEventListener('blur', () => { windowActive = false; });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
  poll().finally(schedulePoll);
}
