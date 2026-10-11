/* Browser-local list choices. Search text is deliberately never persisted. */
import { store } from './store.js';

const storageKey = 'orbit-list-preferences-v1';
let enabled;

function restore(target, source, choices) {
  if (!source || typeof source !== 'object') return;
  for (const [key, allowed] of Object.entries(choices)) {
    const value = source[key];
    if (allowed ? allowed.includes(value) : typeof value === 'string' && value.length <= 200) target[key] = value;
  }
}

export function syncListPreferences(config) {
  const next = config.remember_list_preferences !== false;
  if (enabled === undefined && next) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) {
        // Seed both views from legacy shared preferences without sharing objects.
        for (const view of ['overview', 'projects']) {
          const selection = saved.projectLists?.[view] || saved;
          restore(store.projectLists[view].filters, selection.filters, {status: ['all', 'changes', 'unpushed', 'running', 'notes', 'paused', 'blocked'], category: null, group: null, showArchived: [true, false]});
          restore(store.projectLists[view].sort, selection.sort, {key: ['size', 'activity', 'name', 'next_step', 'git', 'ddev'], direction: ['asc', 'desc']});
        }
        restore(store.servicesSelection, saved.services, {origin: ['all', 'apple', 'third_party', 'own'], scope: ['all', 'user', 'system'], kind: ['all', 'launchd', 'cron'], status: ['all', 'running', 'waiting', 'failed', 'disabled', 'not_loaded', 'unknown', 'scheduled'], favorites: [true, false]});
        for (const kind of ['ddev', 'containers']) {
          restore(store.integrationLists[kind], saved[kind], {status: ['all', 'running', 'stopped', 'paused', 'unknown'], sort: kind === 'ddev' ? ['name', 'path', 'state'] : ['name', 'image', 'state', 'ports'], direction: ['asc', 'desc'], ...(kind === 'containers' ? {scope: ['all', 'outside', 'ddev']} : {})});
        }
      }
    } catch { /* Unavailable or malformed storage leaves the default selections. */ }
  }
  enabled = next;
  saveListPreferences();
}

export function saveListPreferences() {
  if (enabled === undefined) return;
  try {
    if (!enabled) {
      localStorage.removeItem(storageKey);
      return;
    }
    const projectLists = Object.fromEntries(Object.entries(store.projectLists).map(([view, selection]) => {
      const {query, ...filters} = selection.filters;
      return [view, {filters, sort: selection.sort}];
    }));
    const {query: ddevQuery, ...ddev} = store.integrationLists.ddev;
    const {query: containerQuery, ...containers} = store.integrationLists.containers;
    const {query: servicesQuery, ...services} = store.servicesSelection;
    localStorage.setItem(storageKey, JSON.stringify({projectLists, ddev, containers, services}));
  } catch { /* List interactions still work when browser storage is unavailable. */ }
}
