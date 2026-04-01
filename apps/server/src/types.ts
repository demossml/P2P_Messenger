export type AuthState = 'anonymous' | 'authenticated';

export type PeerRecord = {
  peerId: string;
  roomId: string;
  peerPublicKey: string;
};

export type ConnectionState = {
  connectionId: string;
  authState: AuthState;
  peer: PeerRecord | undefined;
  connectedAt: number;
};
