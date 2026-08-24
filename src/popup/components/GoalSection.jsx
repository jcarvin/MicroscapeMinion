import { Fragment, useEffect, useRef, useState } from 'react';
import { formatDuration, formatItemId, formatNumber, formatSkillName } from '../utils/format';
import { setGoals } from '../utils/messages';
import ItemCombobox from './ItemCombobox';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';
import GoalSourceSelector, { GOAL_SOURCE_OPTIONS } from './GoalSourceSelector';

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
    maxCraftable: goal?.maxCraftable === true,
    sourceMode: ['any', 'craft', 'drops'].includes(goal?.sourceMode) ? goal.sourceMode : null,
    completed: goal?.completed === true,
  };
}

function InsertDivider({ onInsert }) {
  return (
    <div className="goal-row-divider" aria-hidden="true">
      <button
        type="button"
        className="goal-insert-btn"
        aria-label="Insert goal here"
        title="Insert goal"
        onClick={onInsert}
      >
        +
      </button>
    </div>
  );
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

function hasAcquisitionSource(item, source) {
  if (item?.acquisitionSources?.includes(source)) return true;
  if (source === 'craft') return item?.craftable === true;
  if (source === 'drops') return item?.chanceDrop === true;
  return false;
}

function hasAmbiguousSource(item) {
  return hasAcquisitionSource(item, 'craft') && hasAcquisitionSource(item, 'drops');
}

function effectiveSourceMode(row, item) {
  if (row.maxCraftable) return 'craft';
  if (['any', 'craft', 'drops'].includes(row.sourceMode)) return row.sourceMode;
  if (hasAmbiguousSource(item)) return 'any';
  if (hasAcquisitionSource(item, 'craft')) return 'any';
  if (hasAcquisitionSource(item, 'drops')) return 'drops';
  return 'any';
}

function completeGoals(rows, items, persistedGoals = []) {
  const savedGoals = new Map(persistedGoals.map((goal) => [goal.id, goal]));
  return rows.flatMap((row) => {
    const targetCount = Number(row.targetValue);
    const maxCraftable = row.maxCraftable === true;
    const item = items.find(({ id }) => id === row.itemId);
    const sourceMode = effectiveSourceMode(row, item);
    const itemName = row.itemName || displayItemName(item)
      || (row.itemId ? formatItemId(row.itemId) : '');
    const minimumTarget = maxCraftable ? 0 : 1;
    if (!row.itemId || !itemName || !Number.isSafeInteger(targetCount) || targetCount < minimumTarget) {
      const savedGoal = savedGoals.get(row.id);
      return savedGoal ? [savedGoal] : [];
    }
    const hasKnownSource = item?.craftable || item?.chanceDrop;
    return [{
      id: row.id,
      itemId: row.itemId,
      itemName,
      targetCount,
      ...(maxCraftable ? { maxCraftable: true } : {}),
      ...(maxCraftable || hasKnownSource ? { sourceMode } : {}),
      ...(row.completed ? { completed: true } : {}),
    }];
  });
}

function plansFromStatuses(goalStatuses) {
  return new Map((goalStatuses ?? []).flatMap((status) =>
    status.planning ? [[status.goal.id, status.planning]] : []));
}

export default function GoalSection({ goalItems, goalStatuses }) {
  const [rows, setRows] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [localPlans, setLocalPlans] = useState(new Map());
  const hydratedRef = useRef(false);
  const persistedGoalsRef = useRef([]);
  const persistRequestRef = useRef(0);

  useEffect(() => {
    if (goalStatuses === null) return;
    const goals = goalStatuses.map(({ goal }) => goal);
    persistedGoalsRef.current = goals;
    setLocalPlans(plansFromStatuses(goalStatuses));
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      setRows(goalStatuses.length > 0
        ? goalStatuses.map(({ goal }) => createRow(goal))
        : [createRow()]);
      return;
    }
    const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
    setRows((current) => current.map((row) => {
      const goal = goalsById.get(row.id);
      if (!goal) return row;
      const sourceMode = goal.sourceMode ?? row.sourceMode;
      const targetValue = goal.maxCraftable && row.maxCraftable
        ? String(goal.targetCount)
        : row.targetValue;
      if (targetValue === row.targetValue && sourceMode === row.sourceMode) return row;
      return { ...row, targetValue, sourceMode };
    }));
  }, [goalStatuses]);

  async function persistGoals(nextRows) {
    const goals = completeGoals(nextRows, goalItems, persistedGoalsRef.current);
    persistedGoalsRef.current = goals;
    const requestId = ++persistRequestRef.current;
    const response = await setGoals(goals);
    if (requestId !== persistRequestRef.current || !response?.goals) return;
    persistedGoalsRef.current = response.goals;
    const goalsById = new Map(response.goals.map((goal) => [goal.id, goal]));
    setRows((current) => current.map((row) => {
      const goal = goalsById.get(row.id);
      if (!goal) return row;
      return {
        ...row,
        sourceMode: goal.sourceMode ?? row.sourceMode,
        targetValue: goal.maxCraftable && row.maxCraftable
          ? String(goal.targetCount)
          : row.targetValue,
      };
    }));
    setLocalPlans(plansFromStatuses(response.goalStatuses));
  }

  function updateRows(updater, persist = false) {
    setRows((current) => {
      const next = updater(current);
      if (persist) persistGoals(next);
      return next;
    });
  }

  function handleSelect(rowId, itemId) {
    const previousRow = rows.find((row) => row.id === rowId);
    if (previousRow?.completed) return;
    const item = goalItems.find(({ id }) => id === itemId);
    if (previousRow?.maxCraftable && !item?.craftable && Number(previousRow.targetValue) === 0) {
      persistedGoalsRef.current = persistedGoalsRef.current.filter((goal) => goal.id !== rowId);
    }
    updateRows(
      (current) => current.map((row) => row.id === rowId
        ? {
            ...row,
            itemId,
            itemName: displayItemName(item) || (itemId ? formatItemId(itemId) : ''),
            maxCraftable: row.maxCraftable && item?.craftable === true,
            sourceMode: row.itemId === itemId
              ? row.sourceMode
              : row.maxCraftable && item?.craftable === true
                ? 'craft'
                : hasAmbiguousSource(item)
                  ? 'any'
                  : hasAcquisitionSource(item, 'craft')
                    ? 'craft'
                    : hasAcquisitionSource(item, 'drops')
                      ? 'drops'
                      : null,
            targetValue: row.maxCraftable && !item?.craftable && Number(row.targetValue) === 0
              ? ''
              : row.targetValue,
          }
        : row),
      true
    );
  }

  function handleMaxToggle(rowId) {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row || row.completed) return;
    const enabling = !row.maxCraftable;
    if (!enabling && Number(row.targetValue) === 0) {
      persistedGoalsRef.current = persistedGoalsRef.current.filter((goal) => goal.id !== rowId);
    }
    updateRows((current) => current.map((candidate) => candidate.id === rowId
      ? {
          ...candidate,
          maxCraftable: enabling,
          sourceMode: 'craft',
          targetValue: enabling
            ? (candidate.targetValue === '' ? '0' : candidate.targetValue)
            : (Number(candidate.targetValue) === 0 ? '' : candidate.targetValue),
        }
      : candidate), true);
  }

  function handleSourceChange(rowId, sourceMode) {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row || !['any', 'craft', 'drops'].includes(sourceMode)) return;
    const disablesMax = sourceMode !== 'craft' && row.maxCraftable;
    if (disablesMax && Number(row.targetValue) === 0) {
      persistedGoalsRef.current = persistedGoalsRef.current.filter((goal) => goal.id !== rowId);
    }
    updateRows((current) => current.map((candidate) => candidate.id === rowId
      ? {
          ...candidate,
          sourceMode,
          maxCraftable: sourceMode === 'craft' ? candidate.maxCraftable : false,
          targetValue: disablesMax && Number(candidate.targetValue) === 0
            ? ''
            : candidate.targetValue,
        }
      : candidate), true);
  }

  function handleTargetChange(rowId, targetValue) {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (row?.completed) return;
    updateRows((current) => current.map((r) => r.id === rowId
      ? { ...r, targetValue }
      : r));
  }

  function persistCurrentRows() {
    persistGoals(rows);
  }

  function handleRemove(rowId) {
    updateRows((current) => current.filter((row) => row.id !== rowId), true);
  }

  function insertRowAt(index) {
    updateRows((current) => {
      const next = [...current];
      next.splice(index, 0, createRow());
      return next;
    });
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
          onClick={() => updateRows((current) => [createRow(), ...current])}
        >
          +
        </button>
      </div>

      <div className="goal-list">
        {rows.map((row, rowIndex) => {
          const status = statusesById.get(row.id) ?? null;
          const item = goalItems.find(({ id }) => id === row.itemId);
          const planning = localPlans.get(row.id) ?? status?.planning ?? null;
          const sourceMode = effectiveSourceMode(row, item);
          const ambiguousSource = hasAmbiguousSource(item);
          const targetCount = Number(row.targetValue);
          const count = status?.count ?? item?.count ?? 0;
          const isValid = Boolean(row.itemId) && Number.isInteger(targetCount) && targetCount > 0;
          const complete = isValid && count >= targetCount;
          const pct = isValid ? Math.min(100, (count / targetCount) * 100) : 0;
          const relatedToActivity = status?.relatedToActivity ?? item?.relatedToActivity ?? false;
          const isCurrentActivityGoal = status?.relatedToActivity === true;
          const isInfeasible = planning?.pending !== true && planning?.feasible === false;
          const limitingNames = (planning?.limitingItemIds ?? []).map((itemId) => {
            const limitingItem = goalItems.find((candidate) => candidate.id === itemId);
            return displayItemName(limitingItem) || formatItemId(itemId);
          });
          const limitation = limitingNames.length > 0
            ? `limited by ${limitingNames.join(', ')}`
            : '';
          const planningWarnings = [];
          if (planning?.levelFeasible === false) {
            planningWarnings.push(
              `Requires ${formatSkillName(planning.skill)} Lv ${planning.requiredLevel}`
                + ` · projected Lv ${planning.projectedLevelBefore}`
            );
          } else if (planning?.materialFeasible === false) {
            planningWarnings.push(row.maxCraftable
              ? `Can't craft${limitation ? ` · ${limitation}` : ''}`
              : `Only ${planning.achievableTarget} achievable${limitation ? ` · ${limitation}` : ''}`);
          } else if (
            isInfeasible
            && planning?.levelFeasible !== false
            && planning?.materialFeasible === undefined
          ) {
            planningWarnings.push(row.maxCraftable
              ? `Can't craft${limitation ? ` · ${limitation}` : ''}`
              : `Only ${planning.achievableTarget} achievable${limitation ? ` · ${limitation}` : ''}`);
          }
          const planningNote = planningWarnings.length > 0
            ? planningWarnings.join(' · ')
            : planning?.chanceBased === true
              ? 'Chance-based drop · XP not projected'
              : planning?.sourceType === 'any'
                ? 'Multiple sources · materials and XP not projected'
              : (row.maxCraftable && limitation ? `Limited by ${limitingNames.join(', ')}` : null);
          const showLevelProjection = planning?.xpKnown === true
            && planning?.feasible === true
            && planning.expectedLevel !== null;
          const { etaMs, bankTrips } = resolveGoalEta(status);
          const dropPosition = dragOverId === row.id && draggedIndex !== rowIndex
            ? (draggedIndex < rowIndex ? ' drop-after' : ' drop-before')
            : '';

          const goalRow = (
            <div
              className={`goal-row${row.completed ? ' is-completed' : ''}${isCurrentActivityGoal ? ' is-current-activity' : ''}${isInfeasible ? ' is-infeasible' : ''}${draggedId === row.id ? ' is-dragging' : ''}${dropPosition}`}
              data-goal-id={row.id}
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
                <div className="goal-target-control">
                  {((item?.craftable && (!ambiguousSource || sourceMode === 'craft'))
                    || row.maxCraftable) && (
                    <button
                      type="button"
                      className="goal-max-btn"
                      aria-label="Use maximum craftable target"
                      aria-pressed={row.maxCraftable}
                      title="Use maximum craftable target"
                      onClick={() => handleMaxToggle(row.id)}
                    >
                      Max
                    </button>
                  )}
                  <input
                    type="number"
                    aria-label="Goal target"
                    placeholder="Target"
                    min={row.maxCraftable ? '0' : '1'}
                    step="1"
                    value={row.targetValue}
                    readOnly={row.maxCraftable || row.completed}
                    onChange={(event) => handleTargetChange(row.id, event.target.value)}
                    onBlur={persistCurrentRows}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </div>
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

              {item && (item.craftable || item.chanceDrop) && !row.maxCraftable && (
                <GoalSourceSelector
                  value={sourceMode}
                  options={
                    ambiguousSource
                      ? GOAL_SOURCE_OPTIONS
                      : item.craftable
                        ? GOAL_SOURCE_OPTIONS.filter((o) => o.id !== 'drops')
                        : GOAL_SOURCE_OPTIONS.filter((o) => o.id !== 'craft')
                  }
                  onChange={(nextSourceMode) => handleSourceChange(row.id, nextSourceMode)}
                />
              )}

              {isValid && (
                <div className="goal-status">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="progress-label">
                    <span className="progress-counts">
                      <span>{formatNumber(count)} / {formatNumber(targetCount)}</span>
                      {!complete && count < targetCount && (
                        <span className="remaining-count">{formatNumber(targetCount - count)} remaining</span>
                      )}
                    </span>
                    {relatedToActivity && (
                      <>
                        <span className="progress-divider" aria-hidden="true" />
                        <span className="eta-group">
                          <EtaDisplay
                            etaMs={etaMs}
                            bankTrips={bankTrips}
                            complete={complete}
                            warmupRemainingMs={status?.warmupRemainingMs ?? 0}
                          />
                          <EtaTooltip />
                        </span>
                      </>
                    )}
                    {!relatedToActivity && !complete && status?.preliminaryEta != null
                      && status.preliminaryEta !== 0
                      && status.preliminaryEta?.totalMs > 0 && (
                      <>
                        <span className="progress-divider" aria-hidden="true" />
                        <span className="eta-group">
                          <span className="eta-label">
                            {`~${formatDuration(status.preliminaryEta.totalMs)}`}
                            {status.preliminaryEta.bankTrips > 0
                              ? ` (+${status.preliminaryEta.bankTrips} bank trip${status.preliminaryEta.bankTrips > 1 ? 's' : ''})`
                              : ''}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {planningNote && <div className="goal-plan-note">{planningNote}</div>}
              {showLevelProjection && (
                <div className="goal-level-projection">
                  Expected {formatSkillName(planning.skill)} level: {planning.expectedLevel}
                  {' · '}+{formatNumber(planning.xpGained)} XP
                </div>
              )}
            </div>
          );
          return (
            <Fragment key={row.id}>
              {rowIndex > 0 && <InsertDivider onInsert={() => insertRowAt(rowIndex)} />}
              {goalRow}
            </Fragment>
          );

        })}
        {rows.length > 0 && <InsertDivider onInsert={() => insertRowAt(rows.length)} />}
      </div>
    </section>
  );
}
