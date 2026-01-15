/**
 * Toast notification display for rule warnings and messages
 *
 * Notifications appear in the bottom-right corner and can be dismissed.
 * Auto-dismiss after a timeout for info notifications.
 */

import { useEffect, useCallback } from 'react';
import { useAppState } from '@/app/AppState';

const AUTO_DISMISS_MS = 5000;

export function Notifications() {
  const { state, dispatch } = useAppState();

  const handleDismiss = useCallback(
    (id: string) => {
      dispatch({ type: 'DISMISS_NOTIFICATION', id });
    },
    [dispatch]
  );

  // Auto-dismiss info notifications
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    for (const notification of state.ui.notifications) {
      if (notification.type === 'info') {
        const timer = setTimeout(() => {
          handleDismiss(notification.id);
        }, AUTO_DISMISS_MS);
        timers.push(timer);
      }
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [state.ui.notifications, handleDismiss]);

  if (state.ui.notifications.length === 0) return null;

  return (
    <div className="notifications-container">
      {state.ui.notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification notification-${notification.type}`}
        >
          <span className="notification-message">{notification.message}</span>
          <button
            className="notification-dismiss"
            onClick={() => handleDismiss(notification.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
