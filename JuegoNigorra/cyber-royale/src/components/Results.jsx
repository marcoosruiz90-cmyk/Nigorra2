import React from 'react';

export default function Results({
  players,
  getGanador,
  handleVolverHome
}) {
  return (
    <section className="view active">
      <div className="card glassmorphic results-card">
        <h2>🏆 BATTLE ROYALE COMPLETADO 🏆</h2>
        <p className="subtitle">Un único ciber-soldado ha prevalecido y conquistado la arena digital de Nigorra.</p>

        <span className="crown-victory">👑</span>

        <div className="winner-banner">
          <p style={{ color: 'var(--neon-yellow)', textTransform: 'uppercase', fontFamily: 'var(--font-title)', fontSize: '0.9rem', letterSpacing: '1px' }}>¡VICTORIA MAGISTRAL!</p>
          <h3 className="winner-name">{getGanador()?.nombre}</h3>
          <div className="winner-stats">
            <span>Avatar: {getGanador()?.avatar}</span>
            <span>Bajas totales: 💀 {getGanador()?.bajas}</span>
          </div>
        </div>

        <button className="btn btn-primary btn-glow" style={{ width: '100%' }} onClick={handleVolverHome}>
          Volver al Centro de Control
        </button>
      </div>
    </section>
  );
}
