import { chatMessageSchema, type ChatMessage, type SignalingOutboundMessage } from '@p2p/shared';
import type { SignalingTransport } from './signaling-transport.js';
import { defaultIceServers } from './default-ice-servers.js';

export type PeerManagerOptions = {
  localPeerId: string;
  transport: SignalingTransport;
  rtcConfiguration?: RTCConfiguration;
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onChatMessage?: (peerId: string, message: ChatMessage) => void;
  onError?: (error: Error) => void;
};

type PeerContext = {
  connection: RTCPeerConnection;
  pendingCandidates: SignaledIceCandidate[];
  outgoingCandidates: SignaledIceCandidate[];
  candidateFlushTimerId: number | null;
  remoteStream: MediaStream;
  chatChannel?: RTCDataChannel;
  queuedChatPayloads: string[];
  negotiationInFlight: boolean;
  negotiationRetryTimerId: number | null;
  lastOfferAt: number;
};

type SignaledIceCandidate = Extract<
  SignalingOutboundMessage,
  { type: 'ice-candidate' }
>['candidate'];
const MAX_CHAT_MESSAGE_BYTES = 256 * 1024;
const OFFER_MIN_INTERVAL_MS = 1500;
const CANDIDATE_FLUSH_INTERVAL_MS = 220;

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }

  return value.length;
}

export class PeerManager {
  private readonly peers = new Map<string, PeerContext>();
  private readonly disconnectTimers = new Map<string, number>();
  private localStream: MediaStream | null = null;
  private relayModeEnabled = false;

  private readonly onPeerConnected: (peerId: string) => void;
  private readonly onPeerDisconnected: (peerId: string) => void;
  private readonly onRemoteStream: (peerId: string, stream: MediaStream) => void;
  private readonly onChatMessage: (peerId: string, message: ChatMessage) => void;
  private readonly onError: (error: Error) => void;

  public constructor(private readonly options: PeerManagerOptions) {
    this.onPeerConnected = options.onPeerConnected ?? (() => undefined);
    this.onPeerDisconnected = options.onPeerDisconnected ?? (() => undefined);
    this.onRemoteStream = options.onRemoteStream ?? (() => undefined);
    this.onChatMessage = options.onChatMessage ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
  }

  public setLocalStream(stream: MediaStream): void {
    this.localStream = stream;

    for (const context of this.peers.values()) {
      this.attachLocalTracks(context.connection);
    }
  }

