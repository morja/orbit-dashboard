import { loadCommits } from './commit-history.js';
import { store } from './store.js';
import { escape } from './html.js';
import { t } from './i18n.js';
import { formatDateTime, relativeTime } from './format.js';

const selector = '.git-preview, .branch-history';
const key = button => button ? `${button.className}:${button.dataset.id || button.dataset.commits}` : '';
let anchor;
let preview;
let timer;

function hide() {
  clearTimeout(timer);
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
  preview.hidden = true;
}

function position() {
  if (!anchor?.isConnected) return hide();
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  preview.style.maxWidth = `${Math.min(anchor.matches('.git-preview') ? 560 : 360, (innerWidth - 16) / zoom)}px`;
  const box = anchor.getBoundingClientRect();
  const column = anchor.closest('.git-cell')?.getBoundingClientRect() || box;
  const size = preview.getBoundingClientRect();
  preview.style.left = `${Math.max(8, Math.min(column.left, innerWidth - size.width - 8)) / zoom}px`;
  preview.style.top = `${(box.top - size.height - 6 >= 8 ? box.top - size.height - 6 : Math.min(box.bottom + 6, innerHeight - size.height - 8)) / zoom}px`;
}

async function show(button) {
  if (!button.isConnected || document.querySelector('dialog[open]')) return;
  if (key(anchor) === key(button) && !preview.hidden) return position();
  hide();
  anchor = button;
  anchor.setAttribute('aria-describedby', preview.id);
  const project = store.data.projects.find(project => project.id === (button.dataset.id || button.dataset.commits));
  if (!project) return hide();
  const current = key(button);
  if (button.matches('.git-preview')) {
    preview.innerHTML = `<strong>${escape(t('Changed files'))}</strong><ul>${project.git.files.slice(0, 3).map(file => `<li><code>${escape(file.path)}</code></li>`).join('')}</ul>`;
  } else {
    // Reuse the dialog's request/cache so the subsequent click is instant.
    try {
      const { commits } = await loadCommits(project.id);
      if (key(anchor) !== current) return;
      const last = commits[0];
      preview.innerHTML = `<strong>${escape(t('Recent commits'))}</strong>${last ? `<p>${escape(last.subject)}</p><small>${escape(formatDateTime(last.timestamp))} · ${escape(relativeTime(last.timestamp))}</small>` : `<p>${escape(t('No commits yet'))}</p>`}`;
    } catch { if (key(anchor) === current) hide(); return; }
  }
  preview.hidden = false;
  position();
}

export function bindGitMiniPreviews() {
  preview = document.createElement('div');
  preview.id = 'git-mini-preview';
  preview.className = 'git-mini-preview';
  preview.setAttribute('role', 'tooltip');
  preview.hidden = true;
  document.body.append(preview);
  document.addEventListener('pointerover', event => {
    const button = event.target.closest(selector);
    if (button && !button.contains(event.relatedTarget)) {
      clearTimeout(timer);
      timer = setTimeout(() => show(button), 250);
    }
  });
  document.addEventListener('pointerout', event => {
    const button = event.target.closest(selector);
    if (button && !button.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest(selector);
    if (button) { clearTimeout(timer); timer = setTimeout(() => show(button), 250); }
  });
  document.addEventListener('focusout', event => { if (event.target === anchor) hide(); });
  document.addEventListener('click', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('resize', hide);
  window.addEventListener('hashchange', hide);
  document.addEventListener('scroll', () => { if (anchor) position(); }, true);
  new MutationObserver(() => {
    if (!anchor || anchor.isConnected) return;
    const replacement = [...document.querySelectorAll(selector)].find(button => key(button) === key(anchor));
    if (!replacement) return hide();
    clearTimeout(timer);
    anchor = replacement;
    anchor.setAttribute('aria-describedby', preview.id);
    if (!preview.hidden) position();
  }).observe(document.getElementById('content'), {childList: true, subtree: true});
}
