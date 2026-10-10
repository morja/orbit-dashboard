/*
 * Translation of source-owned text. English source text is the key; locales/de.js
 * holds the German text. Placeholders such as {count} are filled at runtime.
 * Project names, paths, notes and other workspace content are never translated.
 */
import german from './locales/de.js';
import { escape } from './html.js';

const dictionaries = { de: german };
const listeners = [];
let language = 'en';

export const currentLanguage = () => language;
export const locale = () => (language === 'de' ? 'de-DE' : 'en-US');

// A dictionary entry is either text or plural forms such as { one: '…', other: '…' }.
function template(key, values) {
  const entry = dictionaries[language]?.[key] ?? key;
  if (typeof entry === 'string') return entry;
  const form = new Intl.PluralRules(locale()).select(Number(values?.count ?? 0));
  return entry[form] ?? entry.other;
}

function fill(text, values) {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => (name in values ? String(values[name]) : placeholder));
}

/** Translated plain text. Use it for textContent, attributes after escape(), and messages. */
export const t = (key, values) => fill(template(key, values), values);

/** Translated text as escaped HTML. Values are inserted as given and must be safe markup. */
export const tHtml = (key, values) => fill(escape(template(key, values)), values);

/*
 * Backend messages arrive in English. Known messages are translated; names and
 * paths inside them stay unchanged, and field names are translated.
 */
const messagePatterns = [
  { pattern: /^Project folder is unavailable: (.+)$/, key: 'Project folder is unavailable: {path}', names: ['path'] },
  { pattern: /^(.+) is currently unavailable or its status cannot be read\. Last values remain visible\.$/, key: '{name} is currently unavailable or its status cannot be read. Last values remain visible.', names: ['name'] },
  { pattern: /^(.+): invalid text$/, key: '{field}: invalid text', names: ['field'], translated: ['field'] },
  { pattern: /^(.+) must be a boolean$/, key: '{field} must be a boolean', names: ['field'], translated: ['field'] },
  { pattern: /^(.+): Percentage must be between (\d+) and (\d+)$/, key: '{field}: Percentage must be between {minimum} and {maximum}', names: ['field', 'minimum', 'maximum'] },
  { pattern: /^(.+): Interval must be between (\d+) and 86400 seconds$/, key: '{field}: Interval must be between {minimum} and 86400 seconds', names: ['field', 'minimum'] },
];

export function systemMessage(text) {
  if (language === 'en' || typeof text !== 'string') return text;
  if (dictionaries[language][text]) return t(text);
  for (const { pattern, key, names, translated = [] } of messagePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, index) => [name, translated.includes(name) ? t(match[index + 1]) : match[index + 1]]));
    return t(key, values);
  }
  return text;
}

/*
 * The Moon status adapter keeps its original German identifiers. Known labels and
 * states are shown in English; parsed data and unknown text stay as they are.
 */
const protocolEnglish = {
  'Freier Platz': 'Free space',
  'Home-Dateisystem': 'Home filesystem',
  'Alter': 'Age',
  'Zeitplan': 'Schedule',
  'Server-Zeitzone': 'Server time zone',
  'Cloud-Prüfung': 'Cloud check',
  'Letzter Erfolg': 'Last success',
  'Letzter Abschluss': 'Last completion',
  'Letzter Start': 'Last start',
  'Belegt': 'Used',
  'Gesamt': 'Total',
  'Mailversand': 'Mail delivery',
  'aktiv': 'active',
  'inaktiv': 'inactive',
  'erfolgreich': 'successful',
  'nicht aktiv': 'inactive',
  'erreichbar': 'reachable',
  'Zertifikat ungültig': 'Invalid certificate',
};

export function protocolText(text) {
  const english = protocolEnglish[text];
  if (english) return language === 'de' ? text : english;
  if (language === 'en' && typeof text === 'string' && text.startsWith('erreichbar (')) return text.replace('erreichbar', 'reachable');
  return text;
}

/*
 * Static page text is captured once in English, before any workspace content is
 * inserted, and switched with the language.
 */
const staticText = [];
const staticAttributes = [];

export function captureStaticText(root = document.documentElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const source = node.textContent.trim();
    if (source && german[source] && !node.parentElement.closest('script, style')) staticText.push({ node, original: node.textContent, source });
  }
  for (const element of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const source = element.getAttribute(name);
      if (source && german[source]) staticAttributes.push({ element, name, source });
    }
  }
}

export const onLanguageChange = (listener) => listeners.push(listener);

export function setLanguage(value) {
  const next = value === 'de' ? 'de' : 'en';
  if (language === next) return;
  language = next;
  document.documentElement.lang = next;
  document.title = t('Orbit · Your overview');
  for (const { node, original, source } of staticText) node.textContent = original.replace(source, t(source));
  for (const { element, name, source } of staticAttributes) element.setAttribute(name, t(source));
  for (const listener of listeners) listener(next);
  // The Mac app may localize its own menus.
  window.webkit?.messageHandlers?.languageChanged?.postMessage(next);
}
