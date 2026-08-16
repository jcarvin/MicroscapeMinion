import { formatItemId } from '../utils/format';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

export default function CombatConsumableSection({ combatConsumables }) {
  if (!combatConsumables?.length) return null;

  return (
    <section className="card">
      <div className="card-label">Combat Consumables</div>
      {combatConsumables.map(item => (
        <div key={item.itemId} className="consumable-row">
          <span className="consumable-name">{formatItemId(item.itemId)}</span>
          <span className="consumable-right">
            <span className="consumable-count">{item.currentCount}</span>
            <span className="eta-group">
              <EtaDisplay etaMs={item.etaMs ?? null} />
              <EtaTooltip />
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
