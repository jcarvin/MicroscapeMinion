import styled from 'styled-components';
import QueueStepRow from './QueueStepRow';

const Wrap = styled.div`
  max-height: 200px;
  overflow-y: auto;
  margin: 4px 0;
`;

const Header = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 6px;
  padding-bottom: 3px;
  border-bottom: 1px solid ${({ theme }) => theme.border};
  font-size: 10px;
  color: ${({ theme }) => theme.brown500};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const EmptyNote = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.brown500};
  font-style: italic;
  padding: 8px 0;
`;

export default function QueueStepList({
  steps,
  onSelectZone,
  writeZonePreference,
  onSelectDropSource,
  onSelectCombatSkill,
  playerCombatLevel,
  playerSkillLevels,
}) {
  if (!steps || steps.length === 0) {
    return <EmptyNote>No queueable goals found.</EmptyNote>;
  }
  return (
    <>
      <Header>
        <span>Goal</span>
        <span>Location</span>
        <span>Until</span>
      </Header>
      <Wrap>
        {steps.map((step, index) => (
          <QueueStepRow
            key={step.goal?.id ?? index}
            step={step}
            stepIndex={index}
            onSelectZone={onSelectZone}
            writeZonePreference={writeZonePreference}
            onSelectDropSource={onSelectDropSource}
            onSelectCombatSkill={onSelectCombatSkill}
            playerCombatLevel={playerCombatLevel}
            playerSkillLevels={playerSkillLevels ?? {}}
          />
        ))}
      </Wrap>
    </>
  );
}
