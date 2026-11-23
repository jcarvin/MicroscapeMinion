import { Fragment, useState } from 'react';
import styled from 'styled-components';
import { formatDuration, formatItemId } from '../../utils/format';
import { CardLabel, SectionWrapper } from '../Shared';
import InsertDivider from './InsertDivider';
import GoalRowItem from './GoalRowItem';
import { GoalAddBtn, GoalHeading, GoalList, TotalEtaRow } from './GoalSection.styles';
import useGoalRows from './useGoalRows';
import { displayItemName, resolveGoalEta } from './goalUtils';
import SetQueueButton from '../setQueue/SetQueueButton';
import QueuePreviewDialog from '../setQueue/QueuePreviewDialog';
import BuildPlanDialog from './BuildPlanDialog';
import useActivityQueuePreview from '../../hooks/useActivityQueuePreview';
import useZonePreferenceWriter from '../../hooks/useZonePreferenceWriter';
import {
  buildDependencyTree,
  flattenTree,
  batchPlanForReceptacles,
  collectReceptacleWarnings,
} from '../../../build-plan.js';

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

export default function GoalSection({
  goalItems,
  goalStatuses,
  isMember,
  connected,
  gameQueue,
  activityDefs,
  liveActivityIds,
  skillByActivity,
  zoneDefinitions,
  learnedZonePreferences,
  currentZoneId,
  combatSkills,
  combatSkillPreference,
  playerCombatLevel,
  playerSkillLevels,
  ownedCounts,
}) {
  const {
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
    insertGoalsForPlan,
  } = useGoalRows(goalItems, goalStatuses);

  const [showDialog, setShowDialog] = useState(false);
  const [buildPlanRow, setBuildPlanRow] = useState(null);

  const writeZonePreference = useZonePreferenceWriter();

  const {
    steps,
    skippedGoals,
    unresolvedStepCount,
    waitingStepCount,
    canConfirm,
    autoStart,
    setAutoStart,
    setStepZone,
    setStepDropSource,
    setStepCombatSkill,
    confirm,
    cancelSubmit,
    resetOverrides,
    isSubmitting,
  } = useActivityQueuePreview({
    goalStatuses,
    activityDefs,
    skillByActivity,
    zoneDefinitions,
    learnedZonePreferences,
    currentZoneId,
    combatSkills,
    combatSkillPreference,
    playerCombatLevel,
  });

  function handleOpenDialog() {
    resetOverrides();
    setShowDialog(true);
  }

  function handleBuildPlan(row) {
    if (!activityDefs || !row.itemId) return;
    const targetCount = Number(row.targetValue) || 0;
    if (targetCount <= 0) return;
    setBuildPlanRow({ row, targetCount });
  }

  function handleSetPlanQueue(row, targetCount) {
    if (!activityDefs || !row.itemId) return;
    const tree = buildDependencyTree({
      itemId: row.itemId,
      quantity: targetCount,
      activityDefs,
      ownedCounts: ownedCounts ?? {},
      playerSkillLevels: playerSkillLevels ?? {},
      playerCombatLevel: playerCombatLevel ?? null,
      liveActivityIds: liveActivityIds ?? [],
    });
    const planSteps = flattenTree(tree);
    const batchedSteps = batchPlanForReceptacles(planSteps, activityDefs, ownedCounts ?? {});
    insertGoalsForPlan(row.id, batchedSteps);
    setBuildPlanRow(null);
    resetOverrides();
    setShowDialog(true);
  }

  const incompleteStatuses = (goalStatuses ?? []).filter((s) => !s.goal.completed);
  let totalEtaMs = 0;
  let hasPartialEta = false;
  for (const s of incompleteStatuses) {
    const ms = s.relatedToActivity
      ? resolveGoalEta(s).etaMs
      : (s.preliminaryEta?.totalMs ?? null);
    if (ms == null) { hasPartialEta = true; }
    else { totalEtaMs += ms; }
  }
  const showTotalEta = incompleteStatuses.length >= 2 && (totalEtaMs > 0 || hasPartialEta);

  const statusesById = new Map((goalStatuses ?? []).map((s) => [s.goal.id, s]));
  const draggedIndex = rows.findIndex(({ id }) => id === drag.draggedId);

  return (
    <SectionWrapper>
      <GoalHeading>
        <CardLabel>Goal Tracker</CardLabel>
        <HeaderRight>
          <SetQueueButton
            isMember={isMember}
            connected={connected}
            onClick={handleOpenDialog}
          />
          <GoalAddBtn
            type="button"
            aria-label="Add goal"
            title="Add goal"
            onClick={addRow}
          >
            +
          </GoalAddBtn>
        </HeaderRight>
      </GoalHeading>

      <GoalList>
        {rows.map((row, rowIndex) => {
          const status = statusesById.get(row.id) ?? null;
          const planning = localPlans.get(row.id) ?? status?.planning ?? null;
          const item = goalItems.find(({ id }) => id === row.itemId);

          return (
            <Fragment key={row.id}>
              {rowIndex > 0 && (
                <InsertDivider onInsert={() => insertRowAt(rowIndex)} />
              )}
              <GoalRowItem
                row={row}
                rowIndex={rowIndex}
                status={status}
                item={item}
                planning={planning}
                goalItems={goalItems}
                activityDefs={activityDefs}
                draggedId={drag.draggedId}
                dragOverId={drag.dragOverId}
                draggedIndex={draggedIndex}
                onDragStart={() => drag.startDrag(row.id)}
                onDragEnd={drag.endDrag}
                onDragEnter={() => drag.enterDrag(row.id)}
                onDrop={() => drag.drop(row.id)}
                onSelect={(itemId) => handleSelect(row.id, itemId)}
                onMaxToggle={() => handleMaxToggle(row.id)}
                onSourceChange={(mode) => handleSourceChange(row.id, mode)}
                onTargetChange={(value) => handleTargetChange(row.id, value)}
                onTargetBlur={persistCurrentRows}
                onRemove={() => handleRemove(row.id)}
                onBuildPlan={handleBuildPlan}
              />
            </Fragment>
          );
        })}
        {rows.length > 0 && (
          <InsertDivider onInsert={() => insertRowAt(rows.length)} />
        )}
      </GoalList>

      {showTotalEta && (
        <TotalEtaRow>
          Total: {totalEtaMs > 0 ? `~${formatDuration(totalEtaMs)}${hasPartialEta ? '+' : ''}` : '—'}
        </TotalEtaRow>
      )}

      {buildPlanRow && activityDefs && (() => {
        const { row, targetCount } = buildPlanRow;
        const tree = buildDependencyTree({
          itemId: row.itemId,
          quantity: targetCount,
          activityDefs,
          ownedCounts: ownedCounts ?? {},
          playerSkillLevels: playerSkillLevels ?? {},
          playerCombatLevel: playerCombatLevel ?? null,
          liveActivityIds: liveActivityIds ?? [],
        });
        const planSteps = flattenTree(tree);
        const receptacleWarnings = collectReceptacleWarnings(activityDefs, ownedCounts ?? {}, planSteps);
        const item = goalItems.find(({ id }) => id === row.itemId);
        const itemName = displayItemName(item) || (row.itemId ? formatItemId(row.itemId) : '');
        return (
          <BuildPlanDialog
            itemName={itemName}
            tree={tree}
            goalItems={goalItems}
            receptacleWarnings={receptacleWarnings}
            onSetQueue={() => handleSetPlanQueue(row, targetCount)}
            onClose={() => setBuildPlanRow(null)}
          />
        );
      })()}

      {showDialog && (
        <QueuePreviewDialog
          steps={steps}
          skippedGoals={skippedGoals}
          unresolvedStepCount={unresolvedStepCount}
          waitingStepCount={waitingStepCount}
          canConfirm={canConfirm}
          autoStart={autoStart}
          setAutoStart={setAutoStart}
          gameQueue={gameQueue}
          onSelectZone={setStepZone}
          writeZonePreference={writeZonePreference}
          onSelectDropSource={setStepDropSource}
          onSelectCombatSkill={setStepCombatSkill}
          playerCombatLevel={playerCombatLevel}
          playerSkillLevels={playerSkillLevels}
          isSubmitting={isSubmitting}
          onConfirm={async () => { const result = await confirm(); if (result?.ok !== false) setShowDialog(false); }}
          onCancel={() => { cancelSubmit(); setShowDialog(false); }}
          onClose={() => setShowDialog(false)}
        />
      )}
    </SectionWrapper>
  );
}
