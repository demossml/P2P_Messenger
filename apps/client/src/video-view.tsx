import React, { useEffect, useRef } from 'react';

type VideoViewProps = {
  stream: MediaStream;
  muted?: boolean;
  label: string;
  isHighlighted?: boolean;
  badge?: string;
  badgeTone?: 'neutral' | 'good' | 'fair' | 'poor';
  badgeTitle?: string;
  badgeAriaLabel?: string;
  audioOutputId?: string;
};

export function VideoView({
  stream,
  muted = false,
  label,
  isHighlighted = false,
  badge,
  badgeTone = 'neutral',
  badgeTitle,
  badgeAriaLabel,
  audioOutputId
}: VideoViewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    const element = videoRef.current as (HTMLVideoElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    }) | null;
    if (!element || muted) {
      return;
    }

    if (typeof element.setSinkId !== 'function') {
      return;
    }

    const sinkId = audioOutputId ?? '';
    void element.setSinkId(sinkId).catch(() => undefined);
  }, [audioOutputId, muted]);

  const badgeStyles: Record<'neutral' | 'good' | 'fair' | 'poor', React.CSSProperties> = {
    neutral: {
      border: '1px solid #334155',
      background: '#1e293b',
      color: '#e2e8f0'
    },
    good: {
      border: '1px solid #166534',
      background: '#14532d',
      color: '#dcfce7'
    },
    fair: {
      border: '1px solid #92400e',
      background: '#78350f',
      color: '#fef3c7'
    },
    poor: {
      border: '1px solid #991b1b',
      background: '#7f1d1d',
      color: '#fee2e2'
    }
  };

  return (
    <figure
      style={{
        margin: 0,
        border: isHighlighted ? '2px solid #22c55e' : '1px solid #d4d4d8',
        borderRadius: '12px',
        overflow: 'hidden',
        background: '#0f172a',
        color: '#f8fafc'
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
      />
      <figcaption
        style={{
          padding: '8px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.9rem'
        }}
      >
        <span>{label}</span>
        {badge ? (
          <span
            title={badgeTitle}
            aria-label={badgeAriaLabel ?? badge}
            style={{
              borderRadius: '999px',
              padding: '2px 8px',
              fontSize: '0.75rem',
              ...badgeStyles[badgeTone]
            }}
          >
            {badge}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
