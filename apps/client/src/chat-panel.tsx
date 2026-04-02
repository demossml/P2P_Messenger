import React, { useState } from 'react';

const MAX_CHAT_TEXT_LENGTH = 4000;

type ChatReaction = {
  senderId: string;
  emoji: string;
};

export type ChatMessageView = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  incoming: boolean;
  readBy: string[];
  reactions: ChatReaction[];
};

type ChatPanelProps = {
  chatMessages: ChatMessageView[];
  onSendText: (text: string) => void;
  onSendReaction: (messageId: string, emoji: string) => void;
};

export function ChatPanel({
  chatMessages,
  onSendText,
  onSendReaction
}: ChatPanelProps): React.JSX.Element {
  const [chatInput, setChatInput] = useState<string>('');
  const canSend = chatInput.trim().length > 0;

  return (
    <section>
      <h2>Chat</h2>
      <div>
        {chatMessages.length === 0 ? <p>No messages yet.</p> : null}
        {chatMessages.map((message) => {
          const senderLabel = message.incoming ? `Peer ${message.senderId.slice(0, 8)}` : 'You';
          return (
            <p key={message.id}>
              <strong>{senderLabel}:</strong> {message.text}
              {!message.incoming ? ` (${message.readBy.length > 0 ? 'read' : 'sent'})` : ''}
              {message.reactions.length > 0 ? (
                <>
                  {' '}
                  {message.reactions.map((reaction, index) => (
                    <span key={`${message.id}:${reaction.senderId}:${reaction.emoji}:${index}`}>
                      {reaction.emoji}
                    </span>
                  ))}
                </>
              ) : null}
              <button
                type="button"
                aria-label={`React thumbs up to message from ${senderLabel}`}
                onClick={() => {
                  onSendReaction(message.id, '👍');
                }}
              >
                👍
              </button>
              <button
                type="button"
                aria-label={`React heart to message from ${senderLabel}`}
                onClick={() => {
                  onSendReaction(message.id, '❤️');
                }}
              >
                ❤️
              </button>
              <button
                type="button"
                aria-label={`React laugh to message from ${senderLabel}`}
                onClick={() => {
                  onSendReaction(message.id, '😂');
                }}
              >
                😂
              </button>
            </p>
          );
        })}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = chatInput.trim();
          if (!trimmed) {
            return;
          }

          onSendText(trimmed);
          setChatInput('');
        }}
      >
        <input
          value={chatInput}
          onChange={(event) => {
            setChatInput(event.target.value.slice(0, MAX_CHAT_TEXT_LENGTH));
          }}
          placeholder="Type a message"
          maxLength={MAX_CHAT_TEXT_LENGTH}
        />
        <button type="submit" disabled={!canSend}>
          Send
        </button>
      </form>
    </section>
  );
}
