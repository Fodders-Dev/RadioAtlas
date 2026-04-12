import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { LocaleProvider } from './state/LocaleContext';
import { RadioProvider } from './state/RadioContext';
import { SessionProvider } from './state/SessionContext';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <LocaleProvider>
      <SessionProvider>
        <RadioProvider>
          <App />
        </RadioProvider>
      </SessionProvider>
    </LocaleProvider>
  </React.StrictMode>
);
