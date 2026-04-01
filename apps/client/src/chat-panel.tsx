import React, { useState } from 'react';

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

  return (
    <section>
      <h2>Chat</h2>
      <div>
        {chatMessages.length === 0 ? <p>No messages yet.</p> : null}
        {chatMessages.map((message) => {
          const senderLabel = message.incoming ? `Peer ${message.senderId.slice(0, 8)}` : 'You';
          return (
          <p key={message.id}>
            <strong>{senderLabel}:</strong>{' '}
            {message.text}
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
          onSendText(chatInput);
          setChatInput('');
        }}
      >
        <input
          value={chatInput}
          onChange={(event) => {
            setChatInput(event.target.value);
          }}
          placeholder="Type a message"
        />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
