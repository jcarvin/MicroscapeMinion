export const ETA_INFO_TITLE =
  'Estimates are based on average tick rate which is variable depending on latency. They may not be totally accurate.';

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatItemId(id) {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

export function formatSkillName(skill) {
  return String(skill ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
}

export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString();
}

export function fmtHMS(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatTickEntry(e) {
  const t = fmtHMS(e.at);
  if (e.type !== 'tick') return `${t}  ── ${e.type.toUpperCase()} ──`;

  const ph  = (e.phase ?? '?').padEnd(8);
  const cy  = e.cyclesLeft != null   ? `cy=${String(e.cyclesLeft).padStart(3)}`   : 'cy=  ?';
  const rm  = e.actRemaining != null ? `rm=${String(e.actRemaining).padStart(2)}` : 'rm= ?';
  const ln  = e.actLength != null    ? `ln=${String(e.actLength).padStart(2)}`    : 'ln= ?';
  const oh  = `oh=${e.overheadTicks ?? '?'}`;
  const lb  = e.lootBagItems != null ? `lb=${e.lootBagItems}/${e.bankTriggerItemCount ?? '?'}` : 'lb=?';
  const gen = e.itemsGenerated != null ? `gen=${String(e.itemsGenerated).padStart(3)}` : 'gen=  ?';
  const bt  = e.bankTrips != null    ? `bt=${String(e.bankTrips).padStart(2)}`    : 'bt= ?';
  const sm  = e.cycleSamples != null ? `sm=${String(e.cycleSamples).padStart(2)}` : 'sm= ?';
  const pg  = e.cycleProgressMs != null ? `pg=${(e.cycleProgressMs / 1000).toFixed(0)}s` : 'pg=?';
  const cal = e.calibrated ? 'cal=Y' : 'cal=N';
  const rd  = e.rawDuration != null  ? `rd=${e.rawDuration}`                      : 'rd=?';
  const dd  = e.defDurMs != null     ? `dd=${(e.defDurMs / 1000).toFixed(0)}s`   : 'dd=?';
  const cd  = e.cycleDurMs != null   ? `cd=${(e.cycleDurMs / 1000).toFixed(0)}s` : 'cd=?';
  const od  = e.observedCycleDurMs != null ? `od=${(e.observedCycleDurMs / 1000).toFixed(0)}s` : 'od=?';
  const goal = e.goalEtaMs != null   ? `goal=${(e.goalEtaMs / 1000).toFixed(0)}s` : 'goal=?';
  const gbt = e.goalBankTrips != null ? `gbt=${e.goalBankTrips}`                  : 'gbt=?';
  const pre  = e.pre != null         ? `${(e.pre / 1000).toFixed(0)}s`            : '   ?';
  const post = e.etaMs != null       ? `${(e.etaMs / 1000).toFixed(0)}s`          : '   ?';
  const d    = e.deltaMs != null
    ? (e.deltaMs >= 0 ? `+${(e.deltaMs / 1000).toFixed(1)}` : `${(e.deltaMs / 1000).toFixed(1)}`)
    : '?';
  return `${t}  ${ph}  ${cy}  ${rm}  ${ln}  ${oh}  ${lb}  ${gen}  ${bt}  ${sm}  ${cal}  ${pg}  ${rd}  ${dd}  ${cd}  ${od}  ${goal}  ${gbt}  ${pre}→${post}  Δ${d}s`;
}
