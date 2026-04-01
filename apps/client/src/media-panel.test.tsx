import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPanel } from './media-panel.js';

vi.mock('./video-view.js', () => ({
  VideoView: ({
    label,
    badge,
    isHighlighted,
    badgeTone,
    badgeTitle,
    badgeAriaLabel
  }: {
    label: string;
    badge?: string;
    isHighlighted?: boolean;
    badgeTone?: 'neutral' | 'good' | 'fair' | 'poor';
    badgeTitle?: string;
    badgeAriaLabel?: string;
  }) => (
    <div data-testid="video-tile">
      <span>{label}</span>
      {badge ? <span>{badge}</span> : null}
      {badgeTone ? <span>{`tone:${badgeTone}`}</span> : null}
      {badgeTitle ? <span>{badgeTitle}</span> : null}
      {badgeAriaLabel ? <span aria-label={badgeAriaLabel} /> : null}
      <span>{isHighlighted ? 'highlighted' : 'normal'}</span>
    </div>
  )
}));

afterEach(() => {
  cleanup();
});

describe('MediaPanel', () => {
  it('renders empty state without streams', () => {
    render(
      <MediaPanel
        localStream={null}
        remoteStreams={[]}
        preferredAudioOutputId=""
        peerConnectionQualities={[]}
      />
    );

    expect(screen.getByText('No local video yet.')).toBeTruthy();
    expect(screen.getByText('No remote streams yet.')).toBeTruthy();
  });

  it('renders local and remote tiles', () => {
    render(
      <MediaPanel
        localStream={{} as MediaStream}
        remoteStreams={[
          {
            peerId: '11111111-1111-4111-8111-111111111111',
            stream: {} as MediaStream
          },
          {
            peerId: '22222222-2222-4222-8222-222222222222',
            stream: {} as MediaStream
          }
        ]}
        preferredAudioOutputId="speaker-1"
        peerConnectionQualities={[
          {
            peerId: '11111111-1111-4111-8111-111111111111',
            quality: 'fair',
            packetLossPercent: 6,
            rttMs: 320,
            jitterMs: 55
          },
          {
            peerId: '22222222-2222-4222-8222-222222222222',
            quality: 'good',
            packetLossPercent: 1,
            rttMs: 80,
            jitterMs: 11
          }
        ]}
      />
    );

    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Dominant speaker')).toBeTruthy();
    expect(screen.getByText('Peer 11111111')).toBeTruthy();
    expect(screen.getByText('Peer 22222222')).toBeTruthy();
    expect(screen.getByText('tone:fair')).toBeTruthy();
    expect(screen.getByText('tone:good')).toBeTruthy();
    expect(screen.getByText('Loss: 6.0% | RTT: 320 ms | Jitter: 55 ms')).toBeTruthy();
    expect(screen.getByText('Loss: 1.0% | RTT: 80 ms | Jitter: 11 ms')).toBeTruthy();
    expect(screen.getByLabelText('Quality legend: good connection')).toBeTruthy();
    expect(screen.getByLabelText('Quality legend: fair connection')).toBeTruthy();
    expect(screen.getByLabelText('Quality legend: poor connection')).toBeTruthy();
    expect(
      screen.getByLabelText(
        '11111111 quality badge: fair. Loss: 6.0% | RTT: 320 ms | Jitter: 55 ms'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show issues only' })).toBeTruthy();
    expect(screen.getByLabelText('Sort')).toBeTruthy();
    expect(screen.getAllByTestId('video-tile')).toHaveLength(3);
  });

  it('filters remote tiles to problematic peers only', () => {
    render(
      <MediaPanel
        localStream={{} as MediaStream}
        remoteStreams={[
          {
            peerId: '11111111-1111-4111-8111-111111111111',
            stream: {} as MediaStream
          },
          {
            peerId: '22222222-2222-4222-8222-222222222222',
            stream: {} as MediaStream
          }
        ]}
        preferredAudioOutputId="speaker-1"
        peerConnectionQualities={[
          {
            peerId: '11111111-1111-4111-8111-111111111111',
            quality: 'poor',
            packetLossPercent: 14,
            rttMs: 640,
            jitterMs: 120
          },
          {
            peerId: '22222222-2222-4222-8222-222222222222',
            quality: 'good',
            packetLossPercent: 1,
            rttMs: 80,
            jitterMs: 10
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show issues only' }));

    expect(screen.getByText('Peer 11111111')).toBeTruthy();
    expect(screen.queryByText('Peer 22222222')).toBeNull();
    expect(screen.getAllByTestId('video-tile')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show all peers' })).toBeTruthy();
  });
});
