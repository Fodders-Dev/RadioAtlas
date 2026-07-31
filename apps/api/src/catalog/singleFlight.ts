export type CatalogMode = 'fast' | 'full';

export const createCatalogSingleFlight = <T>() => {
  let fastFlight: Promise<T> | null = null;
  let fullFlight: Promise<T> | null = null;

  return (mode: CatalogMode, load: () => Promise<T>): Promise<T> => {
    const activeFlight = mode === 'fast' ? fastFlight : fullFlight;
    if (activeFlight) {
      return activeFlight;
    }

    // Start through a promise boundary so a synchronous loader failure follows
    // the same rejection/cleanup path as an asynchronous one.
    const flight = Promise.resolve().then(load);
    if (mode === 'fast') {
      fastFlight = flight;
    } else {
      fullFlight = flight;
    }

    const clear = () => {
      if (mode === 'fast') {
        if (fastFlight === flight) fastFlight = null;
      } else if (fullFlight === flight) {
        fullFlight = null;
      }
    };
    void flight.then(clear, clear);

    return flight;
  };
};
