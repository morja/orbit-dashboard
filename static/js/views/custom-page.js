/*
 * Custom pages: locally generated HTML files from other tools, one sidebar entry each.
 * Orbit never reads their content. The file is shown in a sandboxed frame without
 * same-origin access, so the page cannot reach the action key or the API.
 */
import { api } from '../api.js';
import { relativeTime } from '../format.js';
import { escape, markup } from '../html.js';
import { locale, t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { notify } from '../toast.js';

// Pages whose refresh request is running in this window, and the last error per page.
const refreshing = new Set();
const errors = new Map();
let redraw = () => {};
let renderedSignature = '';
let navSignature = '';

export const customPages = () => store.data?.custom_pages || [];
export const currentPage = () => customPages().find(page => page.id === store.selectedPage);
export const pageHref = page => '#page?id=' + encodeURIComponent(page.id);

/* Appearance handed to the page as query parameters */

function appearance() {
  const root = document.documentElement;
  const mode = root.dataset.theme;
  const dark = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const scale = Number(getComputedStyle(root).getPropertyValue('--font-scale')) || 1;
  return { theme: dark ? 'dark' : 'light', palette: root.dataset.palette || 'orbit', scale: String(Math.round(scale * 100) / 100) };
}

const frameSource = page => `/api/custom-pages/${encodeURIComponent(page.id)}?${new URLSearchParams(appearance())}`;

/* Sidebar entries below the built-in destinations */

export function syncPageNav() {
  const pages = customPages();
  const signature = JSON.stringify(pages.map(page => [page.id, page.name]));
  const container = document.getElementById('custom-pages-nav');
  if (signature !== navSignature) {
    navSignature = signature;
    container.innerHTML = pages.map(page => markup`
      <a href="${escape(pageHref(page))}" data-view="page" data-page-id="${escape(page.id)}" aria-label="${escape(page.name)}">
        ${icon('page')}<span class="nav-page-name">${escape(page.name)}</span>
      </a>`).join('');
  }
  for (const link of container.querySelectorAll('a')) {
    link.classList.toggle('active', store.view === 'page' && link.dataset.pageId === store.selectedPage);
  }
}

/* Top bar: generated time and the page's own Refresh button */

export function syncPageTopbar() {
  const page = store.view === 'page' ? currentPage() : null;
  const label = document.getElementById('page-generated');
  const button = document.getElementById('page-refresh');
  label.hidden = !page;
  button.hidden = !page?.refreshable;
  if (!page) return;
  const generated = page.generated_at ? new Date(page.generated_at) : null;
  label.textContent = generated ? t('Generated {time}', { time: relativeTime(generated.getTime() / 1000) }) : t('Not generated yet');
  label.title = generated ? generated.toLocaleString(locale()) : '';
  const busy = refreshing.has(page.id) || page.refreshing;
  button.classList.toggle('busy', busy);
  button.disabled = busy;
  button.querySelector('span:last-child').textContent = busy ? t('Refreshing…') : t('Refresh');
}

/*
 * Polling keeps the frame and its scroll position. Only a different page, a new
 * file version or a change between page and empty state replaces the content.
 */
function signature() {
  const page = currentPage();
  return JSON.stringify([store.selectedPage, page?.generated_at || null, page?.refreshable, errors.get(store.selectedPage) || '']);
}

export const pageChanged = () => signature() !== renderedSignature;

export function customPageView() {
  renderedSignature = signature();
  const page = currentPage();
  if (!page) {
    return markup`
      <section class="panel custom-page-empty">
        <h2>${tHtml('This page is not available')}</h2>
        <p class="muted">${tHtml('It may have been disabled or removed in Settings.')}</p>
        <button type="button" class="button secondary setup-settings" data-settings-section="tools">${icon('settings')}${tHtml('Settings')}</button>
      </section>`;
  }
  const error = errors.get(page.id);
  const notice = error ? markup`<p class="notice custom-page-error" role="alert">${escape(error)}</p>` : '';
  if (!page.generated_at) {
    return markup`${notice}
      <section class="panel custom-page-empty">
        <h2>${tHtml('No page generated yet')}</h2>
        <p class="muted">${page.refreshable ? tHtml('Use Refresh to generate it now.') : tHtml('The page appears here once its tool has written the file.')}</p>
        ${page.refreshable ? markup`<button type="button" class="button secondary custom-page-generate" ${refreshing.has(page.id) ? 'disabled' : ''}>${icon('refresh')}${tHtml('Refresh')}</button>` : ''}
      </section>`;
  }
  return markup`${notice}
    <iframe class="custom-page-frame" title="${escape(page.name)}" src="${escape(frameSource(page))}"
      sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>`;
}

// Reload the frame with the current appearance; the address changes only when needed.
function updateFrame(force = false) {
  const frame = document.querySelector('#content .custom-page-frame');
  const page = currentPage();
  if (!frame || !page || store.view !== 'page') return;
  const source = frameSource(page);
  if (force || frame.getAttribute('src') !== source) frame.src = source;
}

async function refreshPage() {
  const page = currentPage();
  if (!page?.refreshable || refreshing.has(page.id)) return;
  const id = page.id;
  refreshing.add(id);
  // Keep a shown frame while the command runs; only an error or the empty state changes.
  const hadError = errors.delete(id);
  syncPageTopbar();
  if (hadError || !page.generated_at) redraw();
  try {
    const result = await api(`/api/custom-pages/${encodeURIComponent(id)}/refresh`, {});
    const current = customPages().find(item => item.id === id);
    if (current) current.generated_at = result.generated_at;
    notify(t('Page refreshed.'));
  } catch (error) {
    errors.set(id, error.message);
  } finally {
    refreshing.delete(id);
    // The last poll may still report the run; the next poll confirms the backend state.
    const current = customPages().find(item => item.id === id);
    if (current) current.refreshing = false;
  }
  // A new file version replaces the frame; an unchanged one is reloaded explicitly.
  syncPageTopbar();
  if (pageChanged()) redraw();
  else updateFrame(true);
}

export function bindCustomPages(render) {
  redraw = () => { if (store.view === 'page') render({ force: true }); };
  document.getElementById('page-refresh').addEventListener('click', refreshPage);
  document.addEventListener('click', event => {
    if (event.target.closest('.custom-page-generate')) refreshPage();
  });
  // Appearance lives on <html>: theme and palette attributes, font scale in its style.
  new MutationObserver(() => updateFrame()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateFrame());
}
