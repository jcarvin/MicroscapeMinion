import { Fragment } from 'react';
import { Card, CardLabel } from '../Shared';
import InsertDivider from './InsertDivider';
import GoalRowItem from './GoalRowItem';
import { GoalAddBtn, GoalHeading, GoalList } from './GoalSection.styles';
import useGoalRows from './useGoalRows';

export default function GoalSection({ goalItems, goalStatuses }) {
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

  const statusesById = new Map((goalStatuses ?? []).map((s) => [s.goal.id, s]));
  const draggedIndex = rows.findIndex(({ id }) => id === drag.draggedId);

  return (
    <Card>
      <GoalHeading>
        <CardLabel>Goal Tracker</CardLabel>
        <GoalAddBtn
          type="button"
          aria-label="Add goal"
          title="Add goal"
          onClick={addRow}
        >
          +
        </GoalAddBtn>
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
    </Card>
  );
}
