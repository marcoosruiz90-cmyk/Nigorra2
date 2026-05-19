import React from 'react';

export default function HUDPlayerBadge({ currentUser }) {
  return (
    <div className="hud-top-left">
      <div className="hud-player-badge">
        <span className="hud-avatar">{currentUser.avatar}</span>
        <span className="hud-name">{currentUser.nombre}</span>
      </div>
    </div>
  );
}
