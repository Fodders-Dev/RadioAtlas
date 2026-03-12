export type WinampTransportControl =
  | 'previous'
  | 'play'
  | 'pause'
  | 'stop'
  | 'next';

const TRANSPORT_MATCHERS: Array<{
  control: WinampTransportControl;
  selector: string;
}> = [
  { control: 'previous', selector: '#previous, [title="Previous Track"]' },
  { control: 'play', selector: '#play, [title="Play"]' },
  { control: 'pause', selector: '#pause, [title="Pause"]' },
  { control: 'stop', selector: '#stop, [title="Stop"]' },
  { control: 'next', selector: '#next, [title="Next Track"]' }
];

export const getWebampRootNode = () =>
  document.getElementById('webamp') as HTMLElement | null;

export const stopNativeEvent = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
  (
    event as Event & {
      stopImmediatePropagation?: () => void;
    }
  ).stopImmediatePropagation?.();
};

export const resolveTransportControl = (target: HTMLElement | null) => {
  if (!target) return null;
  const matcher = TRANSPORT_MATCHERS.find((item) => target.closest(item.selector));
  return matcher?.control ?? null;
};

export const bindWinampTransportBridge = ({
  onControl
}: {
  onControl: (control: WinampTransportControl) => void;
}) => {
  const onPress = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const webampRoot = getWebampRootNode();
    if (!target || !webampRoot?.contains(target)) return;
    const control = resolveTransportControl(target);
    if (!control) return;
    stopNativeEvent(event);
  };

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const webampRoot = getWebampRootNode();
    if (!target || !webampRoot?.contains(target)) return;
    const control = resolveTransportControl(target);
    if (!control) return;
    stopNativeEvent(event);
    onControl(control);
  };

  document.addEventListener('mousedown', onPress, true);
  document.addEventListener('touchstart', onPress, true);
  document.addEventListener('click', onClick, true);

  return () => {
    document.removeEventListener('mousedown', onPress, true);
    document.removeEventListener('touchstart', onPress, true);
    document.removeEventListener('click', onClick, true);
  };
};
