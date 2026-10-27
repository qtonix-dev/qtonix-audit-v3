import React from 'react';

// App-wide error boundary. A render-time exception anywhere below it is caught
// here and shown as a readable panel with a Reload button, instead of React
// unmounting everything and leaving a blank white screen (the exact symptom
// reported on the admin API-keys save). The error text + stack are also logged
// to the console so the specific failing line is always visible in DevTools.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the full detail in the console for debugging.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = (this.state.error && (this.state.error.message || String(this.state.error))) || 'Unexpected error';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 24, fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 28, boxShadow: '0 10px 30px rgba(2,6,23,.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>⚠️</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0A0E28', marginBottom: 6 }}>Something went wrong on this screen</div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 18 }}>
            The page hit an error and stopped rendering. Your data is safe — reloading usually fixes it. If it keeps happening, share this message with the team:
          </div>
          <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 10px', marginBottom: 18, wordBreak: 'break-word', textAlign: 'left' }}>
            {msg}
          </div>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)', color: '#fff', border: 0, borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
