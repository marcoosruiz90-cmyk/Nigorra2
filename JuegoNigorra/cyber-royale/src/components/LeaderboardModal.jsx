import React from 'react';

export default function LeaderboardModal({
  leaderboardLoading,
  globalLeaderboard,
  setShowLeaderboard
}) {
  return (
    <div className="modal-overlay">
      <div className="card glassmorphic modal-content">
        <div className="modal-header">
          <h3>🏆 RÁNKING HISTÓRICO DE CIBER-SOLDADOS</h3>
          <button className="btn-close" onClick={() => setShowLeaderboard(false)}>×</button>
        </div>

        {leaderboardLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <span className="loading-spinner" style={{ width: '40px', height: '40px' }}></span>
            <p style={{ marginTop: '1rem', color: '#8c8c9e' }}>Hackeando base de datos...</p>
          </div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rango</th>
                <th>Ciber-Soldado</th>
                <th>Victorias</th>
                <th>Bajas</th>
                <th>Partidas</th>
              </tr>
            </thead>
            <tbody>
              {globalLeaderboard.map((item, idx) => (
                <tr key={item.id}>
                  <td className={idx === 0 ? 'rank-gold' : idx === 1 ? 'rank-silver' : idx === 2 ? 'rank-bronze' : ''}>
                    {idx + 1}º
                  </td>
                  <td style={{ fontFamily: 'var(--font-title)', fontWeight: 'bold' }}>{item.nombre}</td>
                  <td style={{ color: 'var(--neon-yellow)', fontWeight: 'bold' }}>🏆 {item.victorias}</td>
                  <td>💀 {item.bajas_totales}</td>
                  <td>🎮 {item.partidas_jugadas}</td>
                </tr>
              ))}
              {globalLeaderboard.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: '#8c8c9e' }}>Ningún registro encontrado. ¡Sé el primero en ganar!</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setShowLeaderboard(false)}>
          Cerrar Consola
        </button>
      </div>
    </div>
  );
}
