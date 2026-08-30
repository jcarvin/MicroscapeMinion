import { useEffect, useRef, useState } from 'react';
import { setGoals } from '../../utils/messages';
import useDragReorder from '../../hooks/useDragReorder';
import {
  completeGoals,
  createRow,
  displayItemName,
  effectiveSourceMode,
  hasAcquisitionSource,
  hasAmbiguousSource,
  plansFromStatuses,
} from './goalUtils';
import { formatItemId } from '../../utils/format';

export default function useGoalRows(goalItems, goalStatuses) {
  const [rows, setRows] = useState([]);
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

  function addRow() {
    updateRows((current) => [createRow(), ...current]);
  }

  const drag = useDragReorder((fromId, toId) => {
    updateRows((current) => {
      const from = current.findIndex(({ id }) => id === fromId);
      const to = current.findIndex(({ id }) => id === toId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }, true);
  });

  return {
    rows,
    localPlans,
    drag,
    handleSelect,
    handleMaxToggle,
    handleSourceChange,
    handleTargetChange,
    persistCurrentRows,
    handleRemove,
    insertRowAt,
    addRow,
  };
}
