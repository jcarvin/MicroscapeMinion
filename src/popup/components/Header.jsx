import { useRef, useState } from 'react';
import styled from 'styled-components';

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px 9px;
  border-bottom: 1px solid ${({ theme }) => theme.border};
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $connected, $idle }) =>
    $connected ? ($idle ? theme.amber : theme.green) : theme.muted};
  flex-shrink: 0;
  transition: background 0.3s;
  cursor: pointer;
`;

const Brand = styled.span`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .03em;
  color: ${({ theme }) => theme.text};
  flex: 1;
`;

const BaseHeaderBtn = styled.button`
  background: transparent;
  border: none;
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px 3px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.15s;
  &:hover { opacity: 1; filter: none; }
`;

const NotifToggleBtn = styled(BaseHeaderBtn)`
  opacity: ${({ $muted }) => $muted ? 0.45 : 0.7};
`;

const TestNotifBtn = styled(BaseHeaderBtn)`
  font-size: 10px;
  padding-inline: 4px;
  &:hover:not(:disabled) { opacity: 1; filter: none; }
  &:disabled { cursor: default; opacity: 0.35; }
`;

export default function Header({
  connected,
  idle,
  notificationsEnabled,
  showDebug,
  onTestNotification,
  onToggleNotifications,
  onToggleDebug,
}) {
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);
  const testResetTimerRef = useRef(null);
  const [testState, setTestState] = useState('idle');
  const [testFailureReason, setTestFailureReason] = useState(null);

  function handleDotClick() {
    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      onToggleDebug?.();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 600);
    }
  }

  async function handleTestNotification() {
    clearTimeout(testResetTimerRef.current);
    setTestState('sending');
    setTestFailureReason(null);
    const result = await onTestNotification?.();
    setTestState(result?.ok ? 'sent' : 'failed');
    if (!result?.ok) setTestFailureReason(result?.reason ?? 'unknown error');
    testResetTimerRef.current = setTimeout(() => {
      setTestState('idle');
      setTestFailureReason(null);
    }, 2000);
  }

  const testLabel = testState === 'sending'
    ? '…'
    : testState === 'sent'
      ? 'Sent'
      : testState === 'failed'
        ? 'Failed'
        : 'Test';

  return (
    <StyledHeader>
      <Dot $connected={connected} $idle={idle} onClick={handleDotClick} />
      <Brand>Microscape Minion</Brand>
      {showDebug && (
        <TestNotifBtn
          onClick={handleTestNotification}
          disabled={!notificationsEnabled || testState === 'sending'}
          title={!notificationsEnabled
            ? 'Enable notifications to test'
            : testState === 'failed'
              ? `Notification failed: ${testFailureReason}`
              : 'Send test notification'}
          aria-label="Send test notification"
        >
          {testLabel}
        </TestNotifBtn>
      )}
      <NotifToggleBtn
        $muted={!notificationsEnabled}
        onClick={onToggleNotifications}
        title={notificationsEnabled ? 'Mute notifications' : 'Unmute notifications'}
        aria-label={notificationsEnabled ? 'Mute notifications' : 'Unmute notifications'}
        aria-pressed={!notificationsEnabled}
      >
        {notificationsEnabled ? '🔔' : '🔕'}
      </NotifToggleBtn>
    </StyledHeader>
  );
}
