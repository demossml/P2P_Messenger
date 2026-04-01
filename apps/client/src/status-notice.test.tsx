import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusNotice } from './status-notice.js';

afterEach(() => {
  cleanup();
});

describe('StatusNotice', () => {
  it('renders polite live region with label', () => {
    render(<StatusNotice label="Test status">Status changed</StatusNotice>);

    const status = screen.getByRole('status', { name: 'Test status' });
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('style')).toContain('background');
    expect(status.textContent).toContain('Status changed');
  });
});
