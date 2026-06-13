import React from 'react';
import Link from 'next/link';
import screensConfig from '../../public/config/screens.json';

type ScreenConfig = { screenId: string; screenName: string; contentId: string };

export default function Page() {
  const screens: ScreenConfig[] = screensConfig.screens;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0a',
        color: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '3rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: '640px', width: '100%', textAlign: 'center', marginBottom: '3rem' }}>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            margin: '0 0 1rem 0',
            background: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Signage Display Hub
        </h1>
        <p style={{ color: '#9ca3af', fontSize: '1.1rem', lineHeight: '1.6', margin: 0 }}>
          Select an active screen configuration below to launch its dedicated full-screen media player.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem', width: '100%', maxWidth: '640px' }}>
        {screens.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              backgroundColor: '#171717',
              borderRadius: '12px',
              border: '1px solid #262626',
              textAlign: 'center',
              color: '#737373',
            }}
          >
            No screens configured. Add entries to{' '}
            <code style={{ color: '#9ca3af' }}>public/config/screens.json</code> to get started.
          </div>
        ) : (
          screens.map((screen) => (
            <Link
              key={screen.screenId}
              href={`/${screen.screenId}`}
              style={{
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1.5rem',
                backgroundColor: '#171717',
                borderRadius: '12px',
                border: '1px solid #262626',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#ffffff', marginBottom: '0.25rem' }}>
                  {screen.screenName}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#737373' }}>
                  {screen.screenId}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    backgroundColor: '#10b981',
                    borderRadius: '50%',
                    boxShadow: '0 0 8px #10b981',
                  }}
                />
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#3b82f6' }}>
                  /{screen.screenId} →
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      <div style={{ marginTop: '4rem', color: '#404040', fontSize: '0.875rem' }}>
        Next.js 15 App Router • TypeScript
      </div>
    </div>
  );
}
