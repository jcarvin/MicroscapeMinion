import { useRef, useState } from 'react';

export default function Header({
  connected,
  idle,
  notificationsEnabled,
  showDebug,
  onTestNotification,
  onToggleNotifications,
  onToggleDebug,
}) {
  let dotClass = 'dot';
  if (connected) dotClass += idle ? ' idle' : ' connected';

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
    <div className="header">
      <span className={dotClass} onClick={handleDotClick} style={{ cursor: 'pointer' }} />
      <span className="brand">Microscape Minion</span>
      {showDebug && (
        <button
          className="test-notif-btn"
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
        </button>
      )}
      <button
        className={`notif-toggle-btn${notificationsEnabled ? '' : ' notif-muted'}`}
        onClick={onToggleNotifications}
        title={notificationsEnabled ? 'Mute notifications' : 'Unmute notifications'}
        aria-label={notificationsEnabled ? 'Mute notifications' : 'Unmute notifications'}
        aria-pressed={!notificationsEnabled}
      >
        {notificationsEnabled ? '🔔' : '🔕'}
      </button>
    </div>
  );
}
