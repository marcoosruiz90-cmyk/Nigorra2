import React from 'react';

export default function HUDMobileControls({
  currentUser,
  handleMoverTáctil,
  handleDisparar
}) {
  return (
    <div className="hud-mobile-controls">
      {/* D-Pad de Movimiento */}
      <div className="hud-d-pad">
        <button className="hud-d-btn d-up" onClick={() => handleMoverTáctil('UP')}>▲</button>
        <div className="hud-d-pad-mid">
          <button className="hud-d-btn d-left" onClick={() => handleMoverTáctil('LEFT')}>◀</button>
          <button className="hud-d-btn d-right" onClick={() => handleMoverTáctil('RIGHT')}>▶</button>
        </div>
        <button className="hud-d-btn d-down" onClick={() => handleMoverTáctil('DOWN')}>▼</button>
      </div>

      {/* Action Pad de Disparo */}
      <div className="hud-action-pad">
        <button className="hud-fire-btn" onClick={() => handleDisparar('UP')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▲</button>
        <div className="hud-fire-mid">
          <button className="hud-fire-btn" onClick={() => handleDisparar('LEFT')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>◀</button>
          <button className="hud-fire-btn" onClick={() => handleDisparar('RIGHT')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▶</button>
        </div>
        <button className="hud-fire-btn" onClick={() => handleDisparar('DOWN')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▼</button>
      </div>
    </div>
  );
}
