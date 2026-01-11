import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { RadioProvider } from './state/RadioContext';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RadioProvider>
      <App />
    </RadioProvider>
  </React.StrictMode>
);
