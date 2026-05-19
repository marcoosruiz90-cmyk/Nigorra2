import React from 'react';

export default function Lobby({
  room,
  players,
  currentUser,
  handleIniciarPartida,
  handleSalirPartida
}) {
  return (
    <section className="view active">
      <div className="card glassmorphic lobby-card">
        <div className="lobby-header">
          <div className="room-code-section">
            <span className="room-label">Código de la Arena</span>
            <div className="room-code-display">
              <h2>{room.id}</h2>
              <button
                className="btn-copy"
                onClick={() => {
                  navigator.clipboard.writeText(room.id);
                  alert('¡Código copiado al portapapeles!');
                }}
              >
                📋
              </button>
            </div>
          </div>

          <div className="lobby-status-pill">
            <span className="pulse-dot"></span>
            <span>Esperando combatientes...</span>
          </div>
        </div>

        <div className="players-panel">
          <h3>Soldados en el Lobby ({players.length})</h3>
          <div className="players-list">
            {players.map(p => (
              <div key={p.id} className={`player-item ${p.es_host ? 'is-host' : ''}`}>
                <span className="item-avatar">{p.avatar}</span>
                <span className="item-name">{p.nombre}</span>
                {p.es_host && <span className="host-crown">Líder 👑</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="lobby-actions">
          {currentUser.esHost ? (
            <button
              className="btn btn-primary"
              onClick={handleIniciarPartida}
              disabled={players.length < 1}
            >
              🔥 Iniciar Battle Royale
            </button>
          ) : (
            <div className="lobby-waiting-msg">
              <span className="loading-spinner"></span>
              <p>Esperando a que el Líder comience el combate táctico...</p>
            </div>
          )}
          <button className="btn btn-danger" onClick={handleSalirPartida}>
            Abandonar Lobby
          </button>
        </div>
      </div>
    </section>
  );
}
