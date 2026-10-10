/* Overview: summary tiles, what needs attention, server summaries and recent projects. */
import { ago, bytes, bytesParts, formatNumber } from '../format.js';
import { escape, markup } from '../html.js';
import { t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { projectSection } from './projects.js';
import { primaryServer, servers, overviewServers, sectionValue, serverHealth, serverLabel, serverSummary, serverState, serverHref } from './server.js';

const currentProjects = () => store.data.projects.filter((project) => project.state !== 'archived');
const uncommitted = () => currentProjects().filter((project) => project.git?.status === 'dirty');

/** Large number with a small unit, as in the storage tiles. */
function metricValue(value, unit) {
  return markup`<div class="metric-value">${value}<small>${unit}</small></div>`;
}

function macTile() {
  const mac = store.data.mac;
  const tone = mac?.percent >= 90 ? 'bad' : mac?.percent >= 85 ? 'warn' : '';
  const free = mac ? bytesParts(mac.free) : null;
  return markup`
    <a href="#storage" class="metric">
      <div class="metric-top">${tHtml('Mac · Free space')}${icon('disk')}</div>
      ${metricValue(free ? escape(free.number) : '…', free ? escape(free.unit) : '')}
      <div class="meter ${tone}"><i style="width:${mac?.percent || 0}%"></i></div>
      <div class="metric-bottom">
        <span>${mac ? tHtml('{percent} % used', { percent: formatNumber(mac.percent) }) : tHtml('Loading')}</span>
        <span>${mac ? tHtml('{size} total', { size: escape(bytes(mac.total)) }) : ''}</span>
      </div>
    </a>
  `;
}

function ddevRunning() {
  const { config, ddev } = store.data;
  if (!config?.ddev_enabled) return tHtml('DDEV disabled');
  if (ddev.running == null) return tHtml('DDEV unavailable');
  return tHtml('{count} DDEV running', { count: ddev.running });
}

function projectsTile() {
  const data = store.data;
  const archived = data.projects.filter((project) => project.state === 'archived').length;
  return markup`
    <a href="#projects" class="metric">
      <div class="metric-top">${tHtml('Your projects')}${icon('folder')}</div>
      ${metricValue(data.projects_checked_at ? currentProjects().length : '…', tHtml('Projects'))}
      <div class="metric-bottom">
        <span>${ddevRunning()}</span>
        <span>${tHtml('{count} archived', { count: archived })}</span>
      </div>
    </a>
  `;
}

function gitTile() {
  const changed = uncommitted();
  const entries = changed.reduce((total, project) => total + project.git.changed, 0);
  return markup`
    <button class="metric metric-filter" data-filter="changes" type="button">
      <div class="metric-top">${tHtml('Uncommitted Git changes')}${icon('branch')}</div>
      ${metricValue(changed.length, tHtml('Projects'))}
      <div class="metric-bottom">
        <span>${tHtml('{count} changed entries', { count: entries })}</span>
        <span>${tHtml('Details')} ${icon('arrow')}</span>
      </div>
    </button>
  `;
}

function serverTile() {
  const items = overviewServers();
  if (!items.length) return '';
  if (items.length === 1) {
    const server = items[0];
    const free = sectionValue(server, 'SPEICHER', 'Freier Platz');
    const [number, ...unit] = free ? free.split(' ') : [];
    return markup`
      <a href="${escape(serverHref(server))}" class="metric server-metric">
        <div class="metric-top">${escape(serverLabel(server))}${icon('server')}</div>
        ${metricValue(free ? escape(number) : '–', free ? tHtml('{unit} free', { unit: escape(unit.join(' ')) }) : '')}
        <div class="metric-bottom">${serverHealth(server)}<span>${escape(ago(server.status?.checked_at))}</span></div>
      </a>
    `;
  }
  const healthy = items.filter(server => serverState(server) === 'clear').length;
  return markup`
    <a href="#servers" class="metric server-metric">
      <div class="metric-top">${tHtml('Servers')}${icon('server')}</div>
      ${metricValue(items.length, tHtml('enabled'))}
      <div class="metric-bottom">${tHtml('{count} healthy', { count: healthy })}${items.length > healthy ? tHtml(' · {count} need attention', { count: items.length - healthy }) : ''}</div>
    </a>
  `;
}

export function ddevSummary() {
  const ddev = store.data.ddev;
  if (ddev.error || !ddev.checked_at) return t('DDEV unavailable');
  return t('{running} DDEV running · {count} registered', { running: ddev.running, count: ddev.projects.length });
}

function dockerTile() {
  const docker = store.data.docker || {};
  const disk = docker.vm_disk;
  const free = disk ? bytesParts(disk.free) : null;
  const usage = disk ? tHtml('{percent} % used', { percent: formatNumber(disk.percent) }) : tHtml(docker.colima_status === 'stopped' ? 'Colima stopped' : 'Not measured yet');
  const status = docker.status === 'running' ? 'Docker running' : docker.checked_at ? 'Docker unavailable' : 'Checking';
  return markup`
    <a href="#docker" class="metric docker-metric">
      <div class="metric-top">${tHtml('Colima · Free space')}${icon('server')}</div>
      ${metricValue(free ? escape(free.number) : '–', free ? escape(free.unit) : '')}
      <div class="meter ${disk?.percent >= 85 ? 'warn' : ''}"><i style="width:${disk?.percent || 0}%"></i></div>
      <div class="metric-bottom"><span>${usage}</span><span>${tHtml(status)}</span></div>
      <p class="scope">${escape(ddevSummary())}</p>
    </a>
  `;
}

function metrics() {
  const config = store.data.config;
  return markup`
    <div class="metrics overview-status">
      ${macTile()}
      ${projectsTile()}
      ${gitTile()}
      ${config?.moon_enabled && serverTile()}
      ${(config?.docker_enabled || config?.ddev_enabled) && dockerTile()}
    </div>
  `;
}

const lowColimaSpace = (disk) => disk && (disk.percent >= 85 || disk.free < 5 * 1024 ** 3);

function attentionRows() {
  const data = store.data;
  const rows = [];
  if (lowColimaSpace(data.docker?.vm_disk)) {
    rows.push({ icon: 'server', title: t('Colima is running low on space'), text: t('{size} free for DDEV and Docker.', { size: bytes(data.docker.vm_disk.free) }), href: '#docker' });
  }
  if (data.mac?.percent >= 85) {
    rows.push({ icon: 'disk', title: t('Your Mac is running low on space'), text: t('{size} free. Find the largest projects under Storage.', { size: bytes(data.mac.free) }), href: '#storage' });
  }
  if (data.config.moon_enabled) {
    for (const server of servers()) {
      if (server.status?.error) {
        rows.push({ icon: 'moon', title: t('{name} could not be refreshed', { name: server.label }), text: t('Last values shown. Check the SSH connection.'), href: serverHref(server) });
      } else {
        for (const warning of server.status?.warnings || []) {
          rows.push({ icon: 'alert', title: `${server.label}: ${warning}`, text: t('Notice from the server status'), href: serverHref(server) });
        }
      }
    }
  }
  const dirty = uncommitted();
  if (dirty.length) rows.push({ icon: 'branch', title: t('{count} projects with uncommitted changes', { count: dirty.length }), text: t('Uncommitted work in your workspace.'), filter: 'changes', info: true });
  const ahead = currentProjects().filter((project) => project.git?.ahead > 0);
  if (ahead.length) rows.push({ icon: 'branch', title: t('{count} projects with local commits', { count: ahead.length }), text: t('Compared with the last locally known upstream state.'), filter: 'unpushed', info: true });
  const blocked = currentProjects().filter((project) => project.state === 'blocked');
  if (blocked.length) rows.push({ icon: 'alert', title: t('{count} projects are blocked', { count: blocked.length }), text: t('Your project notes show where to continue.'), filter: 'blocked' });
  return rows;
}

function attentionRow(row) {
  // Rows open another view or filter the project list.
  const action = row.href
    ? `<a class="icon-button" href="${row.href}" aria-label="${escape(t('Open details'))}">${icon('arrow')}</a>`
    : `<button class="icon-button metric-filter" data-filter="${row.filter}" aria-label="${escape(t('Show projects'))}">${icon('arrow')}</button>`;
  return markup`
    <div class="attention-row ${row.info ? 'info' : ''}">
      <span class="attention-icon">${icon(row.icon)}</span>
      <div><strong>${escape(row.title)}</strong><p>${escape(row.text)}</p></div>
      ${action}
    </div>
  `;
}

function attention() {
  const rows = attentionRows();
  const quiet = store.data.checking.length ? tHtml('The initial checks are still running.') : tHtml('The checked values need no attention right now.');
  return markup`
    <div class="panel overview-attention">
      <div class="section-heading">
        <h2>${icon('activity')}${tHtml('Needs your attention')}${rows.length > 0 && `<span class="count">${rows.length}</span>`}</h2>
      </div>
      <div class="attention-list">
        ${rows.length ? rows.slice(0, 4).map(attentionRow) : `<div class="quiet">${icon('check')}${quiet}</div>`}
      </div>
      ${rows.length > 4 && `<a href="#servers" class="button text">${tHtml('View more notices')} ${icon('arrow')}</a>`}
    </div>
  `;
}

export function overviewView() {
  const summaries = store.data.config.moon_enabled ? overviewServers().map(server => serverSummary(server, true)) : [serverSummary(primaryServer(), true)];
  return markup`
    ${metrics()}
    <div class="overview-workspace">
      ${projectSection()}
      <aside class="overview-rail" aria-label="${escape(t('Workspace health'))}">${attention()}${summaries}</aside>
    </div>
  `;
}
