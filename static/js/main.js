/*
 * Orbit dashboard entry point. All values come from the local backend
 * (server.py); workspace text is always escaped before it reaches the page.
 */
import { captureStaticText, locale, onLanguageChange, t } from './i18n.js';
import { hydrateIcons } from './icons.js';
import { bindPathLayout } from './paths.js';
import { bindProjectActions } from './project-actions.js';
import { startRefreshing } from './refresh.js';
import { navigate, render } from './render.js';
import { bindSettings } from './settings.js';
import { bindServerSummaries } from './views/server.js';
import { bindServicesEvents } from './views/services.js';
import { bindDockerEvents } from './views/docker.js';
import { bindProjectEvents } from './views/projects.js';

function updateClock() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('clock').textContent = new Date().toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long', timeZone });
}

// Static text is captured in English before any workspace content is inserted.
captureStaticText();
hydrateIcons();
onLanguageChange(updateClock);
updateClock();
setInterval(updateClock, 60000);

bindPathLayout();
bindProjectEvents();
bindDockerEvents(render);
bindServicesEvents(render);
bindProjectActions();
bindSettings();
bindServerSummaries();

navigate();
window.addEventListener('hashchange', navigate);
startRefreshing();

// Collapse is local window navigation state, independent of the saved appearance.
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem('orbit-sidebar-collapsed') === 'true'; } catch {}
function updateSidebar() {
  document.body.dataset.sidebar = sidebarCollapsed ? 'collapsed' : 'expanded';
  const toggle = document.getElementById('sidebar-toggle');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5L8 12l7 7"/></svg>';
  toggle.setAttribute('aria-expanded', String(!sidebarCollapsed));
  toggle.setAttribute('aria-label', sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar'));
  toggle.title = toggle.getAttribute('aria-label');
}
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  try { localStorage.setItem('orbit-sidebar-collapsed', String(sidebarCollapsed)); } catch {}
  updateSidebar();
});
onLanguageChange(updateSidebar);
updateSidebar();
