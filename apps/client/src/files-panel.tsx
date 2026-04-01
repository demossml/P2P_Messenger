import React, { useEffect, useMemo, useState } from 'react';

type FileTransferPeerState = {
  peerId: string;
  status: 'pending' | 'accepted' | 'completed' | 'rejected' | 'timeout';
  sentChunks: number;
  totalChunks: number;
  lastUpdateAt: number;
  error?: string;
};

export type FileTransferView = {
  fileId: string;
  name: string;
  size: number;
  totalChunks: number;
  receivedChunks: number;
  status: 'sending' | 'receiving' | 'completed' | 'failed' | 'partial';
  checksum: string;
  error?: string;
  downloadUrl?: string;
  peerStates: FileTransferPeerState[];
};

type FilesPanelProps = {
  fileTransfers: FileTransferView[];
  onSendFile: (file: File) => Promise<void>;
};

type TransferFilter = 'all' | 'active' | 'completed' | 'failed';
type TransferSort = 'recent' | 'largest';

const FILES_FILTER_STORAGE_KEY = 'p2p.files.filter';
const FILES_SORT_STORAGE_KEY = 'p2p.files.sort';

function isTransferFilter(value: string): value is TransferFilter {
  return value === 'all' || value === 'active' || value === 'completed' || value === 'failed';
}

function isTransferSort(value: string): value is TransferSort {
  return value === 'recent' || value === 'largest';
}

export function FilesPanel({ fileTransfers, onSendFile }: FilesPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState<TransferFilter>(() => {
    if (typeof window === 'undefined') {
      return 'all';
    }

    const stored = window.localStorage.getItem(FILES_FILTER_STORAGE_KEY);
    return stored && isTransferFilter(stored) ? stored : 'all';
  });
  const [sort, setSort] = useState<TransferSort>(() => {
    if (typeof window === 'undefined') {
      return 'recent';
    }

    const stored = window.localStorage.getItem(FILES_SORT_STORAGE_KEY);
    return stored && isTransferSort(stored) ? stored : 'recent';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(FILES_FILTER_STORAGE_KEY, filter);
  }, [filter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(FILES_SORT_STORAGE_KEY, sort);
  }, [sort]);

  const transferCounts = useMemo(() => {
    const completed = fileTransfers.filter((transfer) => transfer.status === 'completed').length;
    const failed = fileTransfers.filter((transfer) => transfer.status === 'failed').length;
    const active = fileTransfers.filter(
      (transfer) =>
        transfer.status === 'sending' ||
        transfer.status === 'receiving' ||
        transfer.status === 'partial'
    ).length;

    return {
      all: fileTransfers.length,
      active,
      completed,
      failed
    };
  }, [fileTransfers]);

  const visibleTransfers = useMemo(() => {
    if (filter === 'all') {
      return sort === 'recent'
        ? fileTransfers
        : [...fileTransfers].sort((left, right) => {
            const bySize = right.size - left.size;
            if (bySize !== 0) {
              return bySize;
            }
            return left.name.localeCompare(right.name);
          });
    }
    if (filter === 'completed') {
      const filtered = fileTransfers.filter((transfer) => transfer.status === 'completed');
      return sort === 'recent'
        ? filtered
        : [...filtered].sort((left, right) => {
            const bySize = right.size - left.size;
            if (bySize !== 0) {
              return bySize;
            }
            return left.name.localeCompare(right.name);
          });
    }
    if (filter === 'failed') {
      const filtered = fileTransfers.filter((transfer) => transfer.status === 'failed');
      return sort === 'recent'
        ? filtered
        : [...filtered].sort((left, right) => {
            const bySize = right.size - left.size;
            if (bySize !== 0) {
              return bySize;
            }
            return left.name.localeCompare(right.name);
          });
    }

    const filtered = fileTransfers.filter(
      (transfer) =>
        transfer.status === 'sending' ||
        transfer.status === 'receiving' ||
        transfer.status === 'partial'
    );
    return sort === 'recent'
      ? filtered
      : [...filtered].sort((left, right) => {
          const bySize = right.size - left.size;
          if (bySize !== 0) {
            return bySize;
          }
          return left.name.localeCompare(right.name);
        });
  }, [fileTransfers, filter, sort]);

  return (
    <section>
      <h2>Files</h2>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <label htmlFor="files-filter">Filter</label>
        <select
          id="files-filter"
          value={filter}
          onChange={(event) => {
            const next = event.target.value as TransferFilter;
            setFilter(next);
          }}
        >
          <option value="all">All ({transferCounts.all})</option>
          <option value="active">Active ({transferCounts.active})</option>
          <option value="completed">Completed ({transferCounts.completed})</option>
          <option value="failed">Failed ({transferCounts.failed})</option>
        </select>
        <label htmlFor="files-sort">Sort</label>
        <select
          id="files-sort"
          value={sort}
          onChange={(event) => {
            const next = event.target.value as TransferSort;
            setSort(next);
          }}
        >
          <option value="recent">Recent first</option>
          <option value="largest">Largest first</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setFilter('active');
          }}
          aria-pressed={filter === 'active'}
        >
          Active only
        </button>
        <button
          type="button"
          onClick={() => {
            setFilter('failed');
          }}
          aria-pressed={filter === 'failed'}
        >
          Failed only
        </button>
        <button
          type="button"
          onClick={() => {
            setFilter('all');
          }}
          aria-pressed={filter === 'all'}
        >
          Show all
        </button>
      </div>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          void onSendFile(file);
          event.currentTarget.value = '';
        }}
      />
      {fileTransfers.length === 0 ? <p>No file transfers yet.</p> : null}
      {fileTransfers.length > 0 && visibleTransfers.length === 0 ? (
        <p>No transfers match current filter.</p>
      ) : null}
      {visibleTransfers.map((transfer) => {
        const percent = Math.min(
          100,
          Math.floor((transfer.receivedChunks / Math.max(1, transfer.totalChunks)) * 100)
        );

        return (
          <div key={transfer.fileId}>
            <p>
              <strong>{transfer.name}</strong> [{transfer.status}] {percent}% ({transfer.receivedChunks}/
              {transfer.totalChunks})
              {transfer.downloadUrl ? (
                <>
                  {' '}
                  <a href={transfer.downloadUrl} download={transfer.name}>
                    Download
                  </a>
                </>
              ) : null}
              {transfer.error ? ` error: ${transfer.error}` : ''}
            </p>
            <div
              role="progressbar"
              aria-label={`File transfer progress for ${transfer.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            />
            {transfer.peerStates.length > 0 ? (
              <div>
                {transfer.peerStates.map((peerState) => {
                  const peerPercent = Math.min(
                    100,
                    Math.floor((peerState.sentChunks / Math.max(1, peerState.totalChunks)) * 100)
                  );

                  return (
                    <div key={`${transfer.fileId}:${peerState.peerId}`}>
                      <p>
                        Peer {peerState.peerId.slice(0, 8)}: {peerState.status} {peerPercent}% (
                        {peerState.sentChunks}/{peerState.totalChunks})
                        {peerState.error ? ` error: ${peerState.error}` : ''}
                      </p>
                      <div
                        role="progressbar"
                        aria-label={`Peer ${peerState.peerId.slice(0, 8)} transfer progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={peerPercent}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
