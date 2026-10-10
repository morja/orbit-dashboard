/* Shared dashboard state. Modules read and change it through this object. */

export const store = {
  // Last snapshot from /api/state, or null before the first answer.
  data: null,
  view: 'overview',
  expandedServices: new Set(),
  selectedServer: null,
  integrationLists: {
    ddev: {query: '', status: 'all', sort: 'name', direction: 'asc'},
    containers: {query: '', status: 'all', scope: 'all', sort: 'name', direction: 'asc'},
  },
  // Project list selection; see views/projects.js.
  filters: { status: 'all', query: '', category: 'all', group: 'all', showArchived: false },
  sort: { key: 'activity', direction: 'desc' },
};
