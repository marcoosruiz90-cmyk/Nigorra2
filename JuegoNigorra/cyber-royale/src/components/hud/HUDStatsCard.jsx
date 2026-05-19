import React from 'react';

export default function HUDStatsCard({ currentUser }) {
  return (
    <div className="hud-bottom-right">
      <div className="hud-stats-card">
        {/* Barra de Vida */}
        <div className="hud-stat-bar-container">
          <div className="hud-stat-bar-header">
            <span className="hud-bar-vida">❤️ INTEGRIDAD FÍSICA</span>
            <span>{currentUser.vida}%</span>
          </div>
          <div className="hud-progress-bar-bg">
            <div className="hud-progress-bar-fill fill-vida" style={{ width: `${currentUser.vida}%` }}></div>
          </div>
        </div>

        {/* Barra de Escudo */}
        <div className="hud-stat-bar-container" style={{ marginTop: '0.8rem' }}>
          <div className="hud-stat-bar-header">
            <span className="hud-bar-escudo">🛡️ ESCUDO DEFENSIVO</span>
            <span>{currentUser.escudo}%</span>
          </div>
          <div className="hud-progress-bar-bg">
            <div className="hud-progress-bar-fill fill-escudo" style={{ width: `${currentUser.escudo}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
