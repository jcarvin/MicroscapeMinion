import { Fragment, useEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { formatDuration, formatItemId, formatNumber, formatSkillName } from '../utils/format';
import { setGoals } from '../utils/messages';
import { Card, CardLabel, EtaGroup, EtaLabel } from './Shared';
import ItemCombobox, { ComboWrap } from './ItemCombobox';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';
import GoalSourceSelector, { GOAL_SOURCE_OPTIONS, GoalSourceWrap } from './GoalSourceSelector';

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
    sourceMode: ['any', 'manual', 'craft', 'drops'].includes(goal?.sourceMode) ? goal.sourceMode : null,
    completed: goal?.completed === true,
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

function hasAcquisitionSource(item, source) {
  if (item?.acquisitionSources?.includes(source)) return true;
  if (source === 'craft') return item?.craftable === true;
  if (source === 'drops') return item?.chanceDrop === true;
  if (source === 'manual') return item?.manualActivity === true;
  return false;
}

function hasAmbiguousSource(item) {
  return hasAcquisitionSource(item, 'craft') && hasAcquisitionSource(item, 'drops');
}

function sourceOptionsFor(item, planning) {
  if (!item) return [];
  const specificIds = GOAL_SOURCE_OPTIONS
    .filter(({ id }) => id !== 'any')
    .filter(({ id }) => hasAcquisitionSource(item, id)
      || planning?.sourceOptions?.includes(id))
    .map(({ id }) => id);
  const anyAvailable = item.bazaarTradeable !== false || specificIds.length > 1;
  return GOAL_SOURCE_OPTIONS
    .filter(({ id }) => (id === 'any' && anyAvailable) || specificIds.includes(id))
    .map((option) => option.id === 'any' && item.bazaarTradeable === false
      ? {
          ...option,
          description: 'Use any available acquisition route. Materials and XP are not projected.',
        }
      : option);
}

function effectiveSourceMode(row, item) {
  if (row.maxCraftable) return row.sourceMode === 'manual' ? 'manual' : 'craft';
  if (['any', 'manual', 'craft', 'drops'].includes(row.sourceMode)) return row.sourceMode;
  if (hasAmbiguousSource(item)) return 'any';
  if (hasAcquisitionSource(item, 'craft')) return 'any';
  if (hasAcquisitionSource(item, 'drops')) {
    return hasAcquisitionSource(item, 'activity') ? 'any' : 'drops';
  }
  if (hasAcquisitionSource(item, 'manual')) return 'manual';
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
    const hasKnownSource = item?.craftable || item?.chanceDrop || item?.manualActivity
      || ['any', 'manual', 'craft', 'drops'].includes(row.sourceMode);
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

// ── Styled components ─────────────────────────────────────────────────────────

const goalDropPulse = keyframes`
  from { opacity: .55; transform: scaleX(.96); }
  to { opacity: 1; transform: scaleX(1); }
`;

const GoalPlanNote = styled.div`
  margin: 4px 24px 0 22px;
  color: ${({ theme }) => theme.muted};
  font-size: 10px;
`;

const GoalIconBtnBase = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  line-height: 1;
`;

const GoalDragBtn = styled(GoalIconBtnBase)`
  background: transparent;
  color: ${({ theme }) => theme.muted};
  width: 18px;
  cursor: grab;
  font-size: 10px;
  letter-spacing: 0;
  &:active { cursor: grabbing; }
  &:hover { color: ${({ theme }) => theme.text}; }
`;

const GoalTargetControl = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;

  input {
    width: 100%;
    border-radius: 0 ${({ theme }) => theme.radius} ${({ theme }) => theme.radius} 0;
  }

  input:first-child {
    border-radius: ${({ theme }) => theme.radius};
  }

  input[readonly] {
    color: ${({ theme }) => theme.muted};
    cursor: default;
  }
`;

const GoalRow = styled.div`
  position: relative;
  border-radius: ${({ theme }) => theme.radius};
  transition: background 140ms ease, box-shadow 140ms ease, opacity 140ms ease, transform 140ms ease;

  ${({ $isCurrent }) => $isCurrent && css`
    background: rgba(91, 141, 238, .06);
    box-shadow: 0 0 0 4px rgba(91, 141, 238, .06);
  `}

  ${({ $isInfeasible, theme }) => $isInfeasible && css`
    background: rgba(248, 113, 113, .08);
    box-shadow: 0 0 0 4px rgba(248, 113, 113, .08), 0 0 10px rgba(248, 113, 113, .12);
    ${GoalPlanNote} { color: ${theme.red}; }
  `}

  ${({ $isCompleted }) => $isCompleted && css`
    opacity: .45;
    ${GoalDragBtn}, ${ComboWrap}, ${GoalTargetControl}, ${GoalSourceWrap} {
      pointer-events: none;
    }
  `}

  ${({ $isDragging }) => $isDragging && css`
    opacity: .35;
    transform: scale(.985);
  `}

  ${({ $dropBefore, theme }) => $dropBefore && css`
    transform: translateY(2px);
    &::before {
      content: '';
      position: absolute;
      left: 0; right: 0; top: -6px;
      z-index: 2;
      height: 2px;
      border-radius: 2px;
      background: ${theme.accent};
      box-shadow: 0 0 0 1px rgba(91,141,238,.2), 0 0 7px rgba(91,141,238,.65);
      animation: ${goalDropPulse} 650ms ease-in-out infinite alternate;
      pointer-events: none;
    }
  `}

  ${({ $dropAfter, theme }) => $dropAfter && css`
    transform: translateY(-2px);
    &::after {
      content: '';
      position: absolute;
      left: 0; right: 0; bottom: -6px;
      z-index: 2;
      height: 2px;
      border-radius: 2px;
      background: ${theme.accent};
      box-shadow: 0 0 0 1px rgba(91,141,238,.2), 0 0 7px rgba(91,141,238,.65);
      animation: ${goalDropPulse} 650ms ease-in-out infinite alternate;
      pointer-events: none;
    }
  `}

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &::before, &::after { animation: none; }
  }
`;

const GoalRowDivider = styled.div`
  position: relative;
  height: 1px;
  background: ${({ theme }) => theme.border};
  transition: background 0.15s;
  &:hover { background: transparent; }
`;

const GoalInsertBtn = styled.button`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 50%;
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s;

  ${GoalRowDivider}:hover & {
    opacity: 1;
    color: ${({ theme }) => theme.accent};
    border-color: ${({ theme }) => theme.accent};
  }
`;

const GoalAddBtn = styled(GoalIconBtnBase)`
  font-size: 17px;
`;

const GoalRemoveBtn = styled(GoalIconBtnBase)`
  background: transparent;
  color: ${({ theme }) => theme.muted};
  font-size: 18px;
  &:hover { color: ${({ theme }) => theme.text}; }
`;

const GoalHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;

  ${CardLabel} { margin-bottom: 0; }
`;

const GoalList = styled.div`
  display: grid;
  gap: 9px;
`;

const GoalRowFields = styled.div`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 92px 20px;
  align-items: center;
  gap: 4px;
`;

const GoalMaxBtn = styled.button`
  align-self: stretch;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border};
  border-right: 0;
  border-radius: ${({ theme }) => theme.radius} 0 0 ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font-size: 9px;
  padding: 0 4px;

  &[aria-pressed="true"] {
    background: ${({ theme }) => theme.accent};
    border-color: ${({ theme }) => theme.accent};
    color: #fff;
  }
`;

const GoalStatus = styled.div`
  margin: 5px 24px 0 22px;
`;

const ProgressBarWrap = styled.div`
  height: 5px;
  background: ${({ theme }) => theme.border};
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: 5px;
`;

const ProgressBar = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.accent};
  border-radius: 99px;
  width: 0%;
  transition: width 0.4s;
`;

const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 11px;
  color: ${({ theme }) => theme.muted};
`;

const ProgressCounts = styled.span`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
`;

const ProgressDivider = styled.span`
  flex-shrink: 0;
  width: 1px;
  align-self: stretch;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    left: 0;
    top: 10%;
    bottom: 10%;
    width: 1px;
    background: ${({ theme }) => theme.border};
  }
