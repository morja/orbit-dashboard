/* Helpers for building HTML strings. Workspace content always passes through escape(). */

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);

/**
 * Template tag for HTML. Line breaks and the indentation that follows them are
 * removed from the template text, so templates can be formatted freely without
 * adding whitespace to the page. Arrays are joined; null, undefined and false
 * render nothing. Values are inserted as given and must already be escaped.
 */
export function markup(strings, ...values) {
  return strings.reduce((html, part, index) => {
    const value = values[index];
    const rendered = Array.isArray(value) ? value.join('') : value === false || value == null ? '' : value;
    return html + part.replace(/\n\s*/g, '') + (index < values.length ? rendered : '');
  }, '');
}
