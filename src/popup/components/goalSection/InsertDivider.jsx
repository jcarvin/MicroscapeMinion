import { GoalRowDivider, GoalInsertBtn } from './GoalSection.styles';

export default function InsertDivider({ onInsert }) {
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
