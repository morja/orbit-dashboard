/*
 * The "Check" action on the low-space notice. It runs the Cockpit command
 * `disk-check --quick` through the backend and shows the report in a dialog.
 * The command only reads: it never thins snapshots or deletes anything.
 */
import { api } from './api.js';
import { t } from './i18n.js';
import { notify } from './toast.js';

let report = '';

const element = (id) => document.getElementById(id);

function showStatus(text) {
  const status = element('disk-check-status');
  status.hidden = false;
  status.lastElementChild.textContent = text;
}

async function runDiskCheck() {
  const dialog = element('disk-check-dialog');
  const output = element('disk-check-output');
  const copy = element('disk-check-copy');
  report = '';
  output.hidden = true;
  output.textContent = '';
  copy.disabled = true;
  showStatus(t('Running disk-check --quick …'));
  if (!dialog.open) dialog.showModal();
  try {
    const result = await api('/api/disk-check', {});
    report = [result.output.trimEnd(), result.errors.trim()].filter(Boolean).join('\n\n');
    if (result.exit_code !== 0) report += `\n\n${t('disk-check exited with code {code}', { code: result.exit_code })}`;
    output.textContent = report || t('disk-check produced no output.');
    output.hidden = false;
    element('disk-check-status').hidden = true;
    copy.disabled = !report;
  } catch (error) {
    // The message names the missing command, a run in progress or the timeout.
    showStatus(error.message);
    element('disk-check-status').firstElementChild.hidden = true;
  }
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(report);
    notify(t('Report copied'));
  } catch {
    notify(t('The report could not be copied'));
  }
}

export function bindDiskCheck() {
  const dialog = element('disk-check-dialog');
  document.addEventListener('click', (event) => {
    if (event.target.closest('.disk-check-run')) {
      // The spinner is hidden after a failed run; show it again for the next one.
      element('disk-check-status').firstElementChild.hidden = false;
      runDiskCheck();
    }
    if (event.target.closest('.close-disk-check')) dialog.close();
  });
  element('disk-check-copy').addEventListener('click', copyReport);
}
