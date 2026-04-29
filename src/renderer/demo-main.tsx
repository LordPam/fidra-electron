import React from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp } from './demo/DemoApp';
import { createDemoApi } from './demo/mock-api';
import './styles/globals.css';

window.api = createDemoApi();

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <DemoApp />
  </React.StrictMode>
);
