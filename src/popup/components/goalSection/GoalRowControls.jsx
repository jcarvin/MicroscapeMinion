import ItemCombobox from '../ItemCombobox';
import {
  GoalCollapseBtn,
  GoalDragBtn,
  GoalDragColumn,
  GoalMaxBtn,
  GoalRemoveBtn,
  GoalRowFields,
  GoalTargetControl,
} from './GoalSection.styles';

export default function GoalRowControls({
  row,
  item,
  goalItems,
  sourceMode,
  ambiguousSource,
  collapsed,
  hasCollapsibleContent,
  onDragStart,
  onDragEnd,
  onSelect,
  onMaxToggle,
  onTargetChange,
  onTargetBlur,
  onRemove,
  onToggleCollapse,
}) {
  const showMaxBtn = (
    (item?.craftable && (!ambiguousSource || sourceMode === 'craft'))
    || (item?.manualHasInputs && sourceMode === 'manual')
    || row.maxCraftable
  );

  return (
    <GoalRowFields>
      <GoalDragColumn>
        <GoalDragBtn
          type="button"
          draggable
          aria-label="Drag to reorder goal"
          title="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          ::
        </GoalDragBtn>
        {hasCollapsibleContent && (
          <GoalCollapseBtn
            type="button"
            $collapsed={collapsed}
            aria-label={collapsed ? 'Expand goal details' : 'Collapse goal details'}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={onToggleCollapse}
          >
            ▾
          </GoalCollapseBtn>
        )}
      </GoalDragColumn>
      <ItemCombobox
        items={goalItems}
        selectedId={row.itemId}
        onSelect={onSelect}
      />
      <GoalTargetControl>
        {showMaxBtn && (
          <GoalMaxBtn
            type="button"
            aria-label="Use maximum craftable target"
            aria-pressed={row.maxCraftable}
            title="Use maximum craftable target"
            onClick={onMaxToggle}
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
          onChange={(event) => onTargetChange(event.target.value)}
          onBlur={onTargetBlur}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </GoalTargetControl>
      <GoalRemoveBtn
        type="button"
        aria-label="Remove goal"
        title="Remove goal"
        onClick={onRemove}
      >
        &times;
      </GoalRemoveBtn>
    </GoalRowFields>
  );
}
