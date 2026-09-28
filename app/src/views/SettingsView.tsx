import { useEffect, useState } from 'react';
import { useSessionStore } from '../session/store';
import { useThemeStore, getSkinsForMode } from '../theme/ThemeProvider';
import { MODES } from '../theme/tokens';
import { MAP_METHODS, rendererForMode, type MapMethod } from '../map/renderer';
import { useMapStore } from '../map/store';

const MOTION_OPTIONS = ['system', 'reduced', 'full'] as const;

export function SettingsView() {
  const config = useSessionStore((s) => s.config);
  const connection = useSessionStore((s) => s.connection);
  const error = useSessionStore((s) => s.error);
  const setConfig = useSessionStore((s) => s.setConfig);

  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [token, setToken] = useState(config.token);

  useEffect(() => {
    setBaseUrl(config.baseUrl);
    setToken(config.token);
  }, [config.baseUrl, config.token]);

  const motion = useThemeStore((s) => s.motion);
  const setMotion = useThemeStore((s) => s.setMotion);
  const skinByMode = useThemeStore((s) => s.skinByMode);
  const setSkin = useThemeStore((s) => s.setSkin);
  const methodByMode = useMapStore((s) => s.methodByMode);
  const setMethodForMode = useMapStore((s) => s.setMethodForMode);

  function persistConfig() {
    setConfig({ baseUrl, token });
  }

  function handleConnect() {
    persistConfig();
    void useSessionStore.getState().connect();
  }

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h2>Server</h2>
        <label className="settings-row">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={persistConfig} />
        </label>
        <label className="settings-row">
          <span>Token</span>
          <input
            value={token}
            type="password"
            onChange={(e) => setToken(e.target.value)}
            onBlur={persistConfig}
          />
        </label>
        <div className="settings-actions">
          {connection === 'connected' ? (
            <button type="button" onClick={() => void useSessionStore.getState().disconnect()}>
              Disconnect
            </button>
          ) : (
            <button type="button" onClick={handleConnect}>
              Connect
            </button>
          )}
          <span className={`connection-status connection-status-${connection}`}>{connection}</span>
        </div>
        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="settings-section">
        <h2>Skins</h2>
        {MODES.map((m) => (
          <label key={m.id} className="settings-row">
            <span>{m.label}</span>
            <select value={skinByMode[m.id]} onChange={(e) => setSkin(m.id, e.target.value)}>
              {getSkinsForMode(m.id).map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {skin.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h2>Map style</h2>
        {MODES.map((m) => {
          const defaultMethod = rendererForMode(m.id);
          const current = rendererForMode(m.id, methodByMode);
          const blurb = MAP_METHODS.find((method) => method.id === current)?.blurb;
          return (
            <div key={m.id}>
              <label className="settings-row">
                <span>{m.label}</span>
                <select
                  value={current}
                  onChange={(e) => {
                    const next = e.target.value as MapMethod;
                    setMethodForMode(m.id, next === defaultMethod ? null : next);
                  }}
                >
                  {MAP_METHODS.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.label}
                      {method.id === defaultMethod ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {blurb && <p className="muted">{blurb}</p>}
            </div>
          );
        })}
      </section>

      <section className="settings-section">
        <h2>Motion</h2>
        <div className="settings-radio-group">
          {MOTION_OPTIONS.map((opt) => (
            <label key={opt} className="settings-radio">
              <input
                type="radio"
                name="motion"
                value={opt}
                checked={motion === opt}
                onChange={() => setMotion(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
