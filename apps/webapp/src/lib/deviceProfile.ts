type DeviceProfile = {
  lowPower: boolean;
  reducedMotion: boolean;
  constrainedNetwork: boolean;
};

const DEFAULT_PROFILE: DeviceProfile = {
  lowPower: false,
  reducedMotion: false,
  constrainedNetwork: false
};

let cachedProfile: DeviceProfile | null = null;

const readNavigatorConnection = () => {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    mozConnection?: { saveData?: boolean; effectiveType?: string };
    webkitConnection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return (
    candidate ||
    (navigator as Navigator & { mozConnection?: { saveData?: boolean; effectiveType?: string } }).mozConnection ||
    (navigator as Navigator & { webkitConnection?: { saveData?: boolean; effectiveType?: string } }).webkitConnection ||
    null
  );
};

export const getDeviceProfile = (): DeviceProfile => {
  if (cachedProfile) {
    return cachedProfile;
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    cachedProfile = DEFAULT_PROFILE;
    return cachedProfile;
  }

  const hardwareConcurrency = navigator.hardwareConcurrency || 4;
  const deviceMemory = Number(
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0
  );
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const connection = readNavigatorConnection();
  const saveData = Boolean(connection?.saveData);
  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  const constrainedNetwork = saveData || effectiveType === 'slow-2g' || effectiveType === '2g';
  const lowPower =
    reducedMotion ||
    constrainedNetwork ||
    hardwareConcurrency <= 4 ||
    (deviceMemory > 0 && deviceMemory <= 4);

  cachedProfile = {
    lowPower,
    reducedMotion,
    constrainedNetwork
  };

  return cachedProfile;
};

export const isLowPowerDevice = () => getDeviceProfile().lowPower;
