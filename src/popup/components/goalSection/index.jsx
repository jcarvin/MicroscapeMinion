import { Fragment, useState } from 'react';
import styled from 'styled-components';
import { CardLabel, SectionWrapper } from '../Shared';
import InsertDivider from './InsertDivider';
import GoalRowItem from './GoalRowItem';
import { GoalAddBtn, GoalHeading, GoalList } from './GoalSection.styles';
import useGoalRows from './useGoalRows';
import SetQueueButton from '../setQueue/SetQueueButton';
import QueuePreviewDialog from '../setQueue/QueuePreviewDialog';
import useActivityQueuePreview from '../../hooks/useActivityQueuePreview';
import useZonePreferenceWriter from '../../hooks/useZonePreferenceWriter';

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
  skillByActivity,
  zoneDefinitions,
  learnedZonePreferences,
  currentZoneId,
  combatSkills,
  combatSkillPreference,
  playerCombatLevel,
  playerSkillLevels,
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
  } = useGoalRows(goalItems, goalStatuses);

  const [showDialog, setShowDialog] = useState(false);

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
              />
            </Fragment>
          );
        })}
        {rows.length > 0 && (
          <InsertDivider onInsert={() => insertRowAt(rows.length)} />
        )}
      </GoalList>

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
