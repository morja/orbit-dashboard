/* Formatting of numbers, sizes and times for the current language. */
import { locale, t } from './i18n.js';

export const formatNumber = (value) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value);

const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function bytes(value) {
  if (value == null) return '…';
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024))));
  return `${formatNumber(value / 1024 ** index)} ${units[index]}`;
}

/** Number and unit separately, for large figures with a small unit. */
export function bytesParts(value) {
  const [number, unit] = bytes(value).split(' ');
  return { number, unit: unit ?? '' };
}

export function ago(date) {
  if (!date) return t('not checked yet');
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return t('just checked');
  if (seconds < 3600) return t('checked {count} min ago', { count: Math.floor(seconds / 60) });
  return t('checked {count} h ago', { count: Math.floor(seconds / 3600) });
}

/** Relative project activity; keep exact timestamps in the table tooltip. */
export function relativeTime(seconds, now = Date.now()) {
  const elapsed = Math.max(0, (now - seconds * 1000) / 1000);
  const ranges = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'],
    [3600, 'hour'], [60, 'minute'], [1, 'second']];
  const [size, unit] = ranges.find(([size]) => elapsed >= size) ?? ranges.at(-1);
  return new Intl.RelativeTimeFormat(locale(), { numeric: 'always' })
    .format(-Math.floor(elapsed / size), unit);
}

/** True when a value is missing or older than the given number of seconds. */
export const stale = (date, seconds = 300) => !date || Date.now() - new Date(date).getTime() > seconds * 1000;

export const formatDate = (seconds) => new Date(seconds * 1000).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

export const formatDateTime = (seconds) => new Date(seconds * 1000).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const formatTime = (date = new Date()) => date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
