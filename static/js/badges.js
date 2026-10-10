/* Status badges shared by several views. */
import { escape } from './html.js';
import { t } from './i18n.js';

export const badge = (text, variant = '') => `<span class="badge ${variant}">${escape(text)}</span>`;

export function gitBadge(git) {
  if (git.status === 'archived') return badge(t('Not monitored'), 'gray');
  if (git.status === 'none') return badge(t('No Git'), 'gray');
  if (git.status === 'unknown') return badge(t('Unavailable'), 'gray');
  if (git.conflicts) return badge(t('{count} conflicts', { count: git.conflicts }), 'red');
  return git.changed ? badge(t('{count} open', { count: git.changed }), 'amber') : badge('Clean');
}

const ddevLabels = {
  none: 'No DDEV',
  unknown: 'Unavailable',
  unregistered: 'Not registered',
  running: 'Running',
  stopped: 'Stopped',
  paused: 'Paused',
};

export function ddevBadge(ddev) {
  const label = ddevLabels[ddev.status] ? t(ddevLabels[ddev.status]) : ddev.status;
  return badge(label, ddev.status === 'running' ? '' : 'gray');
}
