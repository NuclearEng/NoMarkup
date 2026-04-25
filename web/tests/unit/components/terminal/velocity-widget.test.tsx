// VelocityWidget — purely presentational; renders a label and sparkline bars
// based on velocity buckets. No mocks needed.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { VelocityWidget } from '@/components/terminal/widgets/velocity-widget';
import { makeWidgetProps, makeSim } from './_fixtures';

describe('VelocityWidget', () => {
  it('renders Cooling label for moderate velocity', () => {
    render(createElement(VelocityWidget, makeWidgetProps({ sim: makeSim({ velocity: 2 }) })));
    expect(screen.getByText('Cooling')).toBeDefined();
    expect(screen.getByText('2 bids / min')).toBeDefined();
  });

  it('renders Heating label for higher velocity', () => {
    render(createElement(VelocityWidget, makeWidgetProps({ sim: makeSim({ velocity: 4 }) })));
    expect(screen.getByText('Heating')).toBeDefined();
  });

  it('renders Hot label for very high velocity', () => {
    render(createElement(VelocityWidget, makeWidgetProps({ sim: makeSim({ velocity: 8 }) })));
    expect(screen.getByText('Hot')).toBeDefined();
  });

  it('renders Quiet label when no activity', () => {
    render(createElement(VelocityWidget, makeWidgetProps({ sim: makeSim({ velocity: 0 }) })));
    expect(screen.getByText('Quiet')).toBeDefined();
  });
});
