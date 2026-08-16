export default function StatusSection({ connected, idle, activity, tickMs }) {
  let badge, badgeClass, tickText;

  if (!connected) {
    badge = 'Not connected'; badgeClass = 'status-badge'; tickText = '';
  } else if (idle) {
    badge = 'IDLE'; badgeClass = 'status-badge idle'; tickText = '';
  } else if (activity) {
    badge = activity; badgeClass = 'status-badge active'; tickText = `${tickMs}ms tick`;
  } else {
    badge = 'Observing…'; badgeClass = 'status-badge'; tickText = '';
  }

  return (
    <section className="card">
      <div className="card-label">Status</div>
      <div className="status-row">
        <span className={badgeClass}>{badge}</span>
        <span className="tick-rate">{tickText}</span>
      </div>
    </section>
  );
}
