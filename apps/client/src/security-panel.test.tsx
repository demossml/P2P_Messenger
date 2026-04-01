import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityPanel } from './security-panel.js';

afterEach(() => {
  cleanup();
});

describe('SecurityPanel', () => {
  it('renders empty remote state and disabled reset button', () => {
    render(
      <SecurityPanel
        localFingerprint={null}
        remoteFingerprints={[]}
        verifiedPeers={{}}
        copiedFingerprint={null}
        securityNotice={null}
        onCopyFingerprint={vi.fn()}
        onMarkPeerVerification={vi.fn()}
        onClearPeerVerification={vi.fn()}
        onResetAllVerifications={vi.fn()}
      />
    );

    expect(screen.getByText('No remote fingerprints yet.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reset all verifications' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByText('initializing...')).toBeTruthy();
  });

  it('renders peer verification status and invokes callbacks', () => {
    const onCopyFingerprint = vi.fn();
    const onMarkPeerVerification = vi.fn();
    const onClearPeerVerification = vi.fn();
    const onResetAllVerifications = vi.fn();

    render(
      <SecurityPanel
        localFingerprint="abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        remoteFingerprints={[
          {
            peerId: '11111111-1111-4111-8111-111111111111',
            fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          }
        ]}
        verifiedPeers={{
          '11111111-1111-4111-8111-111111111111': true
        }}
        copiedFingerprint="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        securityNotice="Fingerprint copied to clipboard."
        onCopyFingerprint={onCopyFingerprint}
        onMarkPeerVerification={onMarkPeerVerification}
        onClearPeerVerification={onClearPeerVerification}
        onResetAllVerifications={onResetAllVerifications}
      />
    );

    expect(screen.getByRole('status').textContent).toContain('copied');
    expect(screen.getByText(/\[matched\]/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reset all verifications' }).hasAttribute('disabled')
    ).toBe(false);
    expect(screen.getAllByText('Copied').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all verifications' }));
    expect(onResetAllVerifications).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'Mark peer 11111111 as matched' })
    );
    expect(onMarkPeerVerification).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      true
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Mark peer 11111111 as unmatched' })
    );
    expect(onMarkPeerVerification).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      false
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear verification for peer 11111111' })
    );
    expect(onClearPeerVerification).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy fingerprint for peer 11111111' })
    );
    expect(onCopyFingerprint).toHaveBeenCalled();
  });
});
