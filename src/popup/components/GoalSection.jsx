import { useState, useEffect, useRef } from 'react';
import { formatItemId } from '../utils/format';
import { setGoal, clearGoal } from '../utils/messages';
import ItemCombobox from './ItemCombobox';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

function resolveGoalEta(gs) {
  if (!gs) return { etaMs: null, bankTrips: 0 };
  if (gs.chanceBased) {
    return gs.eta?.totalMs > 0
      ? { etaMs: gs.eta.totalMs, bankTrips: gs.eta.bankTrips ?? 0 }
      : { etaMs: null, bankTrips: 0 };
  }
  if (gs.eta == null) return { etaMs: null, bankTrips: 0 };
  if (gs.eta === 0)   return { etaMs: 0,    bankTrips: 0 };
  return { etaMs: gs.eta.totalMs, bankTrips: gs.eta.bankTrips ?? 0 };
}

export default function GoalSection({ producibleItems, goalStatus }) {
  const [selectedId,    setSelectedId]    = useState(null);
  const [countValue,    setCountValue]    = useState('');
  const comboInputRef  = useRef(null);
  const prevItemIdsRef = useRef('');

  // Auto-select when exactly one producible item appears
  useEffect(() => {
    const newIds = producibleItems.map(i => i.id).join(',');
    if (newIds !== prevItemIdsRef.current && producibleItems.length === 1 && !selectedId) {
      setSelectedId(producibleItems[0].id);
    }
    prevItemIdsRef.current = newIds;
  }, [producibleItems, selectedId]);

  // Restore selectedId from an active saved goal
  useEffect(() => {
    if (goalStatus?.goal?.itemId && !selectedId) {
      setSelectedId(goalStatus.goal.itemId);
    }
  }, [goalStatus?.goal?.itemId, selectedId]);

  // Keep count input synced when the background confirms a new targetCount
  useEffect(() => {
    if (goalStatus?.goal?.targetCount != null) {
      setCountValue(String(goalStatus.goal.targetCount));
    }
  }, [goalStatus?.goal?.targetCount]);

  function handleSetGoal() {
    const itemId = selectedId;
    const itemName = itemId
      ? formatItemId(itemId)
      : (comboInputRef.current?.value.trim() ?? '');
    const targetCount = parseInt(countValue, 10);
    if (!itemName || !targetCount || targetCount < 1) return;
    setGoal({ itemName, itemId: itemId ?? null, targetCount });
  }

  function handleClearGoal() {
    clearGoal();
    setSelectedId(null);
    setCountValue('');
  }

  const { etaMs, bankTrips } = resolveGoalEta(goalStatus);
  const goalComplete = goalStatus
    ? (goalStatus.count ?? 0) >= goalStatus.goal.targetCount
    : false;
  const pct = goalStatus
    ? Math.min(100, (goalStatus.count / goalStatus.goal.targetCount) * 100)
    : 0;

  return (
    <section className="card">
      <div className="card-label">Goal Tracker</div>
      <div className="goal-form">
        <ItemCombobox
          items={producibleItems}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConfirm={handleSetGoal}
          inputRef={comboInputRef}
        />
        <input
          type="number"
          placeholder="Target"
          min="1"
          step="1"
          value={countValue}
          onChange={e => setCountValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSetGoal(); }}
        />
        <button onClick={handleSetGoal}>Set</button>
      </div>

      {goalStatus && (
        <div className="goal-status">
          <div className="progress-bar-wrap">
            <div className="progress-bar" style={{ width: `${pct}%` }}></div>
          </div>
          <div className="progress-label">
            <span>{goalStatus.count ?? 0} / {goalStatus.goal.targetCount}</span>
            <span className="eta-group">
              <EtaDisplay etaMs={etaMs} bankTrips={bankTrips} complete={goalComplete} />
              <EtaTooltip />
            </span>
          </div>
        </div>
      )}

      {goalStatus && (
        <button className="clear-btn" onClick={handleClearGoal}>Clear goal</button>
      )}
    </section>
  );
}
