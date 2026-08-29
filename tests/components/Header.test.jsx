import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Header from '../../src/popup/components/Header';

describe('Header notifications', () => {
  it('only shows the test notification button in debug mode', () => {
    const { rerender } = render(
      <Header notificationsEnabled onToggleNotifications={vi.fn()} />
    );

    expect(screen.queryByRole('button', { name: 'Send test notification' })).not.toBeInTheDocument();

    rerender(
      <Header showDebug notificationsEnabled onToggleNotifications={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeInTheDocument();
  });

  it('sends a test notification from the header', async () => {
    const onTestNotification = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <Header
        showDebug
        notificationsEnabled
        onTestNotification={onTestNotification}
        onToggleNotifications={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));

    expect(onTestNotification).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send test notification' })).toHaveTextContent('Sent'));
  });

  it('disables the test button while notifications are muted', () => {
    render(
      <Header
        showDebug
        notificationsEnabled={false}
        onTestNotification={vi.fn()}
        onToggleNotifications={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled();
  });
});
