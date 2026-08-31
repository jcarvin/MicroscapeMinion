import { useState } from 'react';
import { formatItemId, formatNumber, formatSkillName } from '../../utils/format';
import GoalSourceSelector from '../GoalSourceSelector';
import GoalProgress from './GoalProgress';
import GoalRowControls from './GoalRowControls';
import {
  GoalLevelProjection,
  GoalPlanNote,
  GoalRow,
} from './GoalSection.styles';
import {
  displayItemName,
  effectiveSourceMode,
  hasAmbiguousSource,
  resolveGoalEta,
  sourceOptionsFor,
} from './goalUtils';

export default function GoalRowItem({
  row,
  rowIndex,
  status,
  item,
  planning,
  goalItems,
  draggedId,
  dragOverId,
  draggedIndex,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
  onSelect,
  onMaxToggle,
  onSourceChange,
  onTargetChange,
  onTargetBlur,
  onRemove,
}) {
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

  const [collapsed, setCollapsed] = useState(false);
  const hasCollapsibleContent = isValid || sourceOptions.length > 1 || Boolean(planningNote) || showXpProjection;

  const dropBefore = isDraggedOver && draggedIndex > rowIndex;
  const dropAfter = isDraggedOver && draggedIndex < rowIndex;
  const semanticClasses = [
    row.completed && 'is-completed',
    isCurrentActivityGoal && 'is-current-activity',
    isInfeasible && 'is-infeasible',
    dropBefore && 'drop-before',
    dropAfter && 'drop-after',
  ].filter(Boolean).join(' ') || undefined;

  return (
    <GoalRow
      className={semanticClasses}
      $isCompleted={row.completed}
      $isCurrent={isCurrentActivityGoal}
      $isInfeasible={isInfeasible}
      $isDragging={draggedId === row.id}
      $dropBefore={dropBefore}
      $dropAfter={dropAfter}
      data-goal-id={row.id}
      onDragEnter={onDragEnter}
      onDragOver={(event) => { event.preventDefault(); onDragEnter(); }}
      onDrop={onDrop}
    >
      <GoalRowControls
        row={row}
        item={item}
        goalItems={goalItems}
        sourceMode={sourceMode}
        ambiguousSource={ambiguousSource}
        collapsed={collapsed}
        hasCollapsibleContent={hasCollapsibleContent}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onSelect={onSelect}
        onMaxToggle={onMaxToggle}
        onTargetChange={onTargetChange}
        onTargetBlur={onTargetBlur}
        onRemove={onRemove}
        onToggleCollapse={() => setCollapsed(v => !v)}
      />

      {!collapsed && sourceOptions.length > 1 && (
        <GoalSourceSelector
          value={sourceMode}
          options={sourceOptions}
          onChange={onSourceChange}
        />
      )}

      {!collapsed && isValid && (
        <GoalProgress
          count={count}
          targetCount={targetCount}
          pct={pct}
          complete={complete}
          relatedToActivity={relatedToActivity}
          etaMs={etaMs}
          bankTrips={bankTrips}
          warmupRemainingMs={status?.warmupRemainingMs ?? 0}
          preliminaryEta={status?.preliminaryEta ?? null}
        />
      )}

      {!collapsed && planningNote && <GoalPlanNote>{planningNote}</GoalPlanNote>}

      {!collapsed && showXpProjection && (
        <GoalLevelProjection>
          {planning.expectedLevel !== null
            ? `Expected ${formatSkillName(planning.skill)} level: ${planning.expectedLevel} · `
            : `Projected ${formatSkillName(planning.skill)} XP: `}
          +{formatNumber(planning.xpGained)} XP
        </GoalLevelProjection>
      )}
    </GoalRow>
  );
}
