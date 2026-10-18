/* Inline SVG icons. They inherit color and size from CSS. */

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3z"/>',
  moon: '<path d="M20.5 14.2A9 9 0 0 1 9.8 3.5 9 9 0 1 0 20.5 14.2z"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 14h18M7 17h.01M11 17h.01"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  services: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  cube: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M21.90 10.61L21.90 13.39L19.79 13.80L18.78 16.24L19.99 18.02L18.02 19.99L16.24 18.78L13.80 19.79L13.39 21.90L10.61 21.90L10.20 19.79L7.76 18.78L5.98 19.99L4.01 18.02L5.22 16.24L4.21 13.80L2.10 13.39L2.10 10.61L4.21 10.20L5.22 7.76L4.01 5.98L5.98 4.01L7.76 5.22L10.20 4.21L10.61 2.10L13.39 2.10L13.80 4.21L16.24 5.22L18.02 4.01L19.99 5.98L18.78 7.76L19.79 10.20Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M18 8a9 9 0 0 1-12 9"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  'cloud-off': '<path d="m3 3 18 18M8 8a5 5 0 0 0-1 10h10M10 5a6 6 0 0 1 8 5 4 4 0 0 1 3 6"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v4M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m14 4 6 6M4 20l5-1L21 7l-4-4L5 15z"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  terminal: '<path d="m4 6 6 6-6 6M13 18h7"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
};

export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.folder}</svg>`;

/** Fill static placeholders such as <span data-icon="close"></span>. */
export function hydrateIcons(root = document) {
  for (const element of root.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
}
