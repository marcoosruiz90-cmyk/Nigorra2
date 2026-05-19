import React from 'react';

export default function Home({
  username,
  setUsername,
  avatar,
  setAvatar,
  roomCodeInput,
  setRoomCodeInput,
  handleCrearSala,
  handleUnirseSala,
  handleVerLeaderboard,
  isConfigured
}) {
  return (
    <section className="view active">
      {!isConfigured && (
        <div className="card hero-card" style={{ border: '2px solid var(--neon-pink)', background: 'rgba(20, 5, 5, 0.9)' }}>
          <h3 style={{ color: 'var(--neon-pink)', fontFamily: 'var(--font-title)', marginBottom: '0.5rem' }}>🔌 Base de Datos Pendiente</h3>
          <p>Revisa el archivo <code>.env</code> en la carpeta <code>cyber-royale</code> y asegúrate de rellenar las claves de Supabase para que funcione la conexión.</p>
        </div>
      )}

      <div className="card glassmorphic hero-card">
        <h2>BATTLE ROYALE EN <span className="text-gradient">TIEMPO REAL</span></h2>
        <p className="subtitle">Mueve a tu personaje en una rejilla cyberpunk, recoge armas láser legendarias y elimina a tus compañeros de clase en vivo.</p>

        <div className="setup-section">
          <div className="input-group">
            <label>Elige tu Cyber-Nickname</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Introduce tu alias..."
              maxLength={15}
              disabled={!isConfigured}
            />
          </div>

          <div className="avatar-selector">
            <span className="label-avatar">Elige tu Avatar</span>
            <div className="avatar-options">
              {['🦊', '🐱', '👾', '🦁', '🦉', '🤖'].map(emoji => (
                <button
                  key={emoji}
                  className={`avatar-btn ${avatar === emoji ? 'selected' : ''}`}
                  onClick={() => setAvatar(emoji)}
                  disabled={!isConfigured}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="actions-grid">
          <button
            className="btn btn-primary"
            onClick={handleCrearSala}
            disabled={!isConfigured}
          >
            👑 Crear Arena
          </button>

          <div className="join-box">
            <input
              type="text"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              placeholder="CÓDIGO DE ARENA"
              maxLength={9}
              disabled={!isConfigured}
            />
            <button
              className="btn btn-secondary"
              onClick={handleUnirseSala}
              disabled={!isConfigured}
            >
              🚀 Unirse a Arena
            </button>
          </div>
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button className="btn btn-secondary" style={{ width: '100%', borderStyle: 'dashed' }} onClick={handleVerLeaderboard}>
            🏆 Ver Ránking de Ciber-Soldados
          </button>
        </div>
      </div>
    </section>
  );
}
