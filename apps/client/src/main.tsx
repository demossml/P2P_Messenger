import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './index.js';

const element = document.getElementById('root');
if (!element) {
  throw new Error('Root element #root is missing.');
}

createRoot(element).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
