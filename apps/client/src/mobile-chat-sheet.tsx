import React, { useEffect, useId, useRef } from 'react';
import { ChatPanel, type ChatMessageView } from './chat-panel.js';
import { MOBILE_CHAT_SWIPE_THRESHOLD_PX } from './layout.js';
import {
  mobileChatContentStyle,
  mobileChatHandleStyle,
  mobileChatSheetStyle
} from './mobile-styles.js';

type MobileChatSheetProps = {
  isOpen: boolean;
  bottomOffsetPx: number;
  chatMessages: ChatMessageView[];
  onSendText: (text: string) => void;
  onSendReaction: (messageId: string, emoji: string) => void;
  onOpenChange: (next: boolean) => void;
};

export function MobileChatSheet({
  isOpen,
  bottomOffsetPx,
  chatMessages,
  onSendText,
  onSendReaction,
  onOpenChange
}: MobileChatSheetProps): React.JSX.Element {
  const sheetId = useId();
  const touchStartYRef = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const handleButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef<boolean>(isOpen);

  useEffect(() => {
    if (isOpen) {
      const focusTarget = sectionRef.current?.querySelector<HTMLElement>(
        'input, textarea, [contenteditable="true"]'
      );
      focusTarget?.focus();
    } else if (wasOpenRef.current) {
      handleButtonRef.current?.focus();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <section
      id={`${sheetId}-panel`}
      ref={sectionRef}
      style={mobileChatSheetStyle(isOpen, bottomOffsetPx)}
    >
      <button
        ref={handleButtonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={`${sheetId}-panel`}
        onClick={() => {
          onOpenChange(!isOpen);
        }}
        onTouchStart={(event) => {
          touchStartYRef.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          const startY = touchStartYRef.current;
          touchStartYRef.current = null;
          if (startY === null) {
            return;
          }

          const endY = event.changedTouches[0]?.clientY ?? startY;
          const deltaY = startY - endY;
          if (deltaY > MOBILE_CHAT_SWIPE_THRESHOLD_PX) {
            onOpenChange(true);
          } else if (deltaY < -MOBILE_CHAT_SWIPE_THRESHOLD_PX) {
            onOpenChange(false);
          }
        }}
        style={mobileChatHandleStyle()}
      >
        {isOpen ? 'Close chat' : 'Swipe up for chat'}
      </button>
      <div style={mobileChatContentStyle()}>
        <ChatPanel
          chatMessages={chatMessages}
          onSendText={onSendText}
          onSendReaction={onSendReaction}
        />
      </div>
    </section>
  );
}
