/* Current dashboard notices live outside the page flow, so updates never move content. */
import { projectFreshness } from './freshness.js';
import { escape, markup } from './html.js';
import { icon } from './icons.js';
import { onLanguageChange, systemMessage, t, tHtml } from './i18n.js';
import { store } from './store.js';

let connectionLost = false;
let lastCount = -1;
let lastMarkup = null;
let lastConnectionLost = false;

const destinations = {
  projects: ['Projects', '#projects'], sizes: ['Folder sizes', '#storage'],
  mac: ['Mac storage', '#storage'], moon: ['Servers', '#servers'],
  ddev: ['DDEV', '#docker'], docker: ['Docker / Colima', '#docker'],
  services: ['Local services', '#services'],
};

function currentNotices() {
  const data = store.data;
  const items = [];
  const add = (title, message, href = null, error = false) => {
    items.push({ id: `${title}:${message}`, title: t(title), message: systemMessage(message), href, error });
  };
  if (connectionLost) add('Connection', 'The dashboard connection was lost. The last values remain visible.', null, true);
  if (data) {
    for (const message of data.project_errors || []) add('Project folders', message, '#projects');
    for (const [name, message] of Object.entries(data.errors || {})) {
      if (name === 'ddev' && data.config?.ddev_enabled && data.ddev?.error) continue;
      const [title, href] = destinations[name] || ['Notices', null];
      add(title, message, href);
    }
    if (data.config?.ddev_enabled && data.ddev?.error) add('DDEV', data.ddev.error, '#docker');
    if (projectFreshness(data).stale && data.projects.length && !data.checking.includes('projects')) {
      add('Projects', 'Git and project values are out of date.', '#projects');
    }
  }
  return [...new Map(items.map(item => [item.id, item])).values()];
}

function positionPanel() {
  const panel = document.getElementById('notices-panel');
  if (!panel.matches(':popover-open')) return;
  const anchor = document.getElementById('notices-toggle').getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const left = innerWidth <= 650 ? 16 : Math.min(anchor.right + 12, innerWidth - box.width - 16);
  const top = innerWidth <= 650 ? anchor.bottom + 8 : anchor.bottom - box.height;
  panel.style.left = `${Math.max(16, left)}px`;
  panel.style.top = `${Math.max(16, Math.min(top, innerHeight - box.height - 16))}px`;
  panel.style.bottom = 'auto';
}

export function renderNotices() {
  const items = currentNotices();
  const button = document.getElementById('notices-toggle');
  const count = document.getElementById('notices-count');
  button.dataset.level = connectionLost ? 'error' : items.length ? 'warning' : 'clear';
  button.setAttribute('aria-label', items.length ? `${t('Notices')}, ${items.length}` : t('Notices'));
  button.title = items.length ? t('{count} notices', { count: items.length }) : t('No current notices');
  count.textContent = items.length;
  count.hidden = !items.length;

  const list = document.getElementById('notices-list');
  const html = items.length ? items.map(item => markup`
    <div class="attention-row ${item.error ? 'notice-error' : ''}">
      <span class="attention-icon">${icon(item.error ? 'cloud-off' : 'alert')}</span>
      <div class="notice-copy"><strong>${escape(item.title)}</strong><p>${escape(item.message)}</p></div>
      ${item.href && markup`<a class="icon-button" href="${item.href}" data-notice-id="${escape(item.id)}" aria-label="${escape(t('Open details'))}: ${escape(item.title)}">${icon('arrow')}</a>`}
    </div>
  `).join('') : markup`<div class="quiet">${icon('check')}<span>${tHtml('No current notices')}</span></div>`;

  if (lastMarkup !== html) {
    // Polling should preserve the open panel, its scroll position and link focus.
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.noticeId : null;
    const scrollTop = list.scrollTop;
    list.innerHTML = html;
    lastMarkup = html;
    if (focused) {
      const target = [...list.querySelectorAll('[data-notice-id]')].find(link => link.dataset.noticeId === focused);
      (target || document.querySelector('#notices-panel button')).focus({ preventScroll: true });
    }
    list.scrollTop = scrollTop;
  }
  if (lastCount !== items.length || lastConnectionLost !== connectionLost) {
    document.getElementById('notices-announcement').textContent = connectionLost
      ? t('The dashboard connection was lost. The last values remain visible.')
      : items.length ? t('{count} notices', { count: items.length }) : t('No current notices');
    lastCount = items.length;
    lastConnectionLost = connectionLost;
  }
  positionPanel();
}

export function setConnectionLost(value) {
  connectionLost = value;
  renderNotices();
}

export function bindNotices() {
  const panel = document.getElementById('notices-panel');
  panel.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    // Keep the first frame on screen while the opened panel's height is measured.
    panel.style.left = '16px';
    panel.style.top = 'auto';
    panel.style.bottom = '16px';
  });
  panel.addEventListener('toggle', () => {
    document.getElementById('notices-toggle').setAttribute('aria-expanded', String(panel.matches(':popover-open')));
    positionPanel();
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('a')) panel.hidePopover();
  });
  window.addEventListener('resize', positionPanel);
  new ResizeObserver(positionPanel).observe(panel);
  onLanguageChange(renderNotices);
  renderNotices();
}
