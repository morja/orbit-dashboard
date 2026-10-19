/* Project freshness follows collector timestamps, not the last HTTP response. */
export function projectFreshness(data, now = Date.now()) {
  const checked = Date.parse(data?.projects_checked_at);
  const valid = Number.isFinite(checked);
  const foreground = data?.config?.projects_foreground_interval || 60;
  const background = data?.config?.projects_background_enabled ? data.config.intervals?.projects || 300 : foreground;
  // A scheduled background check can legitimately be older than three minutes.
  const staleAfter = Math.max(180, foreground, background) + 30;
  const age = valid ? Math.max(0, (now - checked) / 1000) : Infinity;
  return { checked: valid ? new Date(checked) : null, age, stale: age > staleAfter };
}
