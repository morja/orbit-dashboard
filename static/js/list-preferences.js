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
        restore(store.filters, saved.filters, {status: ['all', 'changes', 'unpushed', 'running', 'notes', 'paused', 'blocked'], category: null, group: null, showArchived: [true, false]});
        restore(store.sort, saved.sort, {key: ['size', 'activity', 'name', 'next_step', 'git', 'ddev'], direction: ['asc', 'desc']});
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
    const {query: projectQuery, ...filters} = store.filters;
    const {query: ddevQuery, ...ddev} = store.integrationLists.ddev;
    const {query: containerQuery, ...containers} = store.integrationLists.containers;
    localStorage.setItem(storageKey, JSON.stringify({filters, sort: store.sort, ddev, containers}));
  } catch { /* List interactions still work when browser storage is unavailable. */ }
}
