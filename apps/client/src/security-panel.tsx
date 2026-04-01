import React from 'react';
import { StatusNotice } from './status-notice.js';

export type RemoteFingerprintEntry = {
  peerId: string;
  fingerprint: string;
};

type SecurityPanelProps = {
  localFingerprint: string | null;
  remoteFingerprints: RemoteFingerprintEntry[];
  verifiedPeers: Record<string, boolean>;
  copiedFingerprint: string | null;
  securityNotice: string | null;
  onCopyFingerprint: (fingerprint: string) => void;
  onMarkPeerVerification: (peerId: string, verified: boolean) => void;
  onClearPeerVerification: (peerId: string) => void;
  onResetAllVerifications: () => void;
};

function buildFingerprintCells(fingerprint: string): string[] {
  const normalized = fingerprint.replace(/[^a-f0-9]/gi, '').toLowerCase().padEnd(18, '0');
  const colors: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const pair = normalized.slice(index * 2, index * 2 + 2);
    const value = Number.parseInt(pair, 16);
    const hue = Number.isNaN(value) ? 0 : Math.round((value / 255) * 360);
    colors.push(`hsl(${hue} 72% 46%)`);
  }

  return colors;
}

type FingerprintBadgeProps = {
  fingerprint: string;
};

function FingerprintBadge({ fingerprint }: FingerprintBadgeProps): React.JSX.Element {
  const colors = buildFingerprintCells(fingerprint);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 12px)',
        gap: '2px',
        marginLeft: '8px'
      }}
      aria-label={`Fingerprint pattern ${fingerprint.slice(0, 12)}`}
    >
      {colors.map((color, index) => (
        <span
          key={`${fingerprint}:${index}`}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: color,
            borderRadius: '2px'
          }}
        />
      ))}
    </div>
  );
}

export function SecurityPanel({
  localFingerprint,
  remoteFingerprints,
  verifiedPeers,
  copiedFingerprint,
  securityNotice,
  onCopyFingerprint,
  onMarkPeerVerification,
  onClearPeerVerification,
  onResetAllVerifications
}: SecurityPanelProps): React.JSX.Element {
  return (
    <section>
      <h2>Security</h2>
      {securityNotice ? <StatusNotice label="Security notice">{securityNotice}</StatusNotice> : null}
      <button
        type="button"
        onClick={onResetAllVerifications}
        style={{ marginBottom: '8px' }}
        disabled={Object.keys(verifiedPeers).length === 0}
      >
        Reset all verifications
      </button>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <p>
          Your key fingerprint:{' '}
          <code>{localFingerprint ? localFingerprint.slice(0, 24) : 'initializing...'}</code>
        </p>
        {localFingerprint ? <FingerprintBadge fingerprint={localFingerprint} /> : null}
        {localFingerprint ? (
          <button
            type="button"
            onClick={() => {
              onCopyFingerprint(localFingerprint);
            }}
            style={{ marginLeft: '8px' }}
          >
            {copiedFingerprint === localFingerprint ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>
      {remoteFingerprints.length === 0 ? <p>No remote fingerprints yet.</p> : null}
      {remoteFingerprints.map((entry) => {
        const peerShortId = entry.peerId.slice(0, 8);
        const isVerified = Object.prototype.hasOwnProperty.call(verifiedPeers, entry.peerId);
        const status = !isVerified
          ? 'unverified'
          : verifiedPeers[entry.peerId]
            ? 'matched'
            : 'unmatched';

        return (
          <div
            key={`fp:${entry.peerId}`}
            style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}
          >
            <p>
              Peer {peerShortId}: <code>{entry.fingerprint.slice(0, 24)}</code> [{status}]
            </p>
            <FingerprintBadge fingerprint={entry.fingerprint} />
            <button
              type="button"
              aria-label={`Copy fingerprint for peer ${peerShortId}`}
              onClick={() => {
                onCopyFingerprint(entry.fingerprint);
              }}
              style={{ marginLeft: '8px' }}
            >
              {copiedFingerprint === entry.fingerprint ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              aria-label={`Mark peer ${peerShortId} as matched`}
              onClick={() => {
                onMarkPeerVerification(entry.peerId, true);
              }}
              style={{ marginLeft: '8px' }}
            >
              Mark matched
            </button>
            <button
              type="button"
              aria-label={`Mark peer ${peerShortId} as unmatched`}
              onClick={() => {
                onMarkPeerVerification(entry.peerId, false);
              }}
              style={{ marginLeft: '6px' }}
            >
              Mark unmatched
            </button>
            <button
              type="button"
              aria-label={`Clear verification for peer ${peerShortId}`}
              onClick={() => {
                onClearPeerVerification(entry.peerId);
              }}
              style={{ marginLeft: '6px' }}
            >
              Clear
            </button>
          </div>
        );
      })}
    </section>
  );
}
