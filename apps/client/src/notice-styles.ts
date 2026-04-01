import type { CSSProperties } from 'react';

const baseNoticeStyle: CSSProperties = {
  margin: '6px 0',
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid transparent',
  fontSize: '0.92rem'
};

export function statusNoticeStyle(): CSSProperties {
  return {
    ...baseNoticeStyle,
    background: '#eff6ff',
    borderColor: '#bfdbfe',
    color: '#1e3a8a'
  };
}

export function alertNoticeStyle(): CSSProperties {
  return {
    ...baseNoticeStyle,
    background: '#fef2f2',
    borderColor: '#fecaca',
    color: '#7f1d1d'
  };
}
