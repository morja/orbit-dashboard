/* Local storage: Mac capacity, usage history and largest projects. */
import { ago, bytes, formatDateTime, formatNumber } from '../format.js';
import { escape, markup } from '../html.js';
import { t, tHtml } from '../i18n.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

function macCard() {
  const mac = store.data.mac;
  if (!mac) return `<div class="panel"><p class="muted">${tHtml('Reading Mac storage …')}</p></div>`;
  const percent = mac.percent;
  // The donut circle has a circumference of 301.6 at radius 48.
  return markup`
    <div class="panel">
      <div class="section-heading"><h2>${icon('disk')}Macintosh</h2><span>${escape(ago(mac.checked_at))}</span></div>
      <div class="storage-total">
        <div class="donut">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="48" fill="none" style="stroke:var(--leaf-bg)"/>
            <circle cx="60" cy="60" r="48" fill="none" style="stroke:var(${percent >= 85 ? '--amber-mark' : '--leaf'})" stroke-dasharray="${percent * 3.016} 301.6"/>
          </svg>
          <div class="donut-text">${formatNumber(percent)} %<small>${tHtml('used')}</small></div>
        </div>
        <div class="storage-legend">
          <div><span>${tHtml('Used')}</span><b>${bytes(mac.used)}</b></div>
          <div><span>${tHtml('Free')}</span><b>${bytes(mac.free)}</b></div>
          <div><span>${tHtml('Total capacity')}</span><b>${bytes(mac.total)}</b></div>
        </div>
      </div>
      <p class="scope">${tHtml("The filesystem containing your home folder. APFS snapshots, clones and purgeable space may differ from Finder's figures.")}</p>
    </div>
  `;
}

function historyChart(history) {
  const values = history.map((point) => point.used / 1024 ** 3);
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const first = history[0].time;
  const last = history.at(-1).time;
  // Plot area: x from 40 to 520, y from 135 (min) up to 30 (max).
  const points = history.map((point) => `${40 + (point.time - first) / (last - first) * 480},${135 - (point.used / 1024 ** 3 - min) / (max - min) * 105}`).join(' ');
  return markup`
    <svg class="chart" viewBox="0 0 550 175" role="img" aria-label="${escape(t('Disk usage since recording began'))}">
      <path class="grid" d="M40 30h480M40 82h480M40 135h480"/>
      <text x="0" y="34">${max} GiB</text>
      <text x="0" y="139">${min} GiB</text>
      <polygon class="area" points="40,135 ${points} 520,135"/>
      <polyline class="curve" points="${points}"/>
      <text x="40" y="167">${escape(formatDateTime(first))}</text>
      <text x="520" y="167" text-anchor="end">${escape(formatDateTime(last))}</text>
    </svg>
  `;
}

function historyCard() {
  const history = store.data.mac?.history || [];
  const content = history.length < 2 ? `<div class="quiet">${tHtml('History starts now. The next sample arrives in five minutes.')}</div>` : historyChart(history);
  return markup`
    <div class="panel">
      <div class="section-heading"><h2>${tHtml('Storage history')}</h2><span>${tHtml('Last 7 days')}</span></div>
      ${content}
      <p class="chart-note">${tHtml('Mac disk usage · sampled every five minutes while Orbit is running.')}</p>
    </div>
  `;
}

function largestProjects() {
  const projects = store.data.projects;
  const measured = projects.filter((project) => project.size.bytes != null).sort((a, b) => b.size.bytes - a.size.bytes).slice(0, 10);
  const maximum = measured[0]?.size.bytes || 1;
  const total = projects.reduce((sum, project) => sum + (project.size.bytes || 0), 0);
  const bars = measured.map((project) => markup`
    <div>
      <div class="size-bar-label"><button class="edit-project" data-id="${project.id}">${escape(project.name)}</button><span>${bytes(project.size.bytes)}</span></div>
      <div class="size-bar"><i style="width:${Math.max(1, project.size.bytes / maximum * 100)}%"></i></div>
    </div>
  `);
  return markup`
    <div class="panel">
      <div class="section-heading"><h2>${tHtml('Largest projects')}</h2><span>${tHtml('{size} measured', { size: bytes(total) })}</span></div>
      <div class="size-bars">${measured.length ? bars : `<p class="muted">${tHtml('Measuring folder sizes …')}</p>`}</div>
      <p class="scope">${tHtml('Allocated filesystem space, including dependencies and Git files. Shared APFS data may count more than once.')}</p>
    </div>
  `;
}

export function storageView() {
  return markup`
    <div class="storage-columns">${macCard()}${historyCard()}</div>
    ${largestProjects()}
  `;
}
