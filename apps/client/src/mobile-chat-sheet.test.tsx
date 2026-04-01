import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileChatSheet } from './mobile-chat-sheet.js';

afterEach(() => {
  cleanup();
});

describe('MobileChatSheet', () => {
  it('renders collapsed state and toggles open on button click', () => {
    const onOpenChange = vi.fn();

    render(
      <MobileChatSheet
        isOpen={false}
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    const handleButton = screen.getByRole('button', { name: 'Swipe up for chat' });
    const controlledPanelId = handleButton.getAttribute('aria-controls');
    expect(controlledPanelId).toBeTruthy();
    expect(document.getElementById(controlledPanelId ?? '')).toBeTruthy();

    fireEvent.click(handleButton);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('No messages yet.')).toBeTruthy();
  });

  it('handles swipe gestures to open and close', () => {
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <MobileChatSheet
        isOpen={false}
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    const collapsedToggle = screen.getByRole('button', { name: 'Swipe up for chat' });
    fireEvent.touchStart(collapsedToggle, {
      touches: [{ clientY: 240 }]
    });
    fireEvent.touchEnd(collapsedToggle, {
      changedTouches: [{ clientY: 120 }]
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <MobileChatSheet
        isOpen
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    const openToggle = screen.getByRole('button', { name: 'Close chat' });
    fireEvent.touchStart(openToggle, {
      touches: [{ clientY: 120 }]
    });
    fireEvent.touchEnd(openToggle, {
      changedTouches: [{ clientY: 240 }]
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape when sheet is open', () => {
    const onOpenChange = vi.fn();

    render(
      <MobileChatSheet
        isOpen
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves focus to chat input on open and back to handle on close', () => {
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <MobileChatSheet
        isOpen={false}
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    rerender(
      <MobileChatSheet
        isOpen
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    const chatInput = screen.getByPlaceholderText('Type a message');
    expect(document.activeElement).toBe(chatInput);

    rerender(
      <MobileChatSheet
        isOpen={false}
        bottomOffsetPx={56}
        chatMessages={[]}
        onSendText={vi.fn()}
        onSendReaction={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    expect(screen.getByRole('button', { name: 'Swipe up for chat' })).toBe(document.activeElement);
  });
});
