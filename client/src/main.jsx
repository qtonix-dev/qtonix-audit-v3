import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import Admin from './Admin.jsx';
import HrApp from './HrApp.jsx';
import './index.css';

// On the HRMS domain (people.qtonix.com) the server sets window.__SURFACE__ =
// "hrms" and serves the HR app at the clean root — so URLs are /dashboard, not
// /hr/dashboard. Everywhere else the HR app stays under /hr/*.
const HRMS_ROOT = typeof window !== 'undefined' && window.__SURFACE__ === 'hrms';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
