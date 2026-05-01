import App from './App';
import { CatalogProvider } from './state/CatalogContext';
import { LocaleProvider } from './state/LocaleContext';
import { RadioProvider } from './state/RadioContext';
import { SessionProvider } from './state/SessionContext';
import { ThemeProvider } from './state/ThemeContext';

export const RuntimeProviders = () => (
  <LocaleProvider>
    <SessionProvider>
      <CatalogProvider>
        <ThemeProvider>
          <RadioProvider>
            <App />
          </RadioProvider>
        </ThemeProvider>
      </CatalogProvider>
    </SessionProvider>
  </LocaleProvider>
);