`;

const GoalLevelProjection = styled.div`
  margin: 3px 24px 0 22px;
  color: ${({ theme }) => theme.muted};
  font-size: 10px;
`;

// ── Sub-components ────────────────────────────────────────────────────────────

function InsertDivider({ onInsert }) {
  return (
    <GoalRowDivider aria-hidden="true">
      <GoalInsertBtn
        type="button"
        aria-label="Insert goal here"
        title="Insert goal"
        onClick={onInsert}
      >
        +
      </GoalInsertBtn>
    </GoalRowDivider>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

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
      const completed = goal.completed === true;
      if (
        targetValue === row.targetValue
        && sourceMode === row.sourceMode
        && completed === row.completed
      ) return row;
      return { ...row, targetValue, sourceMode, completed };
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
                      ? (hasAcquisitionSource(item, 'activity') ? 'any' : 'drops')
                      : hasAcquisitionSource(item, 'manual')
                        ? 'manual'
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
    const item = goalItems.find(({ id }) => id === row.itemId);
    const sourceMode = effectiveSourceMode(row, item);
    if (!enabling && Number(row.targetValue) === 0) {
      persistedGoalsRef.current = persistedGoalsRef.current.filter((goal) => goal.id !== rowId);
    }
    updateRows((current) => current.map((candidate) => candidate.id === rowId
      ? {
          ...candidate,
          maxCraftable: enabling,
          sourceMode: enabling
            ? (sourceMode === 'manual' ? 'manual' : 'craft')
            : candidate.sourceMode,
          targetValue: enabling
            ? (candidate.targetValue === '' ? '0' : candidate.targetValue)
            : (Number(candidate.targetValue) === 0 ? '' : candidate.targetValue),
        }
      : candidate), true);
  }

  function handleSourceChange(rowId, sourceMode) {
    const row = rows.find((candidate) => candidate.id === rowId);
    if (!row || !['any', 'manual', 'craft', 'drops'].includes(sourceMode)) return;
    const item = goalItems.find(({ id }) => id === row.itemId);
    const supportsMax = sourceMode === 'craft'
      || (sourceMode === 'manual' && item?.manualHasInputs === true);
    const disablesMax = !supportsMax && row.maxCraftable;
    if (disablesMax && Number(row.targetValue) === 0) {
      persistedGoalsRef.current = persistedGoalsRef.current.filter((goal) => goal.id !== rowId);
    }
    updateRows((current) => current.map((candidate) => candidate.id === rowId
      ? {
          ...candidate,
          sourceMode,
          maxCraftable: supportsMax ? candidate.maxCraftable : false,
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
    <Card>
      <GoalHeading>
        <CardLabel>Goal Tracker</CardLabel>
        <GoalAddBtn
          type="button"
          aria-label="Add goal"
          title="Add goal"
          onClick={() => updateRows((current) => [createRow(), ...current])}
        >
          +
        </GoalAddBtn>
      </GoalHeading>

      <GoalList>
        {rows.map((row, rowIndex) => {
          const status = statusesById.get(row.id) ?? null;
          const item = goalItems.find(({ id }) => id === row.itemId);
          const planning = localPlans.get(row.id) ?? status?.planning ?? null;
          const sourceMode = effectiveSourceMode(row, item);
          const sourceOptions = sourceOptionsFor(item, planning);
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
          const showXpProjection = planning?.xpKnown === true
            && planning?.levelFeasible !== false
            && planning.xpGained > 0;
          const { etaMs, bankTrips } = resolveGoalEta(status);
          const isDraggedOver = dragOverId === row.id && draggedIndex !== rowIndex;

          const stateClasses = [
            row.completed && 'is-completed',
            isCurrentActivityGoal && 'is-current-activity',
            isInfeasible && 'is-infeasible',
            draggedId === row.id && 'is-dragging',
            (isDraggedOver && draggedIndex > rowIndex) && 'drop-before',
            (isDraggedOver && draggedIndex < rowIndex) && 'drop-after',
          ].filter(Boolean).join(' ');

          const goalRow = (
            <GoalRow
              $isCompleted={row.completed}
              $isCurrent={isCurrentActivityGoal}
              $isInfeasible={isInfeasible}
              $isDragging={draggedId === row.id}
              $dropBefore={isDraggedOver && draggedIndex > rowIndex}
              $dropAfter={isDraggedOver && draggedIndex < rowIndex}
              className={stateClasses || undefined}
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
              <GoalRowFields>
                <GoalDragBtn
                  type="button"
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
                </GoalDragBtn>
                <ItemCombobox
                  items={goalItems}
                  selectedId={row.itemId}
                  onSelect={(itemId) => handleSelect(row.id, itemId)}
                />
                <GoalTargetControl>
                  {((item?.craftable && (!ambiguousSource || sourceMode === 'craft'))
                    || (item?.manualHasInputs && sourceMode === 'manual')
                    || row.maxCraftable) && (
                    <GoalMaxBtn
                      type="button"
                      aria-label="Use maximum craftable target"
                      aria-pressed={row.maxCraftable}
                      title="Use maximum craftable target"
                      onClick={() => handleMaxToggle(row.id)}
                    >
                      Max
                    </GoalMaxBtn>
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
                </GoalTargetControl>
                <GoalRemoveBtn
                  type="button"
                  aria-label="Remove goal"
                  title="Remove goal"
                  onClick={() => handleRemove(row.id)}
                >
                  &times;
                </GoalRemoveBtn>
              </GoalRowFields>

              {sourceOptions.length > 1 && (
                <GoalSourceSelector
                  value={sourceMode}
                  options={sourceOptions}
                  onChange={(nextSourceMode) => handleSourceChange(row.id, nextSourceMode)}
                />
              )}

              {isValid && (
                <GoalStatus>
                  <ProgressBarWrap>
                    <ProgressBar className="progress-bar" style={{ width: `${pct}%` }} />
                  </ProgressBarWrap>
                  <ProgressLabel>
                    <ProgressCounts>
                      <span>{formatNumber(count)} / {formatNumber(targetCount)}</span>
                      {!complete && count < targetCount && (
                        <span>{formatNumber(targetCount - count)} remaining</span>
                      )}
                    </ProgressCounts>
                    {relatedToActivity && (
                      <>
                        <ProgressDivider aria-hidden="true" />
                        <EtaGroup>
                          <EtaDisplay
                            etaMs={etaMs}
                            bankTrips={bankTrips}
                            complete={complete}
                            warmupRemainingMs={status?.warmupRemainingMs ?? 0}
                          />
                          <EtaTooltip />
                        </EtaGroup>
                      </>
                    )}
                    {!relatedToActivity && !complete && status?.preliminaryEta != null
                      && status.preliminaryEta !== 0
                      && status.preliminaryEta?.totalMs > 0 && (
                      <>
                        <ProgressDivider aria-hidden="true" />
                        <EtaGroup>
                          <EtaLabel>
                            {`~${formatDuration(status.preliminaryEta.totalMs)}`}
                            {status.preliminaryEta.bankTrips > 0
                              ? ` (+${status.preliminaryEta.bankTrips} bank trip${status.preliminaryEta.bankTrips > 1 ? 's' : ''})`
                              : ''}
                          </EtaLabel>
                        </EtaGroup>
                      </>
                    )}
                  </ProgressLabel>
                </GoalStatus>
              )}
              {planningNote && <GoalPlanNote>{planningNote}</GoalPlanNote>}
              {showXpProjection && (
                <GoalLevelProjection>
                  {planning.expectedLevel !== null
                    ? `Expected ${formatSkillName(planning.skill)} level: ${planning.expectedLevel} · `
                    : `Projected ${formatSkillName(planning.skill)} XP: `}
                  +{formatNumber(planning.xpGained)} XP
                </GoalLevelProjection>
              )}
            </GoalRow>
          );
          return (
            <Fragment key={row.id}>
              {rowIndex > 0 && <InsertDivider onInsert={() => insertRowAt(rowIndex)} />}
              {goalRow}
            </Fragment>
          );

        })}
        {rows.length > 0 && <InsertDivider onInsert={() => insertRowAt(rows.length)} />}
      </GoalList>
    </Card>
  );
}
