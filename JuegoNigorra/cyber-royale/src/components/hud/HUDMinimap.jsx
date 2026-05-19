import React from 'react';

export default function HUDMinimap({
  room,
  players,
  currentUser,
  localPos,
  lootBoxes,
  handleSalirPartida
}) {
  return (
    <div className="hud-top-right">
      {/* Minimapa Táctico 2D */}
      <div className="hud-minimap">
        {/* Storm Safe Area on Minimap */}
        {room && (
          <div 
            className="minimap-storm-overlay"
            style={{
              width: `${room.tormenta_radio * 10.0}%`,
              height: `${room.tormenta_radio * 10.0}%`
            }}
          />
        )}
        
        {/* Cajas de botín en el minimapa */}
        {lootBoxes.filter(c => !c.recogida).map(c => (
          <div 
            key={c.id} 
            className="minimap-loot-dot" 
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          />
        ))}

        {/* Jugadores en el minimapa */}
        {players.map(p => {
          if (p.eliminado) return null;
          const isMe = p.id === currentUser.id;
          const pos = isMe ? localPos : { x: p.x, y: p.y };
          return (
            <div 
              key={p.id} 
              className={`minimap-player-dot ${isMe ? 'me' : ''}`}
              data-id={p.id}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            />
          );
        })}
      </div>

      {/* Contador de Kills */}
      <div className="hud-kills-badge">
        <span className="kills-icon">💀</span>
        <span>{currentUser.bajas} BAJAS</span>
      </div>

      {/* Botón de Abandonar Sala */}
      <button className="hud-exit-btn" onClick={handleSalirPartida}>
        SALIR DE LA ARENA
      </button>
    </div>
  );
}
