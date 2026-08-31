import { useRef, useState } from 'react';
import styled from 'styled-components';
import {
  checkGoalNagsNow,
  sendTestNotification,
  setNotificationsEnabled,
} from './utils/messages';
import usePolledStatus from './hooks/usePolledStatus';
import Header from './components/Header';
import StatusSection from './components/StatusSection';
import GoalSection from './components/goalSection';
import MaterialSection from './components/MaterialSection';
import CombatConsumableSection from './components/CombatConsumableSection';
import SkillSection from './components/SkillSection';
import DebugSection from './components/debugSection';

const ScrollContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: overlay;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(49,93,32,.5);
    border-radius: 99px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: rgba(78,133,41,.7);
  }
`;

const SupportFooter = styled.div`
  display: flex;
  justify-content: center;
  padding: 6px 12px 8px;
  flex-shrink: 0;
  border-top: 1px solid ${({ theme }) => theme.border};
`;

const SupportLink = styled.a`
  font-size: 10px;
  color: ${({ theme }) => theme.gold};
  text-decoration: none;
  opacity: 0.7;
  transition: opacity 0.15s;
  &:hover { opacity: 1; }
`;

export default function App() {
  const status = usePolledStatus();
  const [showDebug, setShowDebug] = useState(false);
  const selectedSkillEtaRef = useRef(null);
  const [selectedSkillEta, setSelectedSkillEta] = useState(null);

  function handleSelectedEtaChange(eta) {
    if (eta?.targetLevel !== selectedSkillEtaRef.current?.targetLevel) {
      selectedSkillEtaRef.current = eta ?? null;
      setSelectedSkillEta(eta ?? null);
    }
  }

  return (
    <>
      <Header
        connected={status?.connected}
        idle={status?.idle}
        notificationsEnabled={status?.notificationsEnabled ?? true}
        showDebug={showDebug}
        onTestNotification={sendTestNotification}
        onToggleNotifications={() => {
          const next = !(status?.notificationsEnabled ?? true);
          setNotificationsEnabled(next);
        }}
        onToggleDebug={() => setShowDebug(v => !v)}
      />
      <ScrollContent>
        <StatusSection
          connected={status?.connected}
          idle={status?.idle}
          activity={status?.activity}
          tickMs={status?.tickMs}
        />
        <GoalSection
          goalItems={status?.goalItems ?? []}
          goalStatuses={status && status.goalsLoaded !== false ? status.goalStatuses : null}
        />
        <MaterialSection
          runoutStatus={status?.runoutStatus ?? null}
          selectedSkillEta={selectedSkillEta}
          xpPerCycle={status?.skillLevelStatus?.xpPerCycle ?? 0}
        />
        <CombatConsumableSection
          combatConsumables={status?.combatConsumables ?? []}
          consumableNotifyItems={status?.consumableNotifyItems ?? []}
        />
        <SkillSection
          skillLevelStatus={status?.skillLevelStatus ?? null}
          skillNotifyTarget={status?.skillNotifyTarget ?? null}
          onSelectedEtaChange={handleSelectedEtaChange}
        />
        {showDebug && (
          <DebugSection
            rawMe={status?.rawMe}
            tickLog={status?.tickLog ?? []}
            etaDebugLog={status?.etaDebugLog}
            etaDebugLogVersion={status?.etaDebugLogVersion}
            goalNagDebug={status?.goalNagDebug}
            onCheckGoalNags={checkGoalNagsNow}
          />
        )}
      </ScrollContent>
      <SupportFooter>
        <SupportLink
          href="https://ko-fi.com/facehair4000"
          target="_blank"
          rel="noopener noreferrer"
        >
          Support the dev ☕
        </SupportLink>
      </SupportFooter>
    </>
  );
}
