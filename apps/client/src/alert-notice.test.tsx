import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertNotice } from './alert-notice.js';

afterEach(() => {
  cleanup();
});

describe('AlertNotice', () => {
  it('renders assertive alert region with label', () => {
    render(<AlertNotice label="Device alert">Permission blocked</AlertNotice>);

    const alert = screen.getByRole('alert', { name: 'Device alert' });
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.getAttribute('style')).toContain('background');
    expect(alert.textContent).toContain('Permission blocked');
  });
});
