import React, { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { AlertNotice } from './alert-notice.js';
import { useSignaling } from './use-signaling.js';
import { SecurityPanel } from './security-panel.js';
import { FilesPanel } from './files-panel.js';
import { ChatPanel } from './chat-panel.js';
import { ConnectionPanel } from './connection-panel.js';
import { MediaPanel } from './media-panel.js';
import { useFingerprintVerification } from './use-fingerprint-verification.js';
import { DeviceSelector } from './device-selector.js';
import { MobileCallControls } from './mobile-call-controls.js';
import { MobileChatSheet } from './mobile-chat-sheet.js';
import { useIsMobileViewport } from './use-is-mobile-viewport.js';
import { MOBILE_CONTROL_BAR_HEIGHT_PX } from './layout.js';
import { mobileMainStyle } from './mobile-styles.js';

export function App(): React.JSX.Element {
  const lastNetworkNoticeRef = useRef<string | null>(null);
  const isMobileViewport = useIsMobileViewport();
  const [isMobileChatOpen, setIsMobileChatOpen] = useState<boolean>(false);
  const {
    status,
    roomId,
    setRoomId,
    remotePeerCount,
    localStream,
    remoteStreams,
    isLocalMediaReady,
    isMuted,
    isCameraOff,
    isScreenSharing,
    connectionQuality,
    packetLossPercent,
    rttMs,
    jitterMs,
    relayFallbackRecommended,
    relayModeEnabled,
    networkNotice,
    peerConnectionQualities,
    preferredDevices,
    setPreferredDevices,
    chatMessages,
    fileTransfers,
    localFingerprint,
    remoteFingerprints,
    lastError,
    connect,
    disconnect,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    sendChatText,
    sendReaction,
    sendFile
  } = useSignaling();
  const {
    copiedFingerprint,
    securityNotice,
    verifiedPeers,
    markPeerVerification,
    clearPeerVerification,
    resetAllVerifications,
    copyFingerprint
  } = useFingerprintVerification(remoteFingerprints);

  useEffect(() => {
    if (!networkNotice || networkNotice === lastNetworkNoticeRef.current) {
      return;
    }

    toast.message(networkNotice);
    lastNetworkNoticeRef.current = networkNotice;
  }, [networkNotice]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileChatOpen(false);
    }
  }, [isMobileViewport]);

  return (
    <main style={mobileMainStyle(isMobileViewport)}>
      <Toaster richColors position="top-right" closeButton />
      <h1>P2P Messenger</h1>
      <DeviceSelector
        preferredDevices={preferredDevices}
        onChangePreferredDevices={setPreferredDevices}
      />
      <ConnectionPanel
        status={status}
        roomId={roomId}
        isLocalMediaReady={isLocalMediaReady}
        remotePeerCount={remotePeerCount}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        isScreenSharing={isScreenSharing}
        connectionQuality={connectionQuality}
        packetLossPercent={packetLossPercent}
        rttMs={rttMs}
        jitterMs={jitterMs}
        relayFallbackRecommended={relayFallbackRecommended}
        relayModeEnabled={relayModeEnabled}
        onRoomIdChange={setRoomId}
        onConnect={connect}
        onDisconnect={disconnect}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={() => {
          void toggleScreenShare();
        }}
      />
      {lastError ? <AlertNotice label="Application error">{lastError}</AlertNotice> : null}

      <SecurityPanel
        localFingerprint={localFingerprint}
        remoteFingerprints={remoteFingerprints}
        verifiedPeers={verifiedPeers}
        copiedFingerprint={copiedFingerprint}
        securityNotice={securityNotice}
        onCopyFingerprint={(fingerprint) => {
          void copyFingerprint(fingerprint);
        }}
        onMarkPeerVerification={markPeerVerification}
        onClearPeerVerification={clearPeerVerification}
        onResetAllVerifications={resetAllVerifications}
      />

      <MediaPanel
        localStream={localStream}
        remoteStreams={remoteStreams}
        preferredAudioOutputId={preferredDevices.audioOutputId}
        peerConnectionQualities={peerConnectionQualities}
      />

      {isMobileViewport ? (
        <MobileCallControls
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          isScreenSharing={isScreenSharing}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onToggleScreenShare={() => {
            void toggleScreenShare();
          }}
          onOpenChat={() => {
            setIsMobileChatOpen(true);
          }}
        />
      ) : null}

      {isMobileViewport ? (
        <MobileChatSheet
          isOpen={isMobileChatOpen}
          bottomOffsetPx={MOBILE_CONTROL_BAR_HEIGHT_PX}
          chatMessages={chatMessages}
          onSendText={sendChatText}
          onSendReaction={sendReaction}
          onOpenChange={setIsMobileChatOpen}
        />
      ) : (
        <ChatPanel
          chatMessages={chatMessages}
          onSendText={sendChatText}
          onSendReaction={sendReaction}
        />
      )}

      <FilesPanel fileTransfers={fileTransfers} onSendFile={sendFile} />
    </main>
  );
}
