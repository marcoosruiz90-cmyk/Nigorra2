import React from 'react';

export default function Arena2D({
  room,
  players,
  currentUser,
  localPos,
  lootBoxes,
  laserHits,
  onMapClick
}) {
  return (
    <div className="arena-arena-2d full-screen" onClick={onMapClick}>
      {/* Superposición de la Tormenta de Datos en Full-screen */}
      {room && (
        <div 
          className="storm-safe-zone-overlay" 
          style={{
            width: `${room.tormenta_radio * 10.0}%`,
            height: `${room.tormenta_radio * 10.0}%`
          }}
        />
      )}

      {/* Cajas de Loot */}
      {lootBoxes.filter(c => !c.recogida).map(c => {
        let icon = '📦';
        let tierClass = 'tier-cyan';
        if (c.tipo === 'botiquin') { icon = '❤️'; tierClass = 'tier-medical'; }
        else if (c.tipo === 'escudo') { icon = '🛡️'; tierClass = 'tier-shield'; }
        else if (c.tipo === 'pistola') { icon = '🔫'; tierClass = 'tier-cyan'; }
        else if (c.tipo === 'escopeta') { icon = '💥'; tierClass = 'tier-epic'; }
        else if (c.tipo === 'sniper') { icon = '⚡'; tierClass = 'tier-legendary'; }
        
        return (
          <div 
            key={c.id} 
            className={`entity-loot-2d ${tierClass}`} 
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          >
            <div className="loot-hologram-ring"></div>
            <div className="loot-icon-wrapper">{icon}</div>
            <div className="loot-label">{c.tipo.toUpperCase()}</div>
          </div>
        );
      })}

      {/* Jugadores en Full-screen */}
      {players.map(p => {
        const isMe = p.id === currentUser.id;
        const pos = isMe ? localPos : { x: p.x, y: p.y };

        if (p.eliminado) return null;

        return (
          <div
            key={p.id}
            className={`entity-player-2d ${isMe ? 'me' : ''}`}
            data-id={p.id}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`
            }}
            title={p.nombre}
          >
            <div className="player-avatar-wrapper" style={{ display: 'inline-block', transition: 'transform 0.05s ease-out' }}>
              {p.avatar}
            </div>
          </div>
        );
      })}
    </div>
  );
}
