import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { STATUS_VIEWS, TRY_ON_STATUSES, type TryOnStatus } from '../../tryon/status';
import StatusPanel from '../StatusPanel';

const renderPanel = (status: TryOnStatus) => {
  const onSend = vi.fn();
  const onPhoto = vi.fn();
  const view = render(
    <MemoryRouter>
      <StatusPanel status={status} onSend={onSend} onPhoto={onPhoto} />
    </MemoryRouter>,
  );
  return { ...view, onSend, onPhoto };
};

describe('StatusPanel', () => {
  it.each(TRY_ON_STATUSES)(
    'shows %s with its announcement and recovery actions',
    async (status) => {
      const expected = STATUS_VIEWS[status];
      const { onSend } = renderPanel(status);

      expect(screen.getByRole('heading', { name: expected.title })).toBeInTheDocument();
      if (expected.detail) expect(screen.getByText(expected.detail)).toBeInTheDocument();

      const live = screen.getByRole(expected.tone === 'error' ? 'alert' : 'status');
      expect(live).toHaveTextContent(expected.announcement);
      expect(live).toHaveAttribute('aria-live', expected.tone === 'error' ? 'assertive' : 'polite');

      expect(expected.actions.length).toBeGreaterThan(0);
      for (const action of expected.actions) {
        if (action.kind === 'home') {
          expect(screen.getByRole('link', { name: action.label })).toHaveAttribute('href', '/');
          continue;
        }
        const button = screen.getByRole('button', { name: action.label });
        if (action.kind === 'send') {
          await userEvent.click(button);
          expect(onSend).toHaveBeenLastCalledWith(action.event);
        }
      }
    },
  );

  // Literal copy, so a change to STATUS_VIEWS cannot pass by changing both sides.
  it.each([
    {
      status: 'cameraDenied',
      region: 'alert',
      title: 'Camera access is blocked',
      announcement:
        'Camera access is blocked. Allow the camera in your browser settings for this site, then try again.',
      buttons: [
        ['Try again', 'RETRY_CAMERA'],
        ['Use a photo', 'USE_PHOTO'],
      ],
    },
    {
      status: 'productUnavailable',
      region: 'alert',
      title: 'Could not load this frame',
      announcement: 'Could not load this frame. Check your connection and try again.',
      buttons: [['Try again', 'RETRY_PRODUCT']],
    },
    {
      status: 'modelFetchFailed',
      region: 'alert',
      title: 'Could not download the face tracking model',
      announcement:
        'Could not download the face tracking model. Check your connection and try again.',
      buttons: [['Try again', 'RETRY_PERCEPTION']],
    },
    {
      status: 'contextLost',
      region: 'status',
      title: 'Graphics were interrupted',
      announcement: 'Graphics were interrupted. Restoring the view.',
      buttons: [['Reload the view', 'RETRY_OVERLAY']],
    },
    {
      status: 'glassesFailed',
      region: 'alert',
      title: 'Could not load the 3D frame',
      announcement: 'Could not load the 3D frame. Check your connection and try again.',
      buttons: [['Try again', 'RETRY_OVERLAY']],
    },
  ] as const)(
    'shows the $status copy, announcement and recovery',
    async ({ status, region, title, announcement, buttons }) => {
      const { onSend } = renderPanel(status);
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole(region)).toHaveTextContent(announcement);
      for (const [label, event] of buttons) {
        await userEvent.click(screen.getByRole('button', { name: label }));
        expect(onSend).toHaveBeenLastCalledWith(event);
      }
      expect(screen.getAllByRole('button')).toHaveLength(buttons.length);
      expect(screen.getByRole('link', { name: 'Back to catalogue' })).toHaveAttribute('href', '/');
    },
  );

  it('gives every status at least one way forward besides waiting', () => {
    for (const status of TRY_ON_STATUSES) {
      expect(STATUS_VIEWS[status].actions.length, status).toBeGreaterThan(0);
    }
  });

  it('opens the photo picker and hands over the chosen file', async () => {
    const { onPhoto, container } = renderPanel('photoChoosing');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');

    await userEvent.click(screen.getByRole('button', { name: 'Choose a photo' }));
    expect(click).toHaveBeenCalled();
    expect(input).toHaveAttribute('accept', 'image/*');

    const photo = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [photo] } });
    expect(onPhoto).toHaveBeenCalledWith(photo);
  });

  it('keeps both live regions mounted and moves the text between them', () => {
    const { rerender } = renderPanel('cameraRequesting');
    expect(screen.getByRole('alert')).toHaveTextContent('');
    rerender(
      <MemoryRouter>
        <StatusPanel status="cameraDenied" onSend={vi.fn()} onPhoto={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.getByRole('alert')).toHaveTextContent(STATUS_VIEWS.cameraDenied.announcement);
  });

  it('labels the region with the status title', () => {
    renderPanel('tracking');
    const region = screen.getByRole('region', { name: STATUS_VIEWS.tracking.title });
    expect(within(region).getByRole('heading')).toHaveTextContent('Tracking');
  });
});
