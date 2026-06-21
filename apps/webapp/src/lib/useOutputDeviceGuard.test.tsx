import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useOutputDeviceGuard, type OutputDeviceGuardParams } from './outputDeviceGuard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Controllable navigator.mediaDevices mock: variable audiooutput count + a
// dispatchable 'devicechange' whose handler promise can be awaited.
const makeMediaDevices = () => {
  let outputs = 0;
  let handler: (() => unknown) | null = null;
  return {
    setOutputs: (n: number) => {
      outputs = n;
    },
    fire: () => handler?.(),
    mock: {
      enumerateDevices: async () =>
        Array.from({ length: outputs }, () => ({ kind: 'audiooutput' })) as MediaDeviceInfo[],
      addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === 'devicechange') handler = cb as () => unknown;
      },
      removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === 'devicechange' && handler === cb) handler = null;
      }
    }
  };
};

describe('useOutputDeviceGuard', () => {
  let container: HTMLDivElement;
  let root: Root;
  let devices: ReturnType<typeof makeMediaDevices>;
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    devices = makeMediaDevices();
    original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: devices.mock, configurable: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  const Probe = (props: OutputDeviceGuardParams) => {
    useOutputDeviceGuard(props);
    return null;
  };

  const render = async (props: OutputDeviceGuardParams) => {
    await act(async () => {
      root.render(createElement(Probe, props));
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const fire = async () => {
    await act(async () => {
      await devices.fire();
      await Promise.resolve();
    });
  };

  it('pauses once when an output device is removed while playing', async () => {
    const onUnplug = vi.fn();
    devices.setOutputs(2);
    await render({ enabled: true, isPlaying: true, onUnplug });
    devices.setOutputs(1); // headphones pulled
    await fire();
    expect(onUnplug).toHaveBeenCalledTimes(1);
  });

  it('does not pause on plug-IN (output count rises)', async () => {
    const onUnplug = vi.fn();
    devices.setOutputs(1);
    await render({ enabled: true, isPlaying: true, onUnplug });
    devices.setOutputs(2);
    await fire();
    expect(onUnplug).not.toHaveBeenCalled();
  });

  it('does not pause while not playing', async () => {
    const onUnplug = vi.fn();
    devices.setOutputs(2);
    await render({ enabled: true, isPlaying: false, onUnplug });
    devices.setOutputs(1);
    await fire();
    expect(onUnplug).not.toHaveBeenCalled();
  });

  it('does nothing while disabled (no listener, no pause)', async () => {
    const onUnplug = vi.fn();
    devices.setOutputs(2);
    await render({ enabled: false, isPlaying: true, onUnplug });
    devices.setOutputs(1);
    await fire(); // no handler is registered → no-op
    expect(onUnplug).not.toHaveBeenCalled();
  });
});
