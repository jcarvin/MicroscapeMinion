import { useEffect, useRef, useState } from 'react';
import { formatItemId } from '../utils/format';
import { setGoals } from '../utils/messages';
import ItemCombobox from './ItemCombobox';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

let fallbackId = 0;

function createGoalId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `goal-${Date.now()}-${fallbackId}`;
}

function createRow(goal = null) {
  return {
    id: goal?.id ?? createGoalId(),
    itemId: goal?.itemId ?? goal?.itemName ?? null,
    itemName: goal?.itemName ?? '',
    targetValue: goal ? String(goal.targetCount) : '',
  };
}

function displayItemName(item) {
  if (!item) return '';
  return item.name && item.name !== item.id ? item.name : formatItemId(item.id);
}

function resolveGoalEta(status) {
  if (!status) return { etaMs: null, bankTrips: 0 };
  if (status.chanceBased) {
    return status.eta?.totalMs > 0
      ? { etaMs: status.eta.totalMs, bankTrips: status.eta.bankTrips ?? 0 }
      : { etaMs: null, bankTrips: 0 };
  }
  if (status.eta == null) return { etaMs: null, bankTrips: 0 };
  if (status.eta === 0) return { etaMs: 0, bankTrips: 0 };
  return { etaMs: status.eta.totalMs, bankTrips: status.eta.bankTrips ?? 0 };
}

function completeGoals(rows, items, persistedGoals = []) {
  const savedGoals = new Map(persistedGoals.map((goal) => [goal.id, goal]));
  return rows.flatMap((row) => {
    const targetCount = Number(row.targetValue);
    const item = items.find(({ id }) => id === row.itemId);
    const itemName = row.itemName || displayItemName(item)
      || (row.itemId ? formatItemId(row.itemId) : '');
    if (!row.itemId || !itemName || !Number.isInteger(targetCount) || targetCount < 1) {
      const savedGoal = savedGoals.get(row.id);
      return savedGoal ? [savedGoal] : [];
    }
    return [{ id: row.id, itemId: row.itemId, itemName, targetCount }];
  });
}

export default function GoalSection({ goalItems, goalStatuses }) {
  const [rows, setRows] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const hydratedRef = useRef(false);
  const persistedGoalsRef = useRef([]);

  useEffect(() => {
    if (goalStatuses === null || hydratedRef.current) return;
    hydratedRef.current = true;
    persistedGoalsRef.current = goalStatuses.map(({ goal }) => goal);
    setRows(goalStatuses.length > 0
      ? goalStatuses.map(({ goal }) => createRow(goal))
      : [createRow()]);
  }, [goalStatuses]);

  function persistGoals(nextRows) {
    const goals = completeGoals(nextRows, goalItems, persistedGoalsRef.current);
    persistedGoalsRef.current = goals;
    void setGoals(goals);
  }

  function updateRows(updater, persist = false) {
    setRows((current) => {
      const next = updater(current);
      if (persist) persistGoals(next);
      return next;
    });
  }

  function handleSelect(rowId, itemId) {
    const item = goalItems.find(({ id }) => id === itemId);
    updateRows(
      (current) => current.map((row) => row.id === rowId
        ? { ...row, itemId, itemName: displayItemName(item) || (itemId ? formatItemId(itemId) : '') }
        : row),
      true
    );
  }

  function handleTargetChange(rowId, targetValue) {
    updateRows((current) => current.map((row) => row.id === rowId
      ? { ...row, targetValue }
      : row));
  }

  function persistCurrentRows() {
    persistGoals(rows);
  }

  function handleRemove(rowId) {
    updateRows((current) => current.filter((row) => row.id !== rowId), true);
  }

  function handleDrop(overId) {
    if (!draggedId || draggedId === overId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    updateRows((current) => {
      const from = current.findIndex(({ id }) => id === draggedId);
      const to = current.findIndex(({ id }) => id === overId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }, true);
    setDraggedId(null);
    setDragOverId(null);
  }

  const statusesById = new Map((goalStatuses ?? []).map((status) => [status.goal.id, status]));
  const draggedIndex = rows.findIndex(({ id }) => id === draggedId);

  return (
    <section className="card">
      <div className="goal-heading">
        <div className="card-label">Goal Tracker</div>
        <button
          type="button"
          className="goal-add-btn"
          aria-label="Add goal"
          title="Add goal"
          onClick={() => updateRows((current) => [...current, createRow()])}
        >
          +
        </button>
      </div>

      <div className="goal-list">
        {rows.map((row, rowIndex) => {
          const status = statusesById.get(row.id) ?? null;
          const item = goalItems.find(({ id }) => id === row.itemId);
          const targetCount = Number(row.targetValue);
          const count = status?.count ?? item?.count ?? 0;
          const isValid = Boolean(row.itemId) && Number.isInteger(targetCount) && targetCount > 0;
          const complete = isValid && count >= targetCount;
          const pct = isValid ? Math.min(100, (count / targetCount) * 100) : 0;
          const relatedToActivity = status?.relatedToActivity ?? item?.relatedToActivity ?? false;
          const isCurrentActivityGoal = status?.relatedToActivity === true;
          const { etaMs, bankTrips } = resolveGoalEta(status);
          const dropPosition = dragOverId === row.id && draggedIndex !== rowIndex
            ? (draggedIndex < rowIndex ? ' drop-after' : ' drop-before')
            : '';

          return (
            <div
              className={`goal-row${isCurrentActivityGoal ? ' is-current-activity' : ''}${draggedId === row.id ? ' is-dragging' : ''}${dropPosition}`}
              data-goal-id={row.id}
              key={row.id}
              onDragEnter={() => {
                if (draggedId) setDragOverId(draggedId === row.id ? null : row.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedId) setDragOverId(draggedId === row.id ? null : row.id);
              }}
              onDrop={() => handleDrop(row.id)}
            >
              <div className="goal-row-fields">
                <button
                  type="button"
                  className="goal-drag-btn"
                  draggable
                  aria-label="Drag to reorder goal"
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', row.id);
                    setDraggedId(row.id);
                    setDragOverId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                >
                  ::
                </button>
                <ItemCombobox
                  items={goalItems}
                  selectedId={row.itemId}
                  onSelect={(itemId) => handleSelect(row.id, itemId)}
                />
                <input
                  type="number"
                  aria-label="Goal target"
                  placeholder="Target"
                  min="1"
                  step="1"
                  value={row.targetValue}
                  onChange={(event) => handleTargetChange(row.id, event.target.value)}
                  onBlur={persistCurrentRows}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  className="goal-remove-btn"
                  aria-label="Remove goal"
                  title="Remove goal"
                  onClick={() => handleRemove(row.id)}
                >
                  &times;
                </button>
              </div>

              {isValid && (
                <div className="goal-status">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="progress-label">
                    <span>{count} / {targetCount}</span>
                    {relatedToActivity && (
                      <span className="eta-group">
                        <EtaDisplay
                          etaMs={etaMs}
                          bankTrips={bankTrips}
                          complete={complete}
                          warmupRemainingMs={status?.warmupRemainingMs ?? 0}
                        />
                        <EtaTooltip />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
