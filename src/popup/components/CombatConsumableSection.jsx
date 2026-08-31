import styled from 'styled-components';
import { formatItemId } from '../utils/format';
import { setConsumableNotify, clearConsumableNotify } from '../utils/messages';
import { Card, CardLabel, EtaGroup, NotifyLabel, SectionWrapper, ToggleSwitch, ToggleTrack } from './Shared';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

const ConsumableItem = styled.div`
  & + & {
    border-top: 1px solid ${({ theme }) => theme.parchmentDark};
    margin-top: 4px;
    padding-top: 6px;
  }
`;

const ConsumableRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
`;

const ConsumableName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConsumableRight = styled.span`
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
`;

const ConsumableCount = styled.span`
  color: ${({ theme }) => theme.brown500};
  font-size: 11px;
  white-space: nowrap;
`;

const ConsumableNotifyRow = styled.div`
  margin-top: 4px;
`;

export default function CombatConsumableSection({ combatConsumables, consumableNotifyItems }) {
  if (!combatConsumables?.length) return null;

  const notifySet = new Set(consumableNotifyItems ?? []);

  return (
    <SectionWrapper>
      <CardLabel>Combat Consumables</CardLabel>
      <Card>
        {combatConsumables.map(item => (
          <ConsumableItem key={item.itemId}>
            <ConsumableRow>
              <ConsumableName>{formatItemId(item.itemId)}</ConsumableName>
              <ConsumableRight>
                <ConsumableCount>{item.currentCount}</ConsumableCount>
                <EtaGroup>
                  <EtaDisplay etaMs={item.etaMs ?? null} />
                  <EtaTooltip />
                </EtaGroup>
              </ConsumableRight>
            </ConsumableRow>
            <ConsumableNotifyRow>
              <NotifyLabel>
                <ToggleSwitch>
                  <input
                    type="checkbox"
                    checked={notifySet.has(item.itemId)}
                    onChange={e => {
                      if (e.target.checked) setConsumableNotify(item.itemId);
                      else clearConsumableNotify(item.itemId);
                    }}
                  />
                  <ToggleTrack />
                </ToggleSwitch>
                Notify when empty
              </NotifyLabel>
            </ConsumableNotifyRow>
          </ConsumableItem>
        ))}
      </Card>
    </SectionWrapper>
  );
}
