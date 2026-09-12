import { createPortal } from 'react-dom';
import styled from 'styled-components';
import useModalDismiss from '../../hooks/useModalDismiss';
import QueueStepList from './QueueStepList';
import QueueReplacementNotice from './QueueReplacementNotice';
import QueueFallbackWarning from './QueueFallbackWarning';
import QueueSkippedGoalList from './QueueSkippedGoalList';
import QueueAutoStartToggle from './QueueAutoStartToggle';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.parchmentLight};
  border: 3px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: 3px 3px 0 rgba(0,0,0,0.4);
  padding: 14px 16px;
  width: 310px;
  max-height: 520px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
`;

const DialogTitle = styled.h2`
  font-size: 13px;
  font-weight: bold;
  color: ${({ theme }) => theme.brown900};
  margin: 0;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid ${({ theme }) => theme.border};
  flex-shrink: 0;
`;

const FooterNote = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.amber};
`;

const ConfirmBtn = styled.button`
  padding: 4px 12px;
  font-size: 12px;
  background: ${({ theme }) => theme.accent};
  border: 2px solid #1d4316;
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.text};
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.1);
  &:hover { background: #3d6e1c; }
  &:active { transform: translateY(1px); box-shadow: none; }
  &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
`;

const CancelBtn = styled.button`
  padding: 4px 10px;
  font-size: 12px;
  background: ${({ theme }) => theme.parchment};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown900};
  &:hover { background: ${({ theme }) => theme.parchmentDark}; }
  &:active { transform: translateY(1px); box-shadow: none; }
`;

const LoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: ${({ theme }) => theme.parchmentLight};
  border-radius: calc(${({ theme }) => theme.radius} - 2px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  z-index: 1;
`;

const LoadingMessage = styled.p`
  font-size: 12px;
  font-weight: bold;
  color: ${({ theme }) => theme.brown900};
  margin: 0;
  text-align: center;
`;

const LoadingSubtext = styled.p`
  font-size: 11px;
  color: ${({ theme }) => theme.amber};
  margin: 0;
  text-align: center;
`;

export default function QueuePreviewDialog({
  steps,
  skippedGoals,
  unresolvedStepCount,
  waitingStepCount,
  canConfirm,
  autoStart,
  setAutoStart,
  gameQueue,
  onSelectZone,
  writeZonePreference,
  onSelectDropSource,
  onSelectCombatSkill,
  playerCombatLevel,
  playerSkillLevels,
  isSubmitting,
  onConfirm,
  onCancel,
  onClose,
}) {
  useModalDismiss(onClose);

  return createPortal(
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Dialog role="dialog" aria-modal="true" aria-label="Set Queue" style={{ position: 'relative' }}>
        {isSubmitting && (
          <LoadingOverlay>
            <LoadingMessage>Updating the queue...</LoadingMessage>
            <LoadingSubtext>This may take a moment</LoadingSubtext>
            <div style={{ display: 'flex', gap: 8 }}>
              <CancelBtn type="button" onClick={onCancel}>Cancel</CancelBtn>
              <CancelBtn type="button" onClick={onClose}>Continue in background</CancelBtn>
            </div>
          </LoadingOverlay>
        )}
        <DialogTitle>Set Activity Queue</DialogTitle>

        <QueueReplacementNotice
          existingStepCount={gameQueue?.steps?.length ?? 0}
          isRunning={gameQueue?.running ?? false}
        />
        {steps.length > 0 && <QueueFallbackWarning hasFallback={gameQueue?.hasFallback ?? false} />}

        <QueueStepList
          steps={steps}
          onSelectZone={onSelectZone}
          writeZonePreference={writeZonePreference}
          onSelectDropSource={onSelectDropSource}
          onSelectCombatSkill={onSelectCombatSkill}
          playerCombatLevel={playerCombatLevel}
          playerSkillLevels={playerSkillLevels}
        />

        <QueueSkippedGoalList skippedGoals={skippedGoals} />

        <Footer>
          <QueueAutoStartToggle autoStart={autoStart} onChange={setAutoStart} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {waitingStepCount > 0 && unresolvedStepCount === 0 && (
              <FooterNote>Waiting for zone data</FooterNote>
            )}
            {unresolvedStepCount > 0 && (
              <FooterNote>
                {unresolvedStepCount} location{unresolvedStepCount !== 1 ? 's' : ''} needed
              </FooterNote>
            )}
            <CancelBtn type="button" onClick={onClose}>Cancel</CancelBtn>
            <ConfirmBtn type="button" disabled={!canConfirm} onClick={onConfirm}>
              Confirm
            </ConfirmBtn>
          </div>
        </Footer>
      </Dialog>
    </Overlay>,
    document.body
  );
}
