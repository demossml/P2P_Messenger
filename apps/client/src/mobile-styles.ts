import type { CSSProperties } from 'react';
import {
  MOBILE_CHAT_HANDLE_HEIGHT_PX,
  MOBILE_CHAT_MAIN_PADDING_EXTRA_PX,
  MOBILE_CHAT_SHEET_MAX_HEIGHT_VH,
  MOBILE_CHAT_SHEET_TRANSITION_MS,
  MOBILE_CONTROL_BAR_HEIGHT_PX
} from './layout.js';

export function mobileMainStyle(isMobileViewport: boolean): CSSProperties | undefined {
  if (!isMobileViewport) {
    return undefined;
  }

  return {
    paddingBottom: `${MOBILE_CONTROL_BAR_HEIGHT_PX + MOBILE_CHAT_MAIN_PADDING_EXTRA_PX}px`
  };
}

export function mobileCallControlsStyle(): CSSProperties {
  return {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    height: `${MOBILE_CONTROL_BAR_HEIGHT_PX}px`,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '8px',
    padding: '8px',
    borderTop: '1px solid #d4d4d8',
    background: '#ffffff',
    zIndex: 45
  };
}

export function mobileChatSheetStyle(
  isOpen: boolean,
  bottomOffsetPx: number
): CSSProperties {
  const transform = isOpen
    ? 'translateY(0)'
    : `translateY(calc(100% - ${MOBILE_CHAT_HANDLE_HEIGHT_PX}px))`;

  return {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: `${bottomOffsetPx}px`,
    maxHeight: `${MOBILE_CHAT_SHEET_MAX_HEIGHT_VH}vh`,
    background: '#ffffff',
    borderTop: '1px solid #d4d4d8',
    boxShadow: '0 -10px 24px rgba(15, 23, 42, 0.12)',
    transform,
    transition: `transform ${MOBILE_CHAT_SHEET_TRANSITION_MS}ms ease`,
    zIndex: 40,
    overflow: 'auto',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px'
  };
}

export function mobileChatHandleStyle(): CSSProperties {
  return {
    width: '100%',
    minHeight: `${MOBILE_CHAT_HANDLE_HEIGHT_PX}px`,
    border: 'none',
    borderBottom: '1px solid #e4e4e7',
    background: '#f8fafc',
    fontWeight: 600
  };
}

export function mobileChatContentStyle(): CSSProperties {
  return {
    padding: '10px'
  };
}
