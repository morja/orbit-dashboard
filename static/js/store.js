/* Shared dashboard state. Modules read and change it through this object. */

function projectList() {
  return {
    filters: {status: 'all', query: '', category: 'all', group: 'all', showArchived: false},
    sort: {key: 'activity', direction: 'desc'},
  };
}

export const store = {
  // Last snapshot from /api/state, or null before the first answer.
  data: null,
  view: 'overview',
  servicesSelection: {query: '', origin: 'all', scope: 'all', status: 'all', kind: 'all', favorites: false},
  expandedServices: new Set(),
  selectedServer: null,
  trafficSelection: {report: null, period: '30', date: '', mode: 'pages', query: '', sort: 'requests', merged: false, page: 1},
  integrationLists: {
    ddev: {query: '', status: 'all', sort: 'name', direction: 'asc'},
    containers: {query: '', status: 'all', scope: 'all', sort: 'name', direction: 'asc'},
  },
  // Overview and Projects keep independent selections, including session searches.
  projectLists: {overview: projectList(), projects: projectList()},
  get filters() { return this.projectLists[this.view === 'overview' ? 'overview' : 'projects'].filters; },
  get sort() { return this.projectLists[this.view === 'overview' ? 'overview' : 'projects'].sort; },
  set sort(value) { this.projectLists[this.view === 'overview' ? 'overview' : 'projects'].sort = value; },
};
