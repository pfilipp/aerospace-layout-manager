/**
 * Tests for the PropertiesPanel component.
 *
 * Tests rendering behavior based on selected node type and empty state.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropertiesPanel } from '../../src/components/PropertiesPanel/PropertiesPanel';
import type { ContainerNode, WindowNode, AppEntry } from '../../server/types';

// --- Test helpers ---

const testApps: Record<string, AppEntry> = {
  'com.microsoft.VSCode': {
    name: 'VS Code',
    source: 'seed',
    defaultStartup: 'code ${PROJECT_DIR}',
  },
  'com.googlecode.iterm2': {
    name: 'iTerm2',
    source: 'seed',
    defaultStartup: "iterm-window.sh '${PROJECT_ITERM_CMD}'",
  },
  'com.apple.Safari': {
    name: 'Safari',
    source: 'seed',
    defaultStartup: 'open -a Safari',
  },
  'com.brave.Browser': {
    name: 'Brave',
    source: 'seed',
    defaultStartup: "open -a 'Brave Browser'",
  },
};

function makeContainerNode(): ContainerNode {
  return {
    type: 'container',
    layout: 'h_accordion',
    orientation: 'horizontal',
    children: [],
  };
}

function makeWindowNode(): WindowNode {
  return {
    type: 'window',
    'app-bundle-id': 'com.microsoft.VSCode',
    'app-name': 'VS Code',
    startup: 'code ~/Projects/test',
    title: 'test-project',
    'window-id': 1,
  };
}

afterEach(() => {
  cleanup();
});

// --- Tests ---

describe('PropertiesPanel', () => {
  it('shows "Select a node" when no selection', () => {
    const onUpdate = vi.fn();
    render(
      <PropertiesPanel selectedNode={null} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    expect(screen.getByText(/select a node/i)).toBeDefined();
  });

  it('shows container properties for container node', () => {
    const onUpdate = vi.fn();
    render(
      <PropertiesPanel selectedNode={makeContainerNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    expect(screen.getByText(/container properties/i)).toBeDefined();
    expect(screen.getByLabelText(/layout type/i)).toBeDefined();
    // Orientation is now displayed as a static read-only field derived from layout type
    expect(screen.getByText('Horizontal')).toBeDefined();
  });

  it('shows window properties for window node', () => {
    const onUpdate = vi.fn();
    render(
      <PropertiesPanel selectedNode={makeWindowNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    expect(screen.getByText(/window properties/i)).toBeDefined();
    expect(screen.getByLabelText(/app name/i)).toBeDefined();
    expect(screen.getByLabelText(/bundle id/i)).toBeDefined();
    expect(screen.getByLabelText(/startup command/i)).toBeDefined();
    expect(screen.getByLabelText(/title/i)).toBeDefined();
  });

  it('editing a field calls onUpdate for container', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <PropertiesPanel selectedNode={makeContainerNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    const layoutSelect = screen.getByLabelText(/layout type/i);
    await user.selectOptions(layoutSelect, 'v_tiles');

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const call = onUpdate.mock.calls[0][0] as ContainerNode;
    expect(call.layout).toBe('v_tiles');
    // Orientation is auto-synced with layout type
    expect(call.orientation).toBe('vertical');
  });

  it('editing a field calls onUpdate for window', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <PropertiesPanel selectedNode={makeWindowNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    const appNameInput = screen.getByLabelText(/app name/i);
    await user.type(appNameInput, '!');

    // onUpdate is called for each keystroke
    expect(onUpdate).toHaveBeenCalled();
    // The call should contain the original value with the typed character appended
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as WindowNode;
    expect(lastCall['app-name']).toBe('VS Code!');
  });

  it('layout type dropdown has 4 options', () => {
    const onUpdate = vi.fn();

    render(
      <PropertiesPanel selectedNode={makeContainerNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    const layoutSelect = screen.getByLabelText(/layout type/i);
    const options = layoutSelect.querySelectorAll('option');
    expect(options).toHaveLength(4);

    const optionValues = Array.from(options).map((o) => o.value);
    expect(optionValues).toContain('h_accordion');
    expect(optionValues).toContain('v_accordion');
    expect(optionValues).toContain('h_tiles');
    expect(optionValues).toContain('v_tiles');
  });

  it('displays window node fields with correct initial values', () => {
    const onUpdate = vi.fn();

    render(
      <PropertiesPanel selectedNode={makeWindowNode()} parentLayout={null} onUpdate={onUpdate} apps={testApps} />,
    );

    expect((screen.getByLabelText(/app name/i) as HTMLInputElement).value).toBe('VS Code');
    expect((screen.getByLabelText(/bundle id/i) as HTMLInputElement).value).toBe('com.microsoft.VSCode');
    expect((screen.getByLabelText(/startup command/i) as HTMLTextAreaElement).value).toBe('code ~/Projects/test');
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('test-project');
  });
});
