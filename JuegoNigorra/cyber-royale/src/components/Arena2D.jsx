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
        if (c.tipo === 'botiquin') icon = '❤️';
        else if (c.tipo === 'escudo') icon = '🛡️';
        else if (c.tipo === 'pistola') icon = '🔫';
        else if (c.tipo === 'escopeta') icon = '🔥';
        else if (c.tipo === 'sniper') icon = '⚡';
        
        return (
          <div 
            key={c.id} 
            className="entity-loot-2d" 
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          >
            {icon}
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

      {/* Efectos de Láseres en 2D en Full-screen */}
      {laserHits.map((h, index) => {
        // h.angulo está en radianes, x e y están en % del tablero
        const style = {
          left: `${h.x}%`,
          top: `${h.y}%`,
          width: '130vmax', // Cruza por completo el viewport diagonalmente
          height: '4px',
          transform: `rotate(${h.angulo}rad)`,
          transformOrigin: 'left center',
          position: 'absolute'
        };
        return (
          <div
            key={index}
            className={`laser-line-2d ${h.color === 'pink' ? 'opponent' : ''}`}
            style={style}
          />
        );
      })}
    </div>
  );
}
