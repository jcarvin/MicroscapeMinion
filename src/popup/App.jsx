import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import {
  checkGoalNagsNow,
  getStatus,
  sendTestNotification,
  setNotificationsEnabled,
} from './utils/messages';
import Header from './components/Header';
import StatusSection from './components/StatusSection';
import GoalSection from './components/GoalSection';
import MaterialSection from './components/MaterialSection';
import CombatConsumableSection from './components/CombatConsumableSection';
import SkillSection from './components/SkillSection';
import DebugSection from './components/DebugSection';

const ScrollContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const SupportFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 6px 12px 8px;
  flex-shrink: 0;
`;

const SupportLink = styled.a`
  font-size: 10px;
  color: ${({ theme }) => theme.muted};
  text-decoration: none;
  opacity: 0.55;
  transition: opacity 0.15s, color 0.15s;
  &:hover {
    color: ${({ theme }) => theme.text};
    opacity: 1;
  }
`;

export default function App() {
  const [status, setStatus] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const selectedSkillEtaRef = useRef(null);
  const [selectedSkillEta, setSelectedSkillEta] = useState(null);

  function handleSelectedEtaChange(eta) {
    if (eta?.targetLevel !== selectedSkillEtaRef.current?.targetLevel) {
      selectedSkillEtaRef.current = eta ?? null;
      setSelectedSkillEta(eta ?? null);
    }
  }

  useEffect(() => {
    function poll() {
      getStatus().then(s => { if (s) setStatus(s); });
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

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
