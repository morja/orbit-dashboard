/* Configured server list and the selected server’s Moon-compatible status. */
import { badge } from '../badges.js';
import { ago, stale, formatNumber } from '../format.js';
import { escape, markup } from '../html.js';
import { protocolText, systemMessage, t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

/** Configured servers with their last status; older snapshots only know one server. */
export function servers() {
  const data = store.data;
  if (Array.isArray(data.servers)) return data.servers;
  return [{ label: data.config.moon_label, status: data.moon }];
}

export const overviewServers = () => servers().filter(server => server.show_in_overview !== false);

/** Stable links keep the selected server when connections are reordered. */
export const serverKey = server => [server.host || serverLabel(server), server.command || ''].join(':');
export const serverHref = server => '#servers?server=' + encodeURIComponent(serverKey(server));

export const primaryServer = () => servers()[0] || { label: 'Server', status: null };

export function serverState(server) {
  const status = server.status;
  if (!status?.checked_at) return 'unavailable';
  if (isOutdated(status)) return 'outdated';
  return status.warnings?.length ? 'notices' : 'clear';
}

export const serverLabel = (server) => server.label || 'Server';

export const sectionValue = (server, section, label) => server.status?.sections?.[section]?.find((row) => row.label === label)?.value;

const isOutdated = (status) => status?.error || stale(status?.checked_at);

export function serverHealth(server) {
  const data = store.data;
  const status = server.status;
  if (data.config && !data.config.moon_enabled) return badge(t('Disabled'), 'gray');
  if (!status?.checked_at) return badge(data.checking.includes('moon') ? t('Checking') : t('Unavailable'), 'gray');
  if (isOutdated(status)) return badge(t('Out of date'), 'amber');
  return (status.warnings || []).length ? badge(t('{count} notices', { count: (status.warnings || []).length }), 'amber') : badge(t('All clear'));
}

// Website rows link to the checked domain.
function websiteLink(row, server) {
  const scheme = row.value.includes('(HTTP,') ? 'http' : 'https';
  const url = server.website_links?.[row.label] || `${scheme}://${row.label}`;
  return markup`
    <a href="${escape(url)}" target="_blank" rel="noopener noreferrer">
      ${escape(row.label)}${icon('external')}
    </a>
  `;
}

function uptime(value) {
  const match = value.match(/^(\d+(?:\.\d+)?) seconds$/);
  if (!match) return value;
  const minutes = Math.floor(Number(match[1]) / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  return [days ? t('{count} d', {count: days}) : '', hours ? t('{count} h', {count: hours}) : '',
    minutes % 60 ? t('{count} min', {count: minutes % 60}) : ''].filter(Boolean).join(' ') || t('Less than a minute');
}

function detailValue(section, row, outdated) {
  if (section === 'SYSTEM' && row.label === 'IP addresses') {
    return markup`<span class="server-addresses">${row.value.trim().split(/\s+/).filter(Boolean).map(address => `<code class="server-address">${escape(address).replace(/:/g, ':<wbr>')}</code>`)}</span>`;
  }
  if (section === 'SYSTEM' && row.label === 'Uptime') return escape(uptime(row.value));
  const text = protocolText(row.value);
  if (section === 'DIENSTE') return badge(text, outdated ? 'gray' : ['aktiv', 'active'].includes(row.value) ? '' : 'red');
  if (section === 'WEBSEITEN') return badge(text, outdated ? 'gray' : (row.value.startsWith('erreichbar') || row.value.startsWith('reachable')) ? '' : 'red');
  return escape(text);
}

const panelNotes = {
  WEBSEITEN: 'DNS, TLS and HTTP as checked from this server. Protected access does not confirm a successful login.',
  PORTS: 'Port results from the configured status command. Reachability does not confirm a working service or a successful login.',
};

/** One section of the status output as a panel, such as services or backups. */
export function serverPanel(server, section, title, iconName) {
  const rows = (server.status?.sections?.[section] || []).filter((row) => row.label !== 'Prüfumfang' && !(section === 'SYSTEM' && row.label === 'RAM' && (server.status?.memory || /^[\d.]+ \/ [\d.]+ GiB used$/.test(row.value))));
  const outdated = isOutdated(server.status);
  const details = rows.map((row) => {
    const isDomain = section === 'WEBSEITEN' && /^[a-z0-9.-]+\.[a-z]+$/.test(row.label);
    const label = isDomain || server.website_links?.[row.label] ? websiteLink(row, server) : escape(t(protocolText(row.label)));
    return markup`<div class="detail-row ${section === 'SYSTEM' && row.label === 'IP addresses' ? 'server-ip-row' : ''}"><span>${label}</span><span>${detailValue(section, row, outdated)}</span></div>`;
  });
  return markup`
    <div class="panel">
      <div class="section-heading"><h2>${icon(iconName)}${escape(title)}</h2></div>
      <div class="detail-list">
        ${rows.length ? details : `<p class="muted">${tHtml('No data yet.')}</p>`}
      </div>
      ${panelNotes[section] && `<p class="scope">${tHtml(panelNotes[section])}</p>`}
    </div>
  `;
}

/** Generic reported ports, with the existing Review-SMB check preserved. */
function portPanel(server) {
  const sections = server.status?.sections || {};
  const rows = [
    ...(sections.PORTS || []),
    ...(sections['GASAMBA REVIEW-SMB'] || []).map(row => ({...row, label: 'Review-SMB · ' + row.label})),
  ];
  if (!rows.length) return '';
  const reported = {...server, status: {...server.status, sections: {...sections, PORTS: rows}}};
  return serverPanel(reported, 'PORTS', t('Ports'), 'server');
}

function resourceChart(label, percent, className) {
  if (!Number.isFinite(percent)) return '';
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  return markup`<div class="${className}"><strong>${bounded}%</strong><span>${escape(label)}</span><div class="server-disk-track" role="meter" aria-label="${escape(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bounded}"><i style="width:${bounded}%"></i></div></div>`;
}

function storagePanel(server) {
  const disk = server.status?.disk;
  const reported = sectionValue(server, 'SPEICHER', 'Home-Dateisystem') || '';
  const percent = disk ? disk.used / disk.total * 100 : Number(reported.match(/\((\d+(?:[.,]\d+)?)\s*%\)/)?.[1]?.replace(',', '.'));
  // Old snapshots retain only a rounded RAM string. New queries preserve exact bytes.
  const oldMemory = sectionValue(server, 'SYSTEM', 'RAM')?.match(/([\d.]+) \/ ([\d.]+) GiB used/);
  const memory = server.status?.memory || (oldMemory ? {used: Number(oldMemory[1]) * 2**30, total: Number(oldMemory[2]) * 2**30} : null);
  const ramPercent = memory?.total > 0 ? memory.used / memory.total * 100 : NaN;
  const graphic = markup`<div class="server-resource-meters">${resourceChart(t('Storage used'), percent, 'server-disk-chart')}${resourceChart(t('RAM used'), ramPercent, 'server-ram-chart')}</div>`;
  const ramDetail = Number.isFinite(ramPercent) ? markup`<div class="detail-row"><span>RAM</span><span>${tHtml('{used} / {total} GiB used', {used: formatNumber(memory.used / 2**30), total: formatNumber(memory.total / 2**30)})}</span></div>` : '';
  return serverPanel(server, 'SPEICHER', t('Storage'), 'disk').replace('<div class="detail-list">', graphic + '<div class="detail-list">' + ramDetail);
}

function serverSection(server) {
  const status = server.status;
  const label = serverLabel(server);
  const notices = [];
  if (status?.error) notices.push(escape(systemMessage(status.error)));
  if (status?.checked_at && stale(status.checked_at) && !status.error) notices.push(tHtml('These server values are out of date. A fresh check runs automatically.'));
  if (status?.warnings.length) notices.push(status.warnings.map((message) => escape(systemMessage(message))).join('<br>'));
  return markup`
    <h2 class="server-section-title">${escape(label)}</h2>
    <div class="moon-heading">
      <p>${tHtml('Checked on {name} · {time}', { name: escape(label), time: escape(ago(status?.checked_at)) })}</p>
      ${serverHealth(server)}
    </div>
    ${notices.map((notice) => `<div class="notice">${notice}</div>`)}
    <div class="moon-grid server-facts">
      ${status?.sections?.SYSTEM?.length ? serverPanel(server, 'SYSTEM', t('System'), 'server') : ''}
      ${storagePanel(server)}
      ${status?.sections?.BACKUP?.length ? serverPanel(server, 'BACKUP', 'Backup', 'disk') : ''}
    </div>
    <div class="moon-grid server-lists">
      ${serverPanel(server, 'DIENSTE', t('Services'), 'server')}
      ${serverPanel(server, 'WEBSEITEN', 'Websites', 'external')}
      ${portPanel(server)}
    </div>
  `;
}

/** A compact connection list and details for exactly one server. */
export function serverView() {
  const items = servers();
  if (!items.length) return serverSummary(primaryServer(), true);
  const selected = items.find(server => serverKey(server) === store.selectedServer) || items[0];
  const list = items.map(server => markup`
    <a class="server-choice ${server === selected ? 'active' : ''}" href="${escape(serverHref(server))}" ${server === selected ? 'aria-current="true"' : ''}>
      <strong>${escape(serverLabel(server))}</strong>
      <span class="server-choice-host">${escape(server.host || '')}</span>
      ${serverHealth(server)}
    </a>
  `);
  return markup`
    <div class="server-workspace">
      <section class="panel server-list">
        <div class="section-heading"><h2>${icon('server')}${tHtml('Servers')}<span class="count">${items.length}</span></h2></div>
        <nav aria-label="${escape(t('Server selection'))}">${list}</nav>
        <button class="button text setup-settings" data-settings-section="server">${tHtml('Manage servers')} ${icon('settings')}</button>
      </section>
      <section class="server-details">${serverSection(selected)}</section>
    </div>
  `;
}

/** Compact status for the overview, or a pointer to Settings without a server. */
export function serverSummary(server, compact = false) {
  const data = store.data;
  if (data.config && !data.config.moon_enabled) {
    return markup`
      <div class="panel">
        <div class="section-heading"><h2>${icon('settings')}${tHtml('Your workspace')}</h2></div>
        <p class="muted">${tHtml('Configure project folders, tools and an optional server in Settings.')}</p>
        <button class="button secondary setup-settings">${tHtml('Open settings')}</button>
      </div>
    `;
  }
  const label = escape(serverLabel(server));
  const key = serverKey(server);
  const services = server.status?.sections?.DIENSTE || [];
  const outdated = isOutdated(server.status);
  const dots = services.map((service) => markup`
    <span class="service-dot ${outdated ? 'unknown' : ['aktiv', 'active'].includes(service.value) ? '' : 'bad'}" title="${escape(protocolText(service.value))}">
      <i></i>${escape(protocolText(service.label))}
    </span>
  `);
  const checking = data.checking.includes('moon') ? tHtml('{name} is being checked over SSH …', { name: label }) : tHtml(server.status?.sections?.SYSTEM?.length ? 'System data available' : 'No server data yet.');
  return markup`
    <div class="panel overview-server">
      <div class="section-heading">
        <h2>${icon('moon')}${compact ? label : tHtml('{name} at a glance', { name: label })}${compact ? serverHealth(server) : ''}</h2>
        <a class="button text" href="${escape(serverHref(server))}">${tHtml('Details')} ${icon('arrow')}</a>
      </div>
      ${compact && services.length ? markup`<details class="server-services" data-server-key="${escape(key)}" ${store.expandedServices.has(key) ? 'open' : ''}><summary>${tHtml('{count} services', { count: services.length })}</summary><div class="service-dots">${dots}</div></details>` : markup`<div class="service-dots">${services.length ? dots : `<p class="muted">${checking}</p>`}</div>`}
      ${server.status?.sections?.BACKUP?.length && markup`<div class="moon-summary">
        <span>${tHtml('Last successful backup')}</span>
        <b>${escape(sectionValue(server, 'BACKUP', 'Letzter Erfolg') || t('Not known yet'))}</b>
      </div>`}
      <div class="moon-summary">
        <span>${tHtml('Free space')}</span>
        <b>${escape(sectionValue(server, 'SPEICHER', 'Freier Platz') || t('Not known yet'))}</b>
      </div>
    </div>
  `;
}

/** Keep a service list open when fresh collector data redraws the overview. */
export function bindServerSummaries() {
  document.addEventListener('toggle', event => {
    if (!event.target.matches?.('.server-services')) return;
    const key = event.target.dataset.serverKey;
    if (event.target.open) store.expandedServices.add(key);
    else store.expandedServices.delete(key);
  }, true);
}
