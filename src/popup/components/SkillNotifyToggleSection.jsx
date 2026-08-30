import styled from 'styled-components';
import { NotifyLabel, ToggleSwitch, ToggleTrack } from './Shared';

const SkillNotifyRow = styled.div`
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid ${({ theme }) => theme.border};
`;

export default function SkillNotifyToggleSection({ targetLevel, checked, onChange }) {
  return (
    <SkillNotifyRow>
      <NotifyLabel>
        <ToggleSwitch>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
          />
          <ToggleTrack />
        </ToggleSwitch>
        Notify when Lv {targetLevel} is reached
      </NotifyLabel>
    </SkillNotifyRow>
  );
}
