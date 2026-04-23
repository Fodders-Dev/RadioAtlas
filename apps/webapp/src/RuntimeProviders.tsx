import App from './App';
import { CatalogProvider } from './state/CatalogContext';
import { LocaleProvider } from './state/LocaleContext';
import { RadioProvider } from './state/RadioContext';
import { SessionProvider } from './state/SessionContext';

export const RuntimeProviders = () => (
  <LocaleProvider>
    <SessionProvider>
      <CatalogProvider>
        <RadioProvider>
          <App />
        </RadioProvider>
      </CatalogProvider>
    </SessionProvider>
  </LocaleProvider>
);
