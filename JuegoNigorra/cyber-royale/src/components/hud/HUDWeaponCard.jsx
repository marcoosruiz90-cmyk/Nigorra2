import React from 'react';

export default function HUDWeaponCard({ currentUser }) {
  return (
    <div className="hud-bottom-left">
      <div className="hud-weapon-card">
        <div className="hud-weapon-icon">
          {currentUser.arma_tipo === 'ninguna' && '🥋'}
          {currentUser.arma_tipo === 'pistola' && '🔫'}
          {currentUser.arma_tipo === 'escopeta' && '🔥'}
          {currentUser.arma_tipo === 'sniper' && '⚡'}
        </div>
        <div className="hud-weapon-details">
          <span className="hud-weapon-label">ARMAMENTO DISPONIBLE</span>
          <span className="hud-weapon-name">
            {currentUser.arma_tipo === 'ninguna' ? 'MANOS LIBRES' : currentUser.arma_tipo.toUpperCase()}
          </span>
          <span className="hud-weapon-ammo">
            {currentUser.arma_tipo === 'ninguna' ? 'SIN MUNICIÓN' : `${currentUser.arma_municion} BALAS`}
          </span>
        </div>
      </div>
    </div>
  );
}
