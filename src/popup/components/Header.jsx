import { useState } from 'react';
import styled from 'styled-components';
import useNthClick from '../hooks/useNthClick';
import useTransientLabel from '../hooks/useTransientLabel';

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px 9px;
  background: ${({ theme }) => theme.panel};
  border-bottom: 2px solid #64401f;
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
  box-shadow: 0 0 4px ${({ theme, $connected, $idle }) =>
    $connected ? ($idle ? theme.amber : theme.green) : 'transparent'};
`;

const Brand = styled.span`
  font-family: 'Pixelify Sans', monospace;
  font-size: 14px;
  font-weight: 700;
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
  box-shadow: none;
  &:hover { opacity: 1; filter: none; background: transparent; }
  &:active { transform: none; box-shadow: none; }
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
  const handleDotClick = useNthClick(3, onToggleDebug, 600);
  const [testLabel, flashTestLabel] = useTransientLabel('Test', 2000);
  const [sending, setSending] = useState(false);
  const [lastFailureReason, setLastFailureReason] = useState(null);

  async function handleTestNotification() {
    setSending(true);
    const result = await onTestNotification?.();
    setSending(false);
    flashTestLabel(result?.ok ? 'Sent' : 'Failed');
    setLastFailureReason(result?.ok ? null : (result?.reason ?? 'unknown error'));
  }

  const displayLabel = sending ? '…' : testLabel;
  const failureReason = !sending && testLabel === 'Failed' ? lastFailureReason : null;

  return (
    <StyledHeader>
      <Dot $connected={connected} $idle={idle} onClick={handleDotClick} />
      <Brand>Microscape Minion</Brand>
      {showDebug && (
        <TestNotifBtn
          onClick={handleTestNotification}
          disabled={!notificationsEnabled || sending}
          title={!notificationsEnabled
            ? 'Enable notifications to test'
            : failureReason
              ? `Notification failed: ${failureReason}`
              : 'Send test notification'}
          aria-label="Send test notification"
        >
          {displayLabel}
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
