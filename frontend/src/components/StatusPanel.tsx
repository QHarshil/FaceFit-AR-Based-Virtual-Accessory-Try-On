import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_VIEWS, type RecoveryEvent, type TryOnStatus } from '../tryon/status';

interface StatusPanelProps {
  status: TryOnStatus;
  onSend: (event: RecoveryEvent) => void;
  onPhoto: (photo: File) => void;
}

const TONE_CLASS = {
  progress: 'loading',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const;

/**
 * The try-on's status line and recovery buttons. Both live regions stay
 * mounted, since screen readers announce changes to a region they already
 * know about; errors go to the assertive one.
 */
function StatusPanel({ status, onSend, onPhoto }: StatusPanelProps) {
  const view = STATUS_VIEWS[status];
  const photoInput = useRef<HTMLInputElement | null>(null);
  const urgent = view.tone === 'error';

  return (
    <section className="status-indicator" aria-labelledby="try-on-status-title">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {urgent ? '' : view.announcement}
      </p>
      <p className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {urgent ? view.announcement : ''}
      </p>
      <div className={`status-message ${TONE_CLASS[view.tone]}`} data-status={status}>
        {view.tone === 'progress' && <span className="spinner" aria-hidden="true" />}
        <div className="status-text">
          <h2 id="try-on-status-title">{view.title}</h2>
          {view.detail && <p>{view.detail}</p>}
        </div>
      </div>
      <div className="status-actions">
        {view.actions.map((action) => {
          switch (action.kind) {
            case 'send':
              return (
                <button
                  key={action.label}
                  type="button"
                  className="back-button"
                  onClick={() => {
                    onSend(action.event);
                  }}
                >
                  {action.label}
                </button>
              );
            case 'home':
              return (
                <Link key={action.label} to="/" className="back-button">
                  {action.label}
                </Link>
              );
            case 'pickPhoto':
              return (
                <button
                  key={action.label}
                  type="button"
                  className="back-button"
                  onClick={() => photoInput.current?.click()}
                >
                  {action.label}
                </button>
              );
          }
        })}
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          aria-label="Photo of your face"
          onChange={(event) => {
            const photo = event.currentTarget.files?.[0];
            // Cleared so choosing the same file again fires another change.
            event.currentTarget.value = '';
            if (photo) onPhoto(photo);
          }}
        />
      </div>
    </section>
  );
}

export default StatusPanel;
