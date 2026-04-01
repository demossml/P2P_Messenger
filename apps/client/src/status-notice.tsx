import React from 'react';
import { statusNoticeStyle } from './notice-styles.js';

type StatusNoticeProps = {
  label: string;
  children: React.ReactNode;
};

export function StatusNotice({ label, children }: StatusNoticeProps): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-label={label} style={statusNoticeStyle()}>
      {children}
    </div>
  );
}
