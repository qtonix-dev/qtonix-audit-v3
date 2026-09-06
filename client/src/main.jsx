import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import Admin from './Admin.jsx';
import HrApp from './HrApp.jsx';
import TvDisplay from './TvDisplay.jsx';
import './index.css';

// The office TV display works on any domain (people.qtonix.com, crmnest.com…).
// It must short-circuit BEFORE the domain-based app routing below, otherwise the
// HRMS root would swallow /tv/* and show the dashboard instead of the display.
const TV_SEG = (typeof window !== 'undefined' && window.location.pathname.startsWith('/tv/'))
  ? window.location.pathname.replace(/^\/tv\//, '').split('/')[0].toLowerCase() : '';

// On the HRMS domain (people.qtonix.com) the server sets window.__SURFACE__ =
// "hrms" and serves the HR app at the clean root — so URLs are /dashboard, not
// /hr/dashboard. Everywhere else the HR app stays under /hr/*.
const HRMS_ROOT = typeof window !== 'undefined' && window.__SURFACE__ === 'hrms';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {(TV_SEG === 'company' || TV_SEG === 'sales') ? (
      <TvDisplay kind={TV_SEG} />
    ) : (
    <BrowserRouter>
      {HRMS_ROOT ? (
        <Routes>
          <Route path="/*" element={<HrApp />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="/hr/*" element={<HrApp />} />
          <Route path="/*" element={<App />} />
        </Routes>
      )}
    </BrowserRouter>
    )}
  </React.StrictMode>
);
