import { useState, useEffect, useRef } from 'react';
import {
  supabase,
  isConfigured,
  crearSala,
  unirseASala,
  iniciarPartida,
  moverJugador,
  disparar,
  contraerTormenta,
  abandonarSala,
  obtenerLeaderboard
} from './supabase';

export default function App() {
  // ==========================================
  // ESTADOS PRINCIPALES
  // ==========================================
  const [view, setView] = useState('home'); // home, lobby, game, results
  const [username, setUsername] = useState(() => {
    const nicknames = ['Hack', 'Viper', 'Zero', 'Neo', 'Trinity', 'Cypher', 'Blade', 'Pixel', 'Storm'];
    return nicknames[Math.floor(Math.random() * nicknames.length)] + Math.floor(Math.random() * 90 + 10);
  });
  const [avatar, setAvatar] = useState('🐱');
  const [roomCodeInput, setRoomCodeInput] = useState('');

  // Estados de Sala y Jugadores
  const [currentUser, setCurrentUser] = useState({ id: null, nombre: '', avatar: '', esHost: false, x: 0, y: 0, vida: 100, escudo: 50, arma_tipo: 'ninguna', arma_municion: 0, eliminado: false, bajas: 0 });
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [lootBoxes, setLootBoxes] = useState([]);

  // Efectos Visuales Especiales (Láser y Alertas)
  const [laserHits, setLaserHits] = useState([]); // Array de {x, y, color}
  const [stormWarning, setStormWarning] = useState(false);
  const [stormCountdown, setStormCountdown] = useState(15);

  // Leaderboard Modal
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Referencias de Realtime
  const roomSubRef = useRef(null);
  const playersSubRef = useRef(null);
  const lootSubRef = useRef(null);
  const stormIntervalRef = useRef(null);
  const movementCooldownRef = useRef(false);

  // ==========================================
  // ESCUCHA DE CANALES EN TIEMPO REAL
  // ==========================================

  const refrescarJugadores = async (salaId) => {
    if (!supabase || !salaId) return;
    const { data } = await supabase
      .from('cr_jugadores')
      .select('*')
      .eq('sala_id', salaId)
      .order('eliminado', { ascending: true })
      .order('bajas', { ascending: false });

    const listado = data || [];
    setPlayers(listado);

    // Sincronizar mis propias estadísticas locales en vivo desde la BD
    const yo = listado.find(p => p.id === currentUser.id);
    if (yo) {
      setCurrentUser(prev => ({
        ...prev,
        x: yo.x,
        y: yo.y,
        vida: yo.vida,
        escudo: yo.escudo,
        arma_tipo: yo.arma_tipo,
        arma_municion: yo.arma_municion,
        eliminado: yo.eliminado,
        bajas: yo.bajas
      }));
    }
  };

  const refrescarBotin = async (salaId) => {
    if (!supabase || !salaId) return;
    const { data } = await supabase
      .from('cr_cajas')
      .select('*')
      .eq('sala_id', salaId)
      .eq('recogida', false);

    setLootBoxes(data || []);
  };

  useEffect(() => {
    if (!room?.id) return;

    desuscribirCanales();

    const salaId = room.id;

    // 1. Canal de la Sala (Estado general, radio de la tormenta)
    roomSubRef.current = supabase
      .channel(`cr_room_${salaId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'cr_salas',
        filter: `id=eq.${salaId}`
      }, (payload) => {
        const nuevaSala = payload.new;
        setRoom(nuevaSala);

        if (nuevaSala.estado === 'jugando' && view === 'lobby') {
          setView('game');
        } else if (nuevaSala.estado === 'terminado') {
          setView('results');
        }
      })
      .subscribe();

    // 2. Canal de los Jugadores (Posiciones, vidas, disparos en tiempo real)
    playersSubRef.current = supabase
      .channel(`cr_players_${salaId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cr_jugadores',
        filter: `sala_id=eq.${salaId}`
      }, (payload) => {
        refrescarJugadores(salaId);

        // Detectar si un oponente ha disparado para pintar el láser de color
        if (payload.eventType === 'UPDATE') {
          const jug = payload.new;
          if (jug.id !== currentUser.id && jug.ultima_accion === 'shoot') {
            // El oponente disparó
            triggerOponenteLaser(jug);
          }
        }
      })
      .subscribe();

    // 3. Canal de Cajas de Botín (Cuándo son recogidas)
    lootSubRef.current = supabase
      .channel(`cr_loot_${salaId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cr_cajas',
        filter: `sala_id=eq.${salaId}`
      }, () => {
        refrescarBotin(salaId);
      })
      .subscribe();

    // Cargas iniciales
    refrescarJugadores(salaId);
    refrescarBotin(salaId);

    return () => {
      desuscribirCanales();
    };
  }, [room?.id, currentUser.id, view]);

  const desuscribirCanales = () => {
    if (roomSubRef.current) roomSubRef.current.unsubscribe();
    if (playersSubRef.current) playersSubRef.current.unsubscribe();
    if (lootSubRef.current) lootSubRef.current.unsubscribe();
  };

  // ==========================================
  // CONTROLES DE LA TORMENTA (SOLO HOST)
  // ==========================================
  useEffect(() => {
    if (view !== 'game' || !currentUser.esHost || !room) {
      clearInterval(stormIntervalRef.current);
      return;
    }

    setStormCountdown(15);

    stormIntervalRef.current = setInterval(async () => {
      setStormCountdown(prev => {
        if (prev <= 1) {
          // La tormenta se contrae
          setStormWarning(true);
          setTimeout(() => setStormWarning(false), 3000);
          
          contraerTormenta(room.id, room.tormenta_radio).catch(console.error);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(stormIntervalRef.current);
  }, [view, currentUser.esHost, room?.tormenta_radio]);

  // ==========================================
  // SISTEMA DE CONTROLES DE TECLADO (MOVERSE Y DISPARAR)
  // ==========================================
  useEffect(() => {
    if (view !== 'game' || currentUser.eliminado) return;

    const handleKeyDown = (e) => {
      // Evitar scroll de pantalla al jugar con las flechas
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      // A. Controles de Movimiento (Flechas o WASD de dirección)
      if (['ArrowUp', 'w', 'W'].includes(e.key)) handleMover('UP');
      else if (['ArrowDown', 's', 'S'].includes(e.key)) handleMover('DOWN');
      else if (['ArrowLeft', 'a', 'A'].includes(e.key)) handleMover('LEFT');
      else if (['ArrowRight', 'd', 'D'].includes(e.key)) handleMover('RIGHT');

      // B. Controles de Disparo (IJKL o teclado secundario para apuntar láser)
      else if (['i', 'I'].includes(e.key)) handleDisparar('UP');
      else if (['k', 'K'].includes(e.key)) handleDisparar('DOWN');
      else if (['j', 'J'].includes(e.key)) handleDisparar('LEFT');
      else if (['l', 'L'].includes(e.key)) handleDisparar('RIGHT');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, currentUser.x, currentUser.y, currentUser.arma_tipo, currentUser.arma_municion, currentUser.eliminado]);

  // Cooldown de movimiento (0.35s) para evitar abusos y spam
  const handleMover = async (dir) => {
    if (movementCooldownRef.current || currentUser.eliminado) return;

    let targetX = currentUser.x;
    let targetY = currentUser.y;

    if (dir === 'UP') targetY = Math.max(0, currentUser.y - 1);
    else if (dir === 'DOWN') targetY = Math.min(9, currentUser.y + 1);
    else if (dir === 'LEFT') targetX = Math.max(0, currentUser.x - 1);
    else if (dir === 'RIGHT') targetX = Math.min(9, currentUser.x + 1);

    // Si no ha cambiado de casilla, salir
    if (targetX === currentUser.x && targetY === currentUser.y) return;

    movementCooldownRef.current = true;
    setTimeout(() => {
      movementCooldownRef.current = false;
    }, 280);

    try {
      await moverJugador(currentUser.id, targetX, targetY, room.id);
    } catch (err) {
      console.error('Error al mover:', err);
    }
  };

  const handleDisparar = async (direccion) => {
    if (currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0 || currentUser.eliminado) {
      return;
    }

    try {
      // Disparar y obtener la lista de celdas afectadas
      const celdasAfectadas = await disparar(
        currentUser.id,
        room.id,
        currentUser.x,
        currentUser.y,
        direccion,
        currentUser.arma_tipo,
        currentUser.bajas
      );

      // Pintar el rayo láser de color cyan para mí
      if (celdasAfectadas && celdasAfectadas.length > 0) {
        const hits = celdasAfectadas.map(c => ({ x: c.x, y: c.y, color: 'cyan' }));
        setLaserHits(hits);
        setTimeout(() => setLaserHits([]), 400);
      }
    } catch (err) {
      console.error('Error al disparar:', err);
    }
  };

  // Pintar el rayo láser rojo de un enemigo
  const triggerOponenteLaser = (oponente) => {
    const { x, y, arma_tipo } = oponente;
    // La dirección del disparo se puede aproximar o rastrear, pero la calculamos
    // o simplemente flasheamos el entorno de su disparo
    let celdas = [];
    // Flasheo simple alrededor del oponente para denotar su disparo
    for (let i = -2; i <= 2; i++) {
      if (i !== 0) {
        celdas.push({ x: x + i, y, color: 'pink' });
        celdas.push({ x, y: y + i, color: 'pink' });
      }
    }
    const hitsFiltrados = celdas.filter(c => c.x >= 0 && c.x < 10 && c.y >= 0 && c.y < 10);
    setLaserHits(hitsFiltrados);
    setTimeout(() => setLaserHits([]), 400);
  };

  // ==========================================
  // OPERACIONES DE SALAS
  // ==========================================

  const handleCrearSala = async () => {
    const nombre = username.trim();
    if (!nombre) {
      alert('Escribe un Nickname válido.');
      return;
    }

    try {
      const { salaId, hostJugador } = await crearSala(nombre, avatar);
      setCurrentUser({
        id: hostJugador.id,
        nombre: nombre,
        avatar: avatar,
        esHost: true,
        x: 0,
        y: 0,
        vida: 100,
        escudo: 50,
        arma_tipo: 'ninguna',
        arma_municion: 0,
        eliminado: false,
        bajas: 0
      });
      setRoom({
        id: salaId,
        host_name: nombre,
        estado: 'lobby',
        tormenta_radio: 10,
        tormenta_centro_x: 4,
        tormenta_centro_y: 4
      });
      setView('lobby');
    } catch (err) {
      console.error(err);
      alert('Error al crear sala: ' + err.message);
    }
  };

  const handleUnirseSala = async () => {
    const nombre = username.trim();
    const codigo = roomCodeInput.trim();

    if (!nombre) {
      alert('Escribe tu Nickname.');
      return;
    }
    if (!codigo || codigo.length < 4) {
      alert('Escribe un código de sala válido.');
      return;
    }

    try {
      const { sala, jugador } = await unirseASala(codigo, nombre, avatar);
      setCurrentUser({
        id: jugador.id,
        nombre: nombre,
        avatar: avatar,
        esHost: false,
        x: jugador.x,
        y: jugador.y,
        vida: 100,
        escudo: 50,
        arma_tipo: 'ninguna',
        arma_municion: 0,
        eliminado: false,
        bajas: 0
      });
      setRoom(sala);
      setView('lobby');
    } catch (err) {
      console.error(err);
      alert('Error al unirse: ' + err.message);
    }
  };

  const handleIniciarPartida = async () => {
    if (!currentUser.esHost || !room) return;
    try {
      await iniciarPartida(room.id);
      setView('game');
    } catch (err) {
      console.error(err);
      alert('⚠️ Error de Base de Datos al iniciar partida: ' + err.message);
    }
  };

  const handleSalirPartida = async () => {
    if (confirm('¿Quieres salir de la arena de juego?')) {
      clearInterval(stormIntervalRef.current);
      desuscribirCanales();
      if (currentUser.id) {
        await abandonarSala(currentUser.id).catch(console.error);
      }
      setView('home');
    }
  };

  // ==========================================
  // MODALES
  // ==========================================
  const handleVerLeaderboard = async () => {
    setShowLeaderboard(true);
    setLeaderboardLoading(true);
    try {
      const data = await obtenerLeaderboard();
      setGlobalLeaderboard(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  // ==========================================
  // RENDERIZADO DEL COMPONENTE
  // ==========================================

  // Obtener al jugador ganador al final de la partida
  const getGanador = () => {
    const superviviente = players.find(p => !p.eliminado);
    return superviviente || players[0];
  };

  // Renderizar cada celda del tablero
  const renderTablero = () => {
    const celdas = [];
    const centroX = 4;
    const centroY = 4;

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        // A. Comprobar si la celda está fuera del radio de la tormenta
        const dx = Math.abs(x - centroX);
        const dy = Math.abs(y - centroY);
        const dist = Math.max(dx, dy);
        const estaEnTormenta = room ? dist > room.tormenta_radio : false;

        // B. Comprobar si hay un jugador en la celda
        const jugadorEnCelda = players.find(p => p.x === x && p.y === y && !p.eliminado);

        // C. Comprobar si hay botín en la celda
        const cajaEnCelda = lootBoxes.find(c => c.x === x && c.y === y);

        // D. Comprobar si tiene flash de impacto láser
        const hitInfo = laserHits.find(h => h.x === x && h.y === y);
        let flashClass = '';
        if (hitInfo) {
          flashClass = hitInfo.color === 'cyan' ? 'laser-hit-cyan' : 'laser-hit-pink';
        }

        celdas.push(
          <div
            key={`${x}-${y}`}
            className={`grid-cell ${estaEnTormenta ? 'storm-zone' : ''} ${flashClass}`}
          >
            {jugadorEnCelda && (
              <span className={`entity entity-player ${jugadorEnCelda.id === currentUser.id ? 'me' : ''}`}>
                {jugadorEnCelda.avatar}
              </span>
            )}
            {!jugadorEnCelda && cajaEnCelda && (
              <span className="entity entity-loot">
                {cajaEnCelda.tipo === 'botiquin' && '❤️'}
                {cajaEnCelda.tipo === 'escudo' && '🛡️'}
                {cajaEnCelda.tipo === 'pistola' && '🔫'}
                {cajaEnCelda.tipo === 'escopeta' && '🔥'}
                {cajaEnCelda.tipo === 'sniper' && '⚡'}
              </span>
            )}
          </div>
        );
      }
    }
    return celdas;
  };

  return (
    <div id="app-container">
      {/* Fondo de Glowing Blobs */}
      <div className="blob-container">
        <div className="blob blob-purple"></div>
        <div className="blob blob-cyan"></div>
        <div className="blob blob-pink"></div>
      </div>

      {/* CABECERA */}
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">⚔️</span>
          <h1>CYBER<span className="highlight">ROYALE</span></h1>
        </div>
        {view !== 'home' && currentUser.id && (
          <div className="player-badge">
            <span className="badge-avatar">{currentUser.avatar}</span>
            <span className="badge-name">{currentUser.nombre}</span>
          </div>
        )}
      </header>

      {/* ==========================================
         VISTA 1: INICIO (HOME)
         ========================================== */}
      {view === 'home' && (
        <section className="view active">
          {!isConfigured && (
            <div className="card hero-card" style={{ border: '2px solid var(--neon-pink)', background: 'rgba(20, 5, 5, 0.9)' }}>
              <h3 style={{ color: 'var(--neon-pink)', fontFamily: 'var(--font-title)', marginBottom: '0.5rem' }}>🔌 Base de Datos Pendiente</h3>
              <p>Revisa el archivo <code>.env</code> en la carpeta <code>cyber-royale</code> y asegúrate de rellenar las claves de Supabase para que funcione la conexión.</p>
            </div>
          )}

          <div className="card glassmorphic hero-card">
            <h2>BATTLE ROYALE EN <span className="text-gradient">TIEMPO REAL</span></h2>
            <p className="subtitle">Mueve a tu personaje en una rejilla cyberpunk, recoge armas láser legendarias y elimina a tus compañeros de clase en vivo.</p>

            <div className="setup-section">
              <div className="input-group">
                <label>Elige tu Cyber-Nickname</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Introduce tu alias..."
                  maxLength={15}
                  disabled={!isConfigured}
                />
              </div>

              <div className="avatar-selector">
                <span className="label-avatar">Elige tu Avatar</span>
                <div className="avatar-options">
                  {['🦊', '🐱', '👾', '🦁', '🦉', '🤖'].map(emoji => (
                    <button
                      key={emoji}
                      className={`avatar-btn ${avatar === emoji ? 'selected' : ''}`}
                      onClick={() => setAvatar(emoji)}
                      disabled={!isConfigured}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="actions-grid">
              <button
                className="btn btn-primary"
                onClick={handleCrearSala}
                disabled={!isConfigured}
              >
                👑 Crear Arena
              </button>

              <div className="join-box">
                <input
                  type="text"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="CÓDIGO DE ARENA"
                  maxLength={9}
                  disabled={!isConfigured}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleUnirseSala}
                  disabled={!isConfigured}
                >
                  🚀 Unirse a Arena
                </button>
              </div>
            </div>

            <div style={{ marginTop: '2rem' }}>
              <button className="btn btn-secondary" style={{ width: '100%', borderStyle: 'dashed' }} onClick={handleVerLeaderboard}>
                🏆 Ver Ránking de Ciber-Soldados
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 2: LOBBY DE ESPERA
         ========================================== */}
      {view === 'lobby' && room && (
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
      )}

      {/* ==========================================
         VISTA 3: EN ARENA DE JUEGO (GAMEPLAY)
         ========================================== */}
      {view === 'game' && room && (
        <section className="view active">
          {stormWarning && (
            <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', background: 'var(--neon-pink)', color: '#fff', padding: '1rem 2rem', borderRadius: '8px', zIndex: 1000, fontFamily: 'var(--font-title)', fontWeight: 'bold', boxShadow: '0 0 20px var(--neon-pink)', textTransform: 'uppercase', letterSpacing: '2px', animation: 'pulse 1s infinite' }}>
              ⚠️ ¡La Tormenta de Datos se ha contraído! ⚠️
            </div>
          )}

          <div className="game-layout">
            <div className="game-main">
              {/* Barra Superior del Gameplay */}
              <div className="game-info-bar">
                <div className="storm-timer">
                  <span>⛈️ Tormenta en:</span>
                  <span className="storm-value">{currentUser.esHost ? `${stormCountdown}s` : 'Automático'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.9rem', color: '#8c8c9e' }}>Radio Seguro: </span>
                  <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>{room.tormenta_radio} celdas</span>
                </div>
                {currentUser.eliminado && (
                  <span className="spectator-indicator">👁️ MODO ESPECTADOR HACKER ACTIVO</span>
                )}
              </div>

              {/* El Tablero 10x10 */}
              <div className="arena-grid">
                {renderTablero()}
              </div>

              {/* Consola de Control de Estadísticas e Instrucciones */}
              <div className="tactical-console">
                <div className="status-vitals">
                  {/* Barra de Vida */}
                  <div className="stat-bar-container">
                    <div className="stat-bar-header">
                      <span className="bar-vida">❤️ Integridad Física</span>
                      <span>{currentUser.vida}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill fill-vida" style={{ width: `${currentUser.vida}%` }}></div>
                    </div>
                  </div>

                  {/* Barra de Escudo */}
                  <div className="stat-bar-container">
                    <div className="stat-bar-header">
                      <span className="bar-escudo">🛡️ Escudo Defensivo</span>
                      <span>{currentUser.escudo}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill fill-escudo" style={{ width: `${currentUser.escudo}%` }}></div>
                    </div>
                  </div>

                  {/* Instrucciones Rápidas */}
                  <div style={{ fontSize: '0.8rem', color: '#8c8c9e', marginTop: '0.25rem' }}>
                    💻 <strong>PC:</strong> Flechas/WASD para Moverse. Teclas <strong>IJKL</strong> para Disparar (Arriba, Izq, Abajo, Der).
                  </div>
                </div>

                {/* Armamento Actual */}
                <div className="status-weapon">
                  <span className="weapon-title">Armamento</span>
                  <span className="weapon-name">{currentUser.arma_tipo === 'ninguna' ? '🎴 Sin Armas' : currentUser.arma_tipo}</span>
                  <span className="weapon-ammo">
                    {currentUser.arma_tipo === 'ninguna' ? '0' : `${currentUser.arma_municion} balas`}
                  </span>
                </div>
              </div>

              {/* Controles táctiles en pantalla para móviles */}
              <div className="on-screen-controls">
                {/* D-Pad de Movimiento */}
                <div className="d-pad">
                  <button className="d-btn d-up" onClick={() => handleMover('UP')}>▲</button>
                  <button className="d-btn d-left" onClick={() => handleMover('LEFT')}>◀</button>
                  <button className="d-btn d-right" onClick={() => handleMover('RIGHT')}>▶</button>
                  <button className="d-btn d-down" onClick={() => handleMover('DOWN')}>▼</button>
                </div>

                {/* Action Pad de Disparo */}
                <div className="action-pad">
                  <span style={{ fontSize: '0.75rem', color: 'var(--neon-pink)', fontFamily: 'var(--font-title)', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center', marginBottom: '4px' }}>🎯 Direcciones de Disparo</span>
                  <div className="fire-pad-grid">
                    <button className="btn-fire-dir" onClick={() => handleDisparar('UP')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▲ Disparar</button>
                    <button className="btn-fire-dir" onClick={() => handleDisparar('DOWN')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▼ Disparar</button>
                    <button className="btn-fire-dir" onClick={() => handleDisparar('LEFT')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>◀ Disparar</button>
                    <button className="btn-fire-dir" onClick={() => handleDisparar('RIGHT')} disabled={currentUser.arma_tipo === 'ninguna' || currentUser.arma_municion <= 0}>▶ Disparar</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Clasificación lateral en vivo */}
            <aside className="game-sidebar card glassmorphic">
              <h3>Combatientes Vivos ({players.filter(p => !p.eliminado).length})</h3>
              <div className="live-standings">
                {players.map(p => (
                  <div key={p.id} className={`standing-item ${p.id === currentUser.id ? 'me' : ''} ${p.eliminado ? 'eliminated' : ''}`}>
                    <div className="standing-left">
                      <span className="standing-avatar">{p.avatar}</span>
                      <span className="standing-name">{p.nombre}</span>
                      <span className="standing-kills">💀 {p.bajas}</span>
                    </div>
                    <div className="standing-right">
                      {p.eliminado ? (
                        <span className="skull-icon">💀 Muerto</span>
                      ) : (
                        <span className="hp-indicator">{p.vida} HP</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn btn-danger" style={{ marginTop: 'auto' }} onClick={handleSalirPartida}>
                Salir del Combate
              </button>
            </aside>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 4: RESULTADOS FINALES / VICTORIA
         ========================================== */}
      {view === 'results' && (
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

            <button className="btn btn-primary btn-glow" style={{ width: '100%' }} onClick={() => setView('home')}>
              Volver al Centro de Control
            </button>
          </div>
        </section>
      )}

      {/* ==========================================
         MODAL: RANKING DE CIBER-SOLDADOS
         ========================================== */}
      {showLeaderboard && (
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
      )}
    </div>
  );
}
