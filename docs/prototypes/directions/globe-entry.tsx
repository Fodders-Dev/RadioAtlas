import React from 'react';
import {createRoot} from 'react-dom/client';
import {Globe} from '../../../apps/webapp/src/components/Globe';
import {resolveCountryCoords} from '../../../apps/webapp/src/lib/geoResolver';

// The application's actual Globe. This adapter changes no application source.
window.RadioAtlasGlobe = {
  countryCoords: resolveCountryCoords,
  mount(element, props) {
    const root = createRoot(element);
    let current = props;
    let flight;
    root.render(<Globe {...current}/>);
    return {
      update(next) {
        // Globe's separate zoom and focus effects each start easeTo. Sequence
        // those requests here so zoom cannot cancel the country's flight.
        if(next.focusPoint && typeof next.zoomLevel === 'number') {
          clearTimeout(flight);
          const {focusPoint,...rest}=next;
          current={...current,...rest};root.render(<Globe {...current}/>);
          flight=setTimeout(()=>{current={...current,focusPoint};root.render(<Globe {...current}/>);},360);
        } else {current={...current,...next};root.render(<Globe {...current}/>);}
      },
      destroy() {clearTimeout(flight);root.unmount();}
    };
  }
};