  public async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack): Promise<void> {
    if (!this.localStream) {
      this.localStream = new MediaStream([track]);
    } else {
      for (const existingTrack of this.localStream.getTracks()) {
        if (existingTrack.kind !== kind) {
          continue;
        }

        this.localStream.removeTrack(existingTrack);
      }

      this.localStream.addTrack(track);
    }

    for (const { connection } of this.peers.values()) {
      const sender = connection.getSenders().find((candidate) => candidate.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(track);
        continue;
      }

      if (this.localStream) {
        connection.addTrack(track, this.localStream);
      }
    }
  }

  public async handleSignalingMessage(message: SignalingOutboundMessage): Promise<void> {
    switch (message.type) {
      case 'peer-joined': {
        await this.ensurePeerConnection(message.peerId, this.shouldCreateOffer(message.peerId));
        return;
      }
      case 'peer-left': {
        this.closePeer(message.peerId);
        return;
      }
      case 'offer': {
        await this.handleOffer(message.from, message.sdp);
        return;
      }
      case 'answer': {
        await this.handleAnswer(message.from, message.sdp);
        return;
      }
      case 'ice-candidate': {
        await this.handleIceCandidate(message.from, message.candidate);
        return;
      }
      case 'error': {
        this.onError(new Error(`${message.code}: ${message.message}`));
      }
    }
  }

  public closeAll(): void {
    for (const peerId of this.peers.keys()) {
      this.closePeer(peerId);
    }

    this.peers.clear();
  }

  public async sendChatMessage(peerId: string, message: ChatMessage): Promise<boolean> {
    const context = this.peers.get(peerId);
    if (!context) {
      this.onError(new Error(`Chat channel is not open for peer ${peerId}.`));
      return false;
    }

    const chatChannel = await this.ensureChatChannel(peerId, context);
    if (!chatChannel) {
      return false;
    }

    const validated = chatMessageSchema.safeParse(message);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      const details = issue ? ` (${issue.path.join('.') || 'root'}: ${issue.message})` : '';
      this.onError(new Error(`Outgoing chat message has invalid schema.${details}`));
      return false;
    }

    const serialized = JSON.stringify(validated.data);
    const messageSize = utf8ByteLength(serialized);
    if (messageSize > MAX_CHAT_MESSAGE_BYTES) {
      this.onError(new Error(`Outgoing chat message exceeds ${MAX_CHAT_MESSAGE_BYTES} bytes.`));
      return false;
    }

    if (chatChannel.readyState !== 'open') {
      this.enqueueChatPayload(context, serialized);
      return true;
    }

    try {
      await this.sendWithBackpressure(chatChannel, serialized);
      return true;
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to send chat message.'));
      return false;
    }
  }

  public async sendChatMessageToAll(message: ChatMessage): Promise<void> {
    for (const peerId of this.peers.keys()) {
      await this.sendChatMessage(peerId, message);
    }
  }

  public hasOpenChatChannel(peerId: string): boolean {
    const channel = this.peers.get(peerId)?.chatChannel;
    return Boolean(channel && channel.readyState === 'open');
  }

  public getChatChannelState(peerId: string): RTCDataChannelState | null {
    return this.peers.get(peerId)?.chatChannel?.readyState ?? null;
  }

  public getConnections(): Array<{ peerId: string; connection: RTCPeerConnection }> {
    return Array.from(this.peers.entries()).map(([peerId, context]) => ({
      peerId,
      connection: context.connection
    }));
  }

  public isRelayModeEnabled(): boolean {
    return this.relayModeEnabled;
  }

  public async setRelayMode(enabled: boolean): Promise<void> {
    if (this.relayModeEnabled === enabled) {
      return;
    }

    this.relayModeEnabled = enabled;
    for (const [peerId, context] of this.peers.entries()) {
      try {
        context.connection.setConfiguration(this.buildRtcConfiguration());
      } catch (error) {
        this.onError(
          error instanceof Error
            ? error
            : new Error(`Failed to apply RTC configuration for ${peerId}.`)
        );
      }

      await this.restartIce(peerId, context.connection, { force: true });
    }
  }

  private shouldCreateOffer(remotePeerId: string): boolean {
    return this.options.localPeerId.localeCompare(remotePeerId) > 0;
  }

  private async ensurePeerConnection(
    remotePeerId: string,
    createOffer: boolean
  ): Promise<PeerContext> {
    const existing = this.peers.get(remotePeerId);
    if (existing) {
      if (createOffer) {
        await this.createAndSendOffer(remotePeerId, existing.connection);
      }

      return existing;
    }

    const connection = new RTCPeerConnection(this.buildRtcConfiguration());

    const remoteStream = new MediaStream();
    const context: PeerContext = {
      connection,
      pendingCandidates: [],
      outgoingCandidates: [],
      candidateFlushTimerId: null,
      remoteStream,
      queuedChatPayloads: [],
      negotiationInFlight: false,
      negotiationRetryTimerId: null,
      lastOfferAt: 0
    };

    this.attachConnectionHandlers(remotePeerId, context);
    if (createOffer) {
      const channel = connection.createDataChannel('chat', {
        ordered: true,
        protocol: 'v1'
      });
      context.chatChannel = channel;
      this.attachChatChannelHandlers(remotePeerId, channel);
    }
    this.attachLocalTracks(connection);
    this.peers.set(remotePeerId, context);
    this.onPeerConnected(remotePeerId);

    if (createOffer) {
      await this.createAndSendOffer(remotePeerId, connection);
    }

    return context;
  }

  private attachConnectionHandlers(remotePeerId: string, context: PeerContext): void {
    const { connection, remoteStream } = context;

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      context.outgoingCandidates.push(this.normalizeIceCandidate(event.candidate));
      this.scheduleCandidateFlush(remotePeerId, context);
    };

    connection.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        remoteStream.addTrack(track);
      }

      this.onRemoteStream(remotePeerId, remoteStream);
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'closed' || connection.connectionState === 'failed') {
        this.clearDisconnectTimer(remotePeerId);
        this.closePeer(remotePeerId);
        return;
      }

      if (connection.connectionState === 'disconnected') {
        this.clearDisconnectTimer(remotePeerId);
        const timerId = window.setTimeout(() => {
          this.disconnectTimers.delete(remotePeerId);
          const latest = this.peers.get(remotePeerId);
          if (!latest) {
            return;
          }

          if (latest.connection.connectionState === 'disconnected') {
            this.closePeer(remotePeerId);
          }
        }, 5000);
        this.disconnectTimers.set(remotePeerId, timerId);
        return;
      }

      this.clearDisconnectTimer(remotePeerId);
    };

    connection.ondatachannel = (event) => {
      if (event.channel.label !== 'chat') {
        return;
      }

      const currentChannel = context.chatChannel;
      if (!currentChannel || currentChannel.readyState !== 'open') {
        context.chatChannel = event.channel;
      }
      this.attachChatChannelHandlers(remotePeerId, event.channel);
    };
  }

  private attachLocalTracks(connection: RTCPeerConnection): void {
    if (!this.localStream) {
      return;
    }

    const existingTrackIds = new Set(connection.getSenders().map((sender) => sender.track?.id));

    for (const track of this.localStream.getTracks()) {
      if (existingTrackIds.has(track.id)) {
        continue;
      }

      connection.addTrack(track, this.localStream);
    }
  }

  private async createAndSendOffer(
    remotePeerId: string,
    connection: RTCPeerConnection
  ): Promise<void> {
    await this.restartIce(remotePeerId, connection, { force: false });
  }

  private async restartIce(
    remotePeerId: string,
    connection: RTCPeerConnection,
    options?: { force?: boolean }
  ): Promise<void> {
    const context = this.peers.get(remotePeerId);
    if (!context || context.connection !== connection) {
      return;
    }

    if (context.negotiationInFlight) {
      this.scheduleNegotiationRetry(remotePeerId, context, OFFER_MIN_INTERVAL_MS);
      return;
    }

    const now = Date.now();
    if (!options?.force && now - context.lastOfferAt < OFFER_MIN_INTERVAL_MS) {
      const delayMs = OFFER_MIN_INTERVAL_MS - (now - context.lastOfferAt);
      this.scheduleNegotiationRetry(remotePeerId, context, delayMs);
      return;
    }

    context.negotiationInFlight = true;
    try {
      if (typeof connection.restartIce === 'function') {
        connection.restartIce();
      }

      const offer = await connection.createOffer({ iceRestart: true });
      await connection.setLocalDescription(offer);

      if (!connection.localDescription) {
        throw new Error('Local description is missing after createOffer.');
      }

      this.options.transport.send({
        type: 'offer',
        to: remotePeerId,
        sdp: connection.localDescription
      });
      context.lastOfferAt = Date.now();
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to create offer.'));
    } finally {
      context.negotiationInFlight = false;
    }
  }

  private buildRtcConfiguration(): RTCConfiguration {
    const base: RTCConfiguration = this.options.rtcConfiguration ?? {
      iceServers: defaultIceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    return {
      ...base,
      iceTransportPolicy: this.relayModeEnabled ? 'relay' : (base.iceTransportPolicy ?? 'all')
    };
  }

  private async handleOffer(remotePeerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const context = await this.ensurePeerConnection(remotePeerId, false);

    try {
      const signalingState = context.connection.signalingState;
      if (signalingState === 'have-local-offer' || signalingState === 'have-local-pranswer') {
        // Glare handling: abandon local in-flight offer before accepting remote offer.
        await context.connection.setLocalDescription({ type: 'rollback' });
      }

      await context.connection.setRemoteDescription(sdp);

      for (const candidate of context.pendingCandidates.splice(0)) {
        await context.connection.addIceCandidate(this.toRtcIceCandidateInit(candidate));
      }

      const answer = await context.connection.createAnswer();
      await context.connection.setLocalDescription(answer);

      if (!context.connection.localDescription) {
        throw new Error('Local description is missing after createAnswer.');
      }

      this.options.transport.send({
        type: 'answer',
        to: remotePeerId,
        sdp: context.connection.localDescription
      });
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to handle offer.'));
    }
  }

  private async handleAnswer(remotePeerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const context = this.peers.get(remotePeerId);
    if (!context) {
      return;
    }

    try {
      await context.connection.setRemoteDescription(sdp);

      for (const candidate of context.pendingCandidates.splice(0)) {
        await context.connection.addIceCandidate(this.toRtcIceCandidateInit(candidate));
      }
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to handle answer.'));
    }
  }

  private async handleIceCandidate(
    remotePeerId: string,
    candidate: SignaledIceCandidate
  ): Promise<void> {
    const context = this.peers.get(remotePeerId);
    if (!context) {
      const created = await this.ensurePeerConnection(remotePeerId, false);
      created.pendingCandidates.push(candidate);
      return;
    }

    if (!context.connection.remoteDescription) {
      context.pendingCandidates.push(candidate);
      return;
    }

    try {
      await context.connection.addIceCandidate(this.toRtcIceCandidateInit(candidate));
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to add ICE candidate.'));
    }
  }

  private closePeer(peerId: string): void {
    const context = this.peers.get(peerId);
    if (!context) {
      return;
    }

    this.clearDisconnectTimer(peerId);
    this.clearCandidateFlushTimer(context);
    this.clearNegotiationRetryTimer(context);

    context.connection.onicecandidate = null;
    context.connection.ontrack = null;
    context.connection.onconnectionstatechange = null;
    context.connection.ondatachannel = null;
    if (context.chatChannel) {
      context.chatChannel.onmessage = null;
      context.chatChannel.onopen = null;
      context.chatChannel.onclose = null;
      context.chatChannel.onerror = null;
      context.chatChannel.close();
    }
    context.connection.close();

    this.peers.delete(peerId);
    this.onPeerDisconnected(peerId);
  }

  private clearDisconnectTimer(peerId: string): void {
    const timerId = this.disconnectTimers.get(peerId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      this.disconnectTimers.delete(peerId);
    }
  }

  private scheduleNegotiationRetry(peerId: string, context: PeerContext, delayMs: number): void {
    if (context.negotiationRetryTimerId !== null) {
      return;
    }

    context.negotiationRetryTimerId = window.setTimeout(
      () => {
        context.negotiationRetryTimerId = null;
        const latest = this.peers.get(peerId);
        if (!latest || latest.connection.connectionState === 'closed') {
          return;
        }

        void this.restartIce(peerId, latest.connection, { force: false });
      },
      Math.max(50, delayMs)
    );
  }

  private clearNegotiationRetryTimer(context: PeerContext): void {
    if (context.negotiationRetryTimerId === null) {
      return;
    }

    window.clearTimeout(context.negotiationRetryTimerId);
    context.negotiationRetryTimerId = null;
  }

  private scheduleCandidateFlush(peerId: string, context: PeerContext): void {
    if (context.candidateFlushTimerId !== null) {
      return;
    }

    context.candidateFlushTimerId = window.setTimeout(() => {
      context.candidateFlushTimerId = null;
      const latest = this.peers.get(peerId);
      if (!latest) {
        return;
      }

      this.flushOneCandidate(peerId, latest);
      if (latest.outgoingCandidates.length > 0) {
        this.scheduleCandidateFlush(peerId, latest);
      }
    }, CANDIDATE_FLUSH_INTERVAL_MS);
  }

  private flushOneCandidate(peerId: string, context: PeerContext): void {
    const candidate = context.outgoingCandidates.shift();
    if (!candidate) {
      return;
    }

    this.options.transport.send({
      type: 'ice-candidate',
      to: peerId,
      candidate
    });
  }

  private clearCandidateFlushTimer(context: PeerContext): void {
    if (context.candidateFlushTimerId === null) {
      return;
    }

    window.clearTimeout(context.candidateFlushTimerId);
    context.candidateFlushTimerId = null;
  }

  private normalizeIceCandidate(candidate: RTCIceCandidate): SignaledIceCandidate {
    const normalized: SignaledIceCandidate = {
      candidate: candidate.candidate
    };

    if (candidate.sdpMid !== undefined) {
      normalized.sdpMid = candidate.sdpMid;
    }

    if (candidate.sdpMLineIndex !== undefined) {
      normalized.sdpMLineIndex = candidate.sdpMLineIndex;
    }

    if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null) {
      normalized.usernameFragment = candidate.usernameFragment;
    }

    return normalized;
  }

  private toRtcIceCandidateInit(candidate: SignaledIceCandidate): RTCIceCandidateInit {
    const normalized: RTCIceCandidateInit = {
      candidate: candidate.candidate
    };

    if (candidate.sdpMid !== undefined) {
      normalized.sdpMid = candidate.sdpMid;
    }

    if (candidate.sdpMLineIndex !== undefined) {
      normalized.sdpMLineIndex = candidate.sdpMLineIndex;
    }

    if (candidate.usernameFragment !== undefined) {
      normalized.usernameFragment = candidate.usernameFragment;
    }

    return normalized;
  }

  private attachChatChannelHandlers(peerId: string, channel: RTCDataChannel): void {
    channel.bufferedAmountLowThreshold = 256 * 1024;

    channel.onopen = () => {
      const context = this.peers.get(peerId);
      if (!context) {
        return;
      }

      void this.flushQueuedChatPayloads(peerId, context, channel);
    };

    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        this.onError(new Error('Incoming chat message must be text JSON.'));
        return;
      }

      const messageSize = utf8ByteLength(event.data);
      if (messageSize > MAX_CHAT_MESSAGE_BYTES) {
        this.onError(new Error(`Incoming chat message exceeds ${MAX_CHAT_MESSAGE_BYTES} bytes.`));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        this.onError(new Error('Incoming chat message is not valid JSON.'));
        return;
      }

      const validated = chatMessageSchema.safeParse(parsed);
      if (!validated.success) {
        this.onError(new Error('Incoming chat message schema is invalid.'));
        return;
      }

      this.onChatMessage(peerId, validated.data);
    };

    channel.onerror = () => {
      this.onError(new Error(`Chat channel error for peer ${peerId}.`));
    };

    const context = this.peers.get(peerId);
    if (context && channel.readyState === 'open') {
      void this.flushQueuedChatPayloads(peerId, context, channel);
    }
  }

  private async sendWithBackpressure(channel: RTCDataChannel, payload: string): Promise<void> {
    const highWaterMark = 1024 * 1024;
    if (channel.bufferedAmount > highWaterMark) {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          channel.removeEventListener('bufferedamountlow', onLow);
          reject(new Error('Timed out waiting for DataChannel buffer to drain.'));
        }, 5000);

        const onLow = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };

        channel.addEventListener('bufferedamountlow', onLow, { once: true });
      });
    }

    channel.send(payload);
  }

  private async ensureChatChannel(
    peerId: string,
    context: PeerContext
  ): Promise<RTCDataChannel | null> {
    if (context.chatChannel && context.chatChannel.readyState !== 'closed') {
      return context.chatChannel;
    }

    try {
      const channel = context.connection.createDataChannel('chat', {
        ordered: true,
        protocol: 'v1'
      });
      context.chatChannel = channel;
      this.attachChatChannelHandlers(peerId, channel);
      await this.restartIce(peerId, context.connection, { force: true });
      return channel;
    } catch (error) {
      this.onError(
        error instanceof Error ? error : new Error('Failed to initialize chat channel.')
      );
      return null;
    }
  }

  private enqueueChatPayload(context: PeerContext, payload: string): void {
    const maxQueuedPayloads = 200;
    if (context.queuedChatPayloads.length >= maxQueuedPayloads) {
      context.queuedChatPayloads.shift();
    }
    context.queuedChatPayloads.push(payload);
  }

  private async flushQueuedChatPayloads(
    peerId: string,
    context: PeerContext,
    channel: RTCDataChannel
  ): Promise<void> {
    if (channel.readyState !== 'open') {
      return;
    }

    while (context.queuedChatPayloads.length > 0) {
      if (context.chatChannel !== channel || channel.readyState !== 'open') {
        return;
      }

      const payload = context.queuedChatPayloads.shift();
      if (!payload) {
        return;
      }

      try {
        await this.sendWithBackpressure(channel, payload);
      } catch (error) {
        this.onError(
          error instanceof Error
            ? error
            : new Error(`Failed to flush queued chat messages for peer ${peerId}.`)
        );
        context.queuedChatPayloads.unshift(payload);
        return;
      }
    }
  }
}
