import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel, type ChatMessageView } from './chat-panel.js';

afterEach(() => {
  cleanup();
});

describe('ChatPanel', () => {
  it('renders empty chat state', () => {
    render(<ChatPanel chatMessages={[]} onSendText={vi.fn()} onSendReaction={vi.fn()} />);
    expect(screen.getByText('No messages yet.')).toBeTruthy();
  });

  it('sends text and reactions through callbacks', () => {
    const onSendText = vi.fn();
    const onSendReaction = vi.fn();

    const messages: ChatMessageView[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        senderId: '22222222-2222-4222-8222-222222222222',
        text: 'Hello from peer',
        timestamp: Date.now(),
        incoming: true,
        readBy: [],
        reactions: []
      }
    ];

    render(
      <ChatPanel chatMessages={messages} onSendText={onSendText} onSendReaction={onSendReaction} />
    );

    fireEvent.change(screen.getByPlaceholderText('Type a message'), {
      target: {
        value: 'Test message'
      }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendText).toHaveBeenCalledWith('Test message');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'React thumbs up to message from Peer 22222222'
      })
    );
    expect(onSendReaction).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', '👍');
  });

  it('trims message before send and disables submit for blank input', () => {
    const onSendText = vi.fn();
    render(<ChatPanel chatMessages={[]} onSendText={onSendText} onSendReaction={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Type a message'), {
      target: { value: '   padded text   ' }
    });
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(sendButton);
    expect(onSendText).toHaveBeenCalledWith('padded text');
  });

  it('caps input value at 4000 characters', () => {
    render(<ChatPanel chatMessages={[]} onSendText={vi.fn()} onSendReaction={vi.fn()} />);

    const input = screen.getByPlaceholderText('Type a message') as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'x'.repeat(4500) }
    });

    expect(input.value.length).toBe(4000);
  });
});
