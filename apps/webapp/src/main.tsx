import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { LocaleProvider } from './state/LocaleContext';
import { RadioProvider } from './state/RadioContext';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <LocaleProvider>
      <RadioProvider>
        <App />
      </RadioProvider>
    </LocaleProvider>
  </React.StrictMode>
);
