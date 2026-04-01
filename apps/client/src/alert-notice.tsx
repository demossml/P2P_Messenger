import React from 'react';
import { alertNoticeStyle } from './notice-styles.js';

type AlertNoticeProps = {
  label: string;
  children: React.ReactNode;
};

export function AlertNotice({ label, children }: AlertNoticeProps): React.JSX.Element {
  return (
    <div role="alert" aria-live="assertive" aria-label={label} style={alertNoticeStyle()}>
      {children}
    </div>
  );
}
