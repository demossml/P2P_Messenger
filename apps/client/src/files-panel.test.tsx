import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesPanel, type FileTransferView } from './files-panel.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('FilesPanel', () => {
  it('renders empty state when there are no transfers', () => {
    render(<FilesPanel fileTransfers={[]} onSendFile={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('No file transfers yet.')).toBeTruthy();
  });

  it('renders transfer and peer progress details', () => {
    const transfer: FileTransferView = {
      fileId: 'file-1',
      name: 'video.mp4',
      size: 5000,
      totalChunks: 10,
      receivedChunks: 4,
      status: 'sending',
      checksum: 'sha256:abc',
      error: 'partial timeout',
      downloadUrl: 'blob:http://localhost/example',
      peerStates: [
        {
          peerId: '11111111-1111-4111-8111-111111111111',
          status: 'accepted',
          sentChunks: 4,
          totalChunks: 10,
          lastUpdateAt: Date.now()
        }
      ]
    };

    render(
      <FilesPanel
        fileTransfers={[transfer]}
        onSendFile={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(/video\.mp4/)).toBeTruthy();
    expect(screen.getByText(/\[sending\]/)).toBeTruthy();
    expect(screen.getByText(/partial timeout/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    expect(screen.getByText(/Peer 11111111: accepted 40%/)).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'File transfer progress for video.mp4' })
    ).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Peer 11111111 transfer progress' })
    ).toBeTruthy();
  });

  it('invokes onSendFile when user selects a file', () => {
    const onSendFile = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<FilesPanel fileTransfers={[]} onSendFile={onSendFile} />);

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    if (!input) {
      throw new Error('File input is missing.');
    }
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });

    expect(onSendFile).toHaveBeenCalledWith(file);
  });

  it('filters transfers by selected status group', () => {
    const transfers: FileTransferView[] = [
      {
        fileId: 'file-active',
        name: 'active.bin',
        size: 1000,
        totalChunks: 10,
        receivedChunks: 5,
        status: 'sending',
        checksum: 'sha256:1',
        peerStates: []
      },
      {
        fileId: 'file-completed',
        name: 'done.bin',
        size: 1000,
        totalChunks: 10,
        receivedChunks: 10,
        status: 'completed',
        checksum: 'sha256:2',
        peerStates: []
      },
      {
        fileId: 'file-failed',
        name: 'failed.bin',
        size: 1000,
        totalChunks: 10,
        receivedChunks: 4,
        status: 'failed',
        checksum: 'sha256:3',
        peerStates: []
      }
    ];

    render(<FilesPanel fileTransfers={transfers} onSendFile={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('option', { name: 'All (3)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Active (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Completed (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Failed (1)' })).toBeTruthy();

    expect(screen.getByText(/active\.bin/)).toBeTruthy();
    expect(screen.getByText(/done\.bin/)).toBeTruthy();
    expect(screen.getByText(/failed\.bin/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'failed' } });
    expect(screen.queryByText(/active\.bin/)).toBeNull();
    expect(screen.queryByText(/done\.bin/)).toBeNull();
    expect(screen.getByText(/failed\.bin/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'completed' } });
    expect(screen.queryByText(/active\.bin/)).toBeNull();
    expect(screen.queryByText(/failed\.bin/)).toBeNull();
    expect(screen.getByText(/done\.bin/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'active' } });
    expect(screen.getByText(/active\.bin/)).toBeTruthy();
    expect(screen.queryByText(/done\.bin/)).toBeNull();
    expect(screen.queryByText(/failed\.bin/)).toBeNull();
  });

  it('sorts transfers by size when largest-first mode is selected', () => {
    const transfers: FileTransferView[] = [
      {
        fileId: 'file-small',
        name: 'small.bin',
        size: 100,
        totalChunks: 10,
        receivedChunks: 1,
        status: 'sending',
        checksum: 'sha256:small',
        peerStates: []
      },
      {
        fileId: 'file-big',
        name: 'big.bin',
        size: 5000,
        totalChunks: 10,
        receivedChunks: 2,
        status: 'sending',
        checksum: 'sha256:big',
        peerStates: []
      }
    ];

    const { container } = render(
      <FilesPanel fileTransfers={transfers} onSendFile={vi.fn().mockResolvedValue(undefined)} />
    );

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'largest' } });

    const strongLabels = Array.from(container.querySelectorAll('strong')).map((node) =>
      node.textContent?.trim()
    );
    expect(strongLabels[0]).toBe('big.bin');
    expect(strongLabels[1]).toBe('small.bin');
  });

  it('supports quick filter actions for active/failed/all', () => {
    const transfers: FileTransferView[] = [
      {
        fileId: 'file-active',
        name: 'active.bin',
        size: 1000,
        totalChunks: 10,
        receivedChunks: 5,
        status: 'sending',
        checksum: 'sha256:1',
        peerStates: []
      },
      {
        fileId: 'file-failed',
        name: 'failed.bin',
        size: 1000,
        totalChunks: 10,
        receivedChunks: 3,
        status: 'failed',
        checksum: 'sha256:2',
        peerStates: []
      }
    ];

    render(<FilesPanel fileTransfers={transfers} onSendFile={vi.fn().mockResolvedValue(undefined)} />);

    const activeOnly = screen.getByRole('button', { name: 'Active only' });
    const failedOnly = screen.getByRole('button', { name: 'Failed only' });
    const showAll = screen.getByRole('button', { name: 'Show all' });

    expect(showAll.getAttribute('aria-pressed')).toBe('true');
    expect(activeOnly.getAttribute('aria-pressed')).toBe('false');
    expect(failedOnly.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(activeOnly);
    expect(activeOnly.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/active\.bin/)).toBeTruthy();
    expect(screen.queryByText(/failed\.bin/)).toBeNull();

    fireEvent.click(failedOnly);
    expect(failedOnly.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/failed\.bin/)).toBeTruthy();
    expect(screen.queryByText(/active\.bin/)).toBeNull();

    fireEvent.click(showAll);
    expect(showAll.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/active\.bin/)).toBeTruthy();
    expect(screen.getByText(/failed\.bin/)).toBeTruthy();
  });

  it('restores filter and sort preferences from localStorage', () => {
    localStorage.setItem('p2p.files.filter', 'failed');
    localStorage.setItem('p2p.files.sort', 'largest');

    render(<FilesPanel fileTransfers={[]} onSendFile={vi.fn().mockResolvedValue(undefined)} />);

    const filterSelect = screen.getByLabelText('Filter') as HTMLSelectElement;
    const sortSelect = screen.getByLabelText('Sort') as HTMLSelectElement;
    expect(filterSelect.value).toBe('failed');
    expect(sortSelect.value).toBe('largest');
  });

  it('persists filter and sort preferences to localStorage', () => {
    render(<FilesPanel fileTransfers={[]} onSendFile={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'completed' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'largest' } });

    expect(localStorage.getItem('p2p.files.filter')).toBe('completed');
    expect(localStorage.getItem('p2p.files.sort')).toBe('largest');
  });
});
