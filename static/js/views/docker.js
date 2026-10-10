/* Docker & DDEV: Colima storage, running projects, Docker's storage breakdown and DDEV projects. */
import { badge, ddevBadge } from '../badges.js';
import { ago, bytes } from '../format.js';
import { escape, markup } from '../html.js';
import { locale, systemMessage, t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

const usageLabels = { Images: 'Images', Containers: 'Containers', 'Local Volumes': 'Volumes / databases', 'Build Cache': 'Build cache' };

function warnings(docker) {
  const disk = docker.vm_disk;
  const messages = [...(docker.errors || [])];
  if (disk && (disk.percent >= 85 || disk.free < 5 * 1024 ** 3)) messages.push('Colima is running low on space. Check storage before creating another DDEV project.');
  if (docker.profile && !docker.docker_on_colima) messages.push('Docker uses a different endpoint. Its figures do not belong to this Colima VM.');
  if (!messages.length) return '';
  return `<div class="notice">${messages.map((message) => escape(systemMessage(message))).join('<br>')}</div>`;
}

function colimaPanel(docker) {
  const disk = docker.vm_disk;
  const state = { running: 'Running', stopped: 'Stopped' }[docker.colima_status] || 'Unknown';
  return markup`
    <section class="panel">
      <div class="section-heading">
        <h2>${icon('disk')}${tHtml('Colima · Storage')}</h2>
        ${badge(t(state), docker.colima_status === 'running' ? '' : 'gray')}
      </div>
      <div class="docker-free">${disk ? bytes(disk.free) : '–'}<small>${tHtml('free for images and databases')}</small></div>
      <div class="meter ${disk?.percent >= 85 ? 'warn' : ''}"><i style="width:${disk?.percent || 0}%"></i></div>
      <div class="storage-legend">
        <div><span>${tHtml('Used inside VM')}</span><b>${bytes(disk?.used)}</b></div>
        <div><span>${tHtml('Data partition capacity')}</span><b>${bytes(disk?.total)}</b></div>
        <div><span>${tHtml('Colima on Mac')}</span><b>${bytes(docker.host_bytes)}</b></div>
        <div><span>${tHtml('Free on Mac')}</span><b>${bytes(store.data.mac?.free)}</b></div>
      </div>
      <p class="scope">${tHtml('The VM has its own free space. Its files also occupy space on your Mac. Colima on Mac includes all profiles. Measured {time}.', { time: escape(ago(docker.checked_at)) })}</p>
    </section>
  `;
}

function runningPanel(docker) {
  const ddev = store.data.ddev;
  const hasDdev = store.data.config?.ddev_enabled;
  const usage = docker.usage || [];
  const containers = usage.find((row) => row.type === 'Containers');
  const reclaimable = usage.reduce((total, row) => total + row.reclaimable, 0);
  const scope = hasDdev ? systemMessage(ddev.error) || t('All registered DDEV projects, including those outside your project folders.') : t('Containers from the current Docker endpoint.');
  return markup`
    <section class="panel">
      <div class="section-heading">
        <h2>${icon('activity')}${hasDdev ? tHtml('Running projects') : tHtml('Docker containers')}</h2>
        ${badge(t(docker.status === 'running' ? 'Docker available' : 'Unavailable'), docker.status === 'running' ? '' : 'gray')}
      </div>
      <div class="docker-free">${hasDdev ? (ddev.error || !ddev.checked_at ? '–' : ddev.running) : containers?.active ?? '–'}<small>${hasDdev ? tHtml('DDEV projects running') : tHtml('Active Docker containers')}</small></div>
      <div class="storage-legend">
        ${hasDdev && markup`<div><span>${tHtml('Registered DDEV projects')}</span><b>${ddev.checked_at ? ddev.projects.length : '–'}</b></div>`}
        <div><span>${tHtml('Active Docker containers')}</span><b>${containers?.active ?? '–'}</b></div>
        <div><span>${tHtml("Docker's estimated reclaimable space")}</span><b>${usage.length ? bytes(reclaimable) : '–'}</b></div>
      </div>
      <p class="scope">${escape(scope)} ${tHtml('Measured {time}.', { time: escape(ago(hasDdev ? ddev.checked_at : docker.checked_at)) })}</p>
    </section>
  `;
}

function usagePanel(docker) {
  const usage = docker.usage || [];
  const rows = usage.map((row) => markup`
    <tr>
      <td>${tHtml(usageLabels[row.type] || row.type)}</td>
      <td>${row.count}</td>
      <td>${row.active}</td>
      <td>${bytes(row.bytes)}</td>
      <td>${bytes(row.reclaimable)}</td>
    </tr>
  `);
  const empty = `<tr><td colspan="5">${tHtml('Docker storage is currently unavailable.')}</td></tr>`;
  return markup`
    <section class="panel docker-panel">
      <div class="section-heading"><h2>${icon('server')}${tHtml('Docker · Storage breakdown')}</h2><span>${escape(ago(docker.checked_at))}</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="caps">${tHtml('Area')}</th>
              <th class="caps">${tHtml('Count')}</th>
              <th class="caps">${tHtml('Active')}</th>
              <th class="caps">${tHtml('Used')}</th>
              <th class="caps">${tHtml('Reclaimable')}</th>
            </tr>
          </thead>
          <tbody>${usage.length ? rows : empty}</tbody>
        </table>
      </div>
      <p class="scope">${tHtml("Reclaimable space is Docker's estimate. Shared image layers may count more than once; the total differs from Mac disk usage. Orbit does not delete images, volumes or databases.")}</p>
    </section>
  `;
}

function listSelection(kind) {
  return store.integrationLists[kind];
}

function listToolbar(kind) {
  const selection = listSelection(kind);
  return markup`<div class="integration-toolbar">
    <label class="search-box">${icon('search')}<input id="${kind}-search" data-list-query="${kind}" value="${escape(selection.query)}" placeholder="${escape(t('Search names, paths or images …'))}" aria-label="${escape(t('Search list'))}"></label>
    <label>${tHtml('Status')} <select data-list-state="${kind}" aria-label="${escape(t('Filter by status'))}">
      ${[['all', t('All')], ['running', t('Running')], ['stopped', t('Stopped')], ['paused', t('Paused')], ['unknown', t('Unknown')]].map(([value, label]) => `<option value="${value}" ${selection.status === value ? 'selected' : ''}>${escape(label)}</option>`)}
    </select></label>
    ${kind === 'containers' && markup`<label>${tHtml('Scope')} <select data-list-scope="containers" aria-label="${escape(t('Container scope'))}">
      ${[['all', t('All containers')], ['outside', t('Outside DDEV')], ['ddev', 'DDEV']].map(([value, label]) => `<option value="${value}" ${selection.scope === value ? 'selected' : ''}>${escape(label)}</option>`)}
    </select></label>`}
    ${(selection.query || selection.status !== 'all' || (kind === 'containers' && selection.scope !== 'all')) && markup`<button type="button" class="reset-filters" data-list-reset="${kind}">${tHtml('Reset filters')}</button>`}
  </div>`;
}

function listHeader(kind, key, label) {
  const selection = listSelection(kind);
  const active = selection.sort === key;
  return markup`<th aria-sort="${active ? (selection.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="column-sort" data-list-sort="${kind}" data-key="${key}">${escape(label)}<span>${active ? (selection.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>`;
}

function selectedRows(kind, rows) {
  const selection = listSelection(kind);
  const state = row => row.state || row.status || 'unknown';
  return rows.filter(row => {
    const status = state(row).toLowerCase();
    const matchesStatus = selection.status === 'all' || (selection.status === 'stopped' ? ['stopped', 'exited', 'created', 'dead'].includes(status) : status === selection.status);
    const matchesScope = kind !== 'containers' || selection.scope === 'all' || (selection.scope === 'ddev' ? row.is_ddev : !row.is_ddev);
    return matchesStatus && matchesScope && Object.values(row).join(' ').toLocaleLowerCase(locale()).includes(selection.query.toLocaleLowerCase(locale()));
  }).sort((a, b) => String(selection.sort === 'state' ? state(a) : a[selection.sort] || '').localeCompare(String(selection.sort === 'state' ? state(b) : b[selection.sort] || ''), locale(), {numeric: true}) * (selection.direction === 'asc' ? 1 : -1));
}

function ddevPanel() {
  const ddev = store.data.ddev;
  const projects = selectedRows('ddev', ddev.projects || []);
  const rows = projects.map(project => markup`<tr><td>${escape(project.name)}</td><td class="docker-path">${escape(project.path.replace(/^\/Users\/[^/]+\//, '~/'))}</td><td>${ddevBadge(project)}</td></tr>`);
  const empty = `<tr><td colspan="3">${tHtml(ddev.error || !ddev.checked_at ? 'DDEV unavailable.' : 'No projects match this selection.')}</td></tr>`;
  return markup`<section class="panel docker-panel" id="ddev-list">
    <div class="section-heading"><h2>${icon('folder')}${tHtml('Registered DDEV projects')}</h2><span>${escape(ago(ddev.checked_at))}</span></div>
    ${listToolbar('ddev')}
    <div class="table-wrap"><table><thead><tr>${listHeader('ddev', 'name', t('Project'))}${listHeader('ddev', 'path', t('Path'))}${listHeader('ddev', 'state', t('Status'))}</tr></thead><tbody>${rows.length ? rows : empty}</tbody></table></div>
    <p class="scope">${tHtml('{shown} of {total} projects', {shown: projects.length, total: (ddev.projects || []).length})}</p>
  </section>`;
}

function containerPanel(docker) {
  const containers = selectedRows('containers', docker.containers || []);
  const rows = containers.map(row => markup`<tr>
    <td>${escape(row.name)}${row.is_ddev ? '<small class="container-kind">DDEV</small>' : ''}</td><td>${escape(row.image)}</td>
    <td title="${escape(row.status)}">${badge(row.state, row.state === 'running' ? '' : 'gray')}</td><td>${escape(row.ports || '–')}</td>
  </tr>`);
  return markup`<section class="panel docker-panel" id="container-list">
    <div class="section-heading"><h2>${icon('server')}${tHtml('Docker containers')}</h2><span>${escape(ago(docker.checked_at))}</span></div>
    ${listToolbar('containers')}
    <div class="table-wrap"><table><thead><tr>${listHeader('containers', 'name', t('Name'))}${listHeader('containers', 'image', t('Image'))}${listHeader('containers', 'state', t('Status'))}${listHeader('containers', 'ports', t('Ports'))}</tr></thead>
    <tbody>${rows.length ? rows : `<tr><td colspan="4">${escape(systemMessage(docker.containers_error) || t('No containers match this selection.'))}</td></tr>`}</tbody></table></div>
    <p class="scope">${tHtml('Lists containers from the current Docker endpoint, including stopped containers. DDEV is identified by its container label. No containers are started or changed.')}${docker.containers_truncated ? ' ' + tHtml('Container list limited to 250 entries.') : ''}</p>
  </section>`;
}

export function bindDockerEvents(render) {
  document.getElementById('content').addEventListener('input', event => {
    const kind = event.target.dataset.listQuery;
    if (!kind) return;
    listSelection(kind).query = event.target.value;
    render();
  });
  document.getElementById('content').addEventListener('change', event => {
    const kind = event.target.dataset.listState || event.target.dataset.listScope;
    if (!kind) return;
    listSelection(kind)[event.target.dataset.listState ? 'status' : 'scope'] = event.target.value;
    // Release the select so the normal refresh guard does not defer this change.
    event.target.blur();
    render();
  });
  document.getElementById('content').addEventListener('click', event => {
    const reset = event.target.closest('[data-list-reset]');
    if (reset) {
      const selection = listSelection(reset.dataset.listReset);
      Object.assign(selection, {query: '', status: 'all', ...(reset.dataset.listReset === 'containers' ? {scope: 'all'} : {})});
      render();
      return;
    }
    const button = event.target.closest('[data-list-sort]');
    if (!button) return;
    const selection = listSelection(button.dataset.listSort);
    selection.direction = selection.sort === button.dataset.key && selection.direction === 'asc' ? 'desc' : 'asc';
    selection.sort = button.dataset.key;
    render();
  });
}

export function dockerView() {
  const docker = store.data.docker || {};
  return markup`
    ${warnings(docker)}
    <div class="storage-columns">${colimaPanel(docker)}${runningPanel(docker)}</div>
    ${usagePanel(docker)}
    ${store.data.config?.ddev_enabled && ddevPanel()}
    ${store.data.config?.docker_enabled && containerPanel(docker)}
  `;
}
