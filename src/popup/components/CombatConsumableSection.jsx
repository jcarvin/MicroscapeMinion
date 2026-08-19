import { formatItemId } from '../utils/format';
import { setConsumableNotify, clearConsumableNotify } from '../utils/messages';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

export default function CombatConsumableSection({ combatConsumables, consumableNotifyItems }) {
  if (!combatConsumables?.length) return null;

  const notifySet = new Set(consumableNotifyItems ?? []);

  return (
    <section className="card">
      <div className="card-label">Combat Consumables</div>
      {combatConsumables.map(item => (
        <div key={item.itemId} className="consumable-item">
          <div className="consumable-row">
            <span className="consumable-name">{formatItemId(item.itemId)}</span>
            <span className="consumable-right">
              <span className="consumable-count">{item.currentCount}</span>
              <span className="eta-group">
                <EtaDisplay etaMs={item.etaMs ?? null} />
                <EtaTooltip />
              </span>
            </span>
          </div>
          <div className="consumable-notify-row">
            <label className="skill-notify-label">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notifySet.has(item.itemId)}
                  onChange={e => {
                    if (e.target.checked) setConsumableNotify(item.itemId);
                    else clearConsumableNotify(item.itemId);
                  }}
                />
                <span className="toggle-track"></span>
              </span>
              Notify when empty
            </label>
          </div>
        </div>
      ))}
    </section>
  );
}
