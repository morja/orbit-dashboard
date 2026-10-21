import { escape, markup } from '../html.js';
import { locale, tHtml } from '../i18n.js';
import { store } from '../store.js';

export const isDaily = () => ['today', 'yesterday', 'date'].includes(store.trafficSelection.period);

export function selectedDate(report) {
  const selection = store.trafficSelection;
  const options = report?.daily?.timezone ? {timeZone: report.daily.timezone} : {};
  const today = new Intl.DateTimeFormat('sv-SE', {...options, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  if (selection.period === 'date') return selection.date || today;
  if (selection.period !== 'yesterday') return today;
  return new Date(new Date(today + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
}

export function formatDay(date) {
  return new Intl.DateTimeFormat(locale(), {year: 'numeric', month: 'short', day: 'numeric'}).format(new Date(date + 'T12:00:00'));
}

export function dailyWindow(report) {
  const date = selectedDate(report);
  const day = report?.daily?.days.find(day => day.date === date);
  return {daily: true, date, missing: !day, pagesAvailable: !!day?.pagesAvailable,
    summary: {requests: day?.requests, visitors: day?.visitors}};
}

export function dailyChart(report) {
  const daily = report?.daily;
  if (!daily?.days.length) return '';
  const selection = store.trafficSelection;
  const today = selectedDate({...report, daily});
  const cutoff = selection.period === '7' ? 7 : 30;
  const days = daily.days.slice(-cutoff);
  const highest = days.reduce((max, day) => Math.max(max, day.visitors), 1);
  const number = value => Number(value).toLocaleString(locale());
  return markup`<div class="goaccess-daily">
    <div class="section-heading"><h2>${tHtml('Visitors by day')}</h2><span>${daily.timezone ? escape(daily.timezone) : tHtml('Report dates')}</span></div>
    <p class="muted goaccess-page-note">${daily.scope === 'successful-content-get' ? tHtml('Estimated visitors to successful content pages. Select a day to see its pages.') : tHtml('These daily totals include all requests and bots. Page details need a daily server export.')}</p>
    <div class="goaccess-day-chart" role="group" aria-label="${tHtml('Visitors by day')}">${days.map(day => {
      const date = formatDay(day.date);
      const label = tHtml('{date}: {visitors} visitors, {requests} requests', {date: escape(date), visitors: number(day.visitors), requests: number(day.requests)});
      return markup`<button class="goaccess-day" data-goaccess-day="${day.date}" aria-pressed="${String(isDaily() && day.date === today)}" aria-label="${label}" title="${label}">
        <span class="goaccess-day-value">${number(day.visitors)}</span>
        <span class="goaccess-day-track" aria-hidden="true"><span style="height:${day.visitors ? Math.max(2, Math.round(day.visitors / highest * 100)) : 0}%"></span></span>
        <span class="goaccess-day-label">${escape(day.date.slice(8))}</span>
      </button>`;
    }).join('')}</div>
    <div class="goaccess-day-range muted"><span>${formatDay(days[0].date)}</span><span>${formatDay(days.at(-1).date)}</span></div>
    ${daily.generatedAt ? `<p class="muted goaccess-page-note">${tHtml('Daily snapshot')}: ${escape(new Date(daily.generatedAt).toLocaleString(locale()))}. ${daily.includesCurrentLog ? tHtml('Includes the current log up to this snapshot. Load reports again after sharing a page.') : tHtml('The current log is not included in this export.')}</p>` : ''}
  </div>`;
}
