/* Drawing the current view from the last state, and switching views by address. */
import { goaccessView, loadGoAccess } from './views/goaccess.js';
import { t } from './i18n.js';
import { renderNotices } from './notices.js';
import { noteRender, updateActivity } from './refresh.js';
import { applyAppearance } from './settings.js';
import { fitProjectPaths } from './paths.js';
import { store } from './store.js';
import { syncListPreferences } from './list-preferences.js';
import { servicesView } from './views/services.js';
import { dockerView } from './views/docker.js';
import { overviewView } from './views/overview.js';
import { projectSection } from './views/projects.js';
import { serverView } from './views/server.js';
import { storageView } from './views/storage.js';

const views = {
  goaccess: goaccessView,
  services: servicesView,
  overview: overviewView,
  projects: projectSection,
  moon: serverView,
  docker: dockerView,
  storage: storageView,
};

function viewName(view) {
  return { goaccess: t('Web traffic'), services: t('Local services'), overview: t('Overview'), projects: t('Projects'), moon: t('Servers'), docker: 'Docker & DDEV', storage: t('Storage') }[view];
}

// Every view uses the same compact header and keeps the live status beside Refresh.
function renderHeading(view) {
  document.body.dataset.view = view;
  document.getElementById('overview-heading').hidden = false;
  document.querySelector('.breadcrumb').hidden = true;
  document.querySelector('.page-heading').hidden = true;
  const title = document.getElementById('title');
  document.getElementById('overview-heading').append(title);
  document.querySelector('.topbar-right').prepend(document.getElementById('live-label'));
  title.textContent = viewName(view);
  document.getElementById('breadcrumb').textContent = viewName(view);
}

let renderedRoute;
let renderedLanguage;

export function render({ force = false } = {}) {
  const data = store.data;
  if (!data) return;
  syncListPreferences(data.config || {});
  const route = store.view + ':' + (store.selectedServer || '');
  const sameView = route === renderedRoute;
  const position = {top: window.scrollY, left: window.scrollX};
  const tablePositions = [...document.querySelectorAll('#content .table-wrap')].map(node => ({left: node.scrollLeft, top: node.scrollTop}));
  if (data.config) applyAppearance(data.config);
  renderNotices();
  // Preserve the interactive report and its scroll position during polling.
  if (sameView && store.view === 'goaccess' && !force && renderedLanguage === data.config?.language) return;
  const content = document.getElementById('content');
  const focus = document.activeElement;
  // Redrawing would close an open select in the content.
  if (focus?.tagName === 'SELECT' && content.contains(focus)) return;
  const searchId = focus?.id === 'search' || focus?.dataset?.listQuery || focus?.id === 'services-search' ? focus.id : null;
  const searchSelection = searchId ? [focus.selectionStart, focus.selectionEnd] : null;

  renderHeading(store.view);
  document.getElementById('nav-count').textContent = data.projects.length;
  for (const link of document.querySelectorAll('[data-view]')) link.classList.toggle('active', link.dataset.view === store.view);
  updateActivity();
  document.getElementById('footer-status').textContent = data.mac?.hostname || '';

  noteRender();
  content.innerHTML = views[store.view]();
  fitProjectPaths();
  content.setAttribute('aria-busy', 'false');
  if (searchSelection) {
    const search = document.getElementById(searchId);
    search?.focus({preventScroll: true});
    search?.setSelectionRange(...searchSelection);
  }
  // Replacing content can discard browser scroll anchors. Same-view polling must
  // keep the reader's position; navigating to another view starts at the top.
  if (sameView) {
    document.querySelectorAll('#content .table-wrap').forEach((node, index) => {
      const saved = tablePositions[index];
      if (saved) node.scrollTo(saved.left, saved.top);
    });
  }
  const target = sameView ? position : {top: 0, left: 0};
  window.scrollTo({...target, behavior: 'instant'});
  renderedRoute = route;
  renderedLanguage = data.config?.language;
}

export function navigate() {
  const [route, query = ''] = location.hash.slice(1).split('?');
  const requested = route === 'servers' ? 'moon' : route;
  store.selectedServer = new URLSearchParams(query).get('server');
  store.view = Object.hasOwn(views, requested) ? requested : 'overview';
  render();
  if (store.view === 'goaccess') loadGoAccess();
}
