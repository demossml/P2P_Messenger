import { useEffect, useState } from 'react';

const VERIFIED_PEERS_STORAGE_KEY = 'p2p.verifiedPeers';

type RemotePeerFingerprint = {
  peerId: string;
};

export function useFingerprintVerification(remoteFingerprints: RemotePeerFingerprint[]): {
  copiedFingerprint: string | null;
  securityNotice: string | null;
  verifiedPeers: Record<string, boolean>;
  markPeerVerification: (peerId: string, verified: boolean) => void;
  clearPeerVerification: (peerId: string) => void;
  resetAllVerifications: () => void;
  copyFingerprint: (value: string) => Promise<void>;
} {
  const [copiedFingerprint, setCopiedFingerprint] = useState<string | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const [verifiedPeers, setVerifiedPeers] = useState<Record<string, boolean>>(() => {
    try {
      const rawValue = sessionStorage.getItem(VERIFIED_PEERS_STORAGE_KEY);
      if (!rawValue) {
        return {};
      }

      const parsed = JSON.parse(rawValue) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, boolean] => {
          return typeof entry[0] === 'string' && typeof entry[1] === 'boolean';
        })
      );
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(VERIFIED_PEERS_STORAGE_KEY, JSON.stringify(verifiedPeers));
    } catch {
      // Ignore storage write errors in restricted/private contexts.
    }
  }, [verifiedPeers]);

  useEffect(() => {
    if (!securityNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSecurityNotice(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [securityNotice]);

  useEffect(() => {
    const activePeerIds = new Set(remoteFingerprints.map((entry) => entry.peerId));
    setVerifiedPeers((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([peerId]) => activePeerIds.has(peerId))
      );

      if (Object.keys(next).length === Object.keys(current).length) {
        return current;
      }

      return next;
    });
  }, [remoteFingerprints]);

  function markPeerVerification(peerId: string, verified: boolean): void {
    setVerifiedPeers((current) => ({
      ...current,
      [peerId]: verified
    }));
    setSecurityNotice(`Peer ${peerId.slice(0, 8)} marked as ${verified ? 'matched' : 'unmatched'}.`);
  }

  function clearPeerVerification(peerId: string): void {
    setVerifiedPeers((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    setSecurityNotice(`Peer ${peerId.slice(0, 8)} verification cleared.`);
  }

  function resetAllVerifications(): void {
    setVerifiedPeers({});
    setSecurityNotice('All peer verifications were reset.');
  }

  async function copyFingerprint(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedFingerprint(value);
    setSecurityNotice('Fingerprint copied to clipboard.');
    window.setTimeout(() => {
      setCopiedFingerprint((current) => (current === value ? null : current));
    }, 1400);
  }

  return {
    copiedFingerprint,
    securityNotice,
    verifiedPeers,
    markPeerVerification,
    clearPeerVerification,
    resetAllVerifications,
    copyFingerprint
  };
}
