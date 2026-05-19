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
  const [currentUser, setCurrentUser] = useState({ id: null, nombre: '', avatar: '', esHost: false, x: 50, y: 50, vida: 100, escudo: 50, arma_tipo: 'ninguna', arma_municion: 0, eliminado: false, bajas: 0 });
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [lootBoxes, setLootBoxes] = useState([]);
  
  // Posición continua en tiempo real del jugador local (0% a 100%)
  const [localPos, setLocalPos] = useState({ x: 50, y: 50 });

  // Efectos Visuales Especiales (Láser y Alertas)
  const [laserHits, setLaserHits] = useState([]); // Array de {x, y, direccion, color}
  const [stormWarning, setStormWarning] = useState(false);
  const [stormCountdown, setStormCountdown] = useState(15);

  // Leaderboard Modal
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Referencias de Realtime y Loop de Juego Continuo
  const roomSubRef = useRef(null);
  const playersSubRef = useRef(null);
  const lootSubRef = useRef(null);
  const stormIntervalRef = useRef(null);
  const movementCooldownRef = useRef(false);
  const keysPressedRef = useRef({});
  const gameLoopRef = useRef(null);
  const lastSentPosRef = useRef({ x: 50, y: 50 });

  // Referencias optimizadas para evitar stutters de Garbage Collection y re-renderizados
  const currentUserRef = useRef(currentUser);
  const localPosRef = useRef(localPos);
  const roomRef = useRef(room);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    localPosRef.current = localPos;
  }, [localPos]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

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

    const yo = listado.find(p => p.id === currentUserRef.current.id);
    if (yo) {
      setCurrentUser(prev => {
        if (
          prev.vida === yo.vida &&
          prev.escudo === yo.escudo &&
          prev.arma_tipo === yo.arma_tipo &&
          prev.arma_municion === yo.arma_municion &&
          prev.eliminado === yo.eliminado &&
          prev.bajas === yo.bajas
        ) {
          return prev;
        }
        return {
          ...prev,
          x: yo.x,
          y: yo.y,
          vida: yo.vida,
          escudo: yo.escudo,
          arma_tipo: yo.arma_tipo,
          arma_municion: yo.arma_municion,
          eliminado: yo.eliminado,
          bajas: yo.bajas
        };
      });

      setLocalPos(prev => {
        if (Math.hypot(prev.x - yo.x, prev.y - yo.y) > 15) {
          lastSentPosRef.current = { x: yo.x, y: yo.y };
          return { x: yo.x, y: yo.y };
        }
        return prev;
      });
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
        const { eventType, new: newJug, old: oldJug } = payload;
        
        setPlayers(prev => {
          if (eventType === 'INSERT') {
            if (prev.some(p => p.id === newJug.id)) return prev;
            return [...prev, newJug];
          }
          if (eventType === 'UPDATE') {
            const actualizados = prev.map(p => p.id === newJug.id ? newJug : p);
            
            // Sincronizar mis propias estadísticas
            if (newJug.id === currentUserRef.current.id) {
              setCurrentUser(prevUser => {
                if (
                  prevUser.vida === newJug.vida &&
                  prevUser.escudo === newJug.escudo &&
                  prevUser.arma_tipo === newJug.arma_tipo &&
                  prevUser.arma_municion === newJug.arma_municion &&
                  prevUser.eliminado === newJug.eliminado &&
                  prevUser.bajas === newJug.bajas
                ) {
                  return prevUser;
                }
                return {
                  ...prevUser,
                  vida: newJug.vida,
                  escudo: newJug.escudo,
                  arma_tipo: newJug.arma_tipo,
                  arma_municion: newJug.arma_municion,
                  eliminado: newJug.eliminado,
                  bajas: newJug.bajas
                };
              });

              setLocalPos(prevPos => {
                if (Math.hypot(prevPos.x - newJug.x, prevPos.y - newJug.y) > 15) {
                  lastSentPosRef.current = { x: newJug.x, y: newJug.y };
                  return { x: newJug.x, y: newJug.y };
                }
                return prevPos;
              });
            }

            return actualizados;
          }
          if (eventType === 'DELETE') {
            return prev.filter(p => p.id === oldJug.id);
          }
          return prev;
        });

        // Detectar si un oponente ha disparado para pintar el láser de color
        if (eventType === 'UPDATE') {
          const jug = payload.new;
          if (jug.id !== currentUserRef.current.id && jug.ultima_accion && jug.ultima_accion.startsWith('shoot_')) {
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
      }, (payload) => {
        const { eventType, new: newCaja } = payload;
        if (eventType === 'UPDATE') {
          setLootBoxes(prev => {
            if (newCaja.recogida) {
              return prev.filter(c => c.id !== newCaja.id);
            }
            return prev.map(c => c.id === newCaja.id ? newCaja : c);
          });
        } else if (eventType === 'INSERT') {
          setLootBoxes(prev => {
            if (prev.some(c => c.id === newCaja.id)) return prev;
            return [...prev, newCaja];
          });
        }
      })
      .subscribe();

    // Cargas iniciales
    refrescarJugadores(salaId);
    refrescarBotin(salaId);

    return () => {
      desuscribirCanales();
    };
  }, [room?.id, view]);

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
  // LOOP DE MOVIMIENTO CONTINUO (60 FPS) Y TECLADO
  // ==========================================
  useEffect(() => {
    if (view !== 'game') {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      return;
    }

    const handleKeyDown = (e) => {
      // Si el jugador está eliminado, no procesar controles de juego
      if (currentUserRef.current.eliminado) return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      keysPressedRef.current[e.key.toLowerCase()] = true;

      // Disparos directos independientes (presión única)
      if (['i', 'I'].includes(e.key)) handleDisparar('UP');
      else if (['k', 'K'].includes(e.key)) handleDisparar('DOWN');
      else if (['j', 'J'].includes(e.key)) handleDisparar('LEFT');
      else if (['l', 'L'].includes(e.key)) handleDisparar('RIGHT');
    };

    const handleKeyUp = (e) => {
      keysPressedRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Loop a 60 FPS
    const tick = () => {
      if (currentUserRef.current.eliminado) {
        gameLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      let dx = 0;
      let dy = 0;
      const speed = 1.6; // velocidad de movimiento libre en % por frame

      if (keysPressedRef.current['arrowup'] || keysPressedRef.current['w']) dy = -speed;
      if (keysPressedRef.current['arrowdown'] || keysPressedRef.current['s']) dy = speed;
      if (keysPressedRef.current['arrowleft'] || keysPressedRef.current['a']) dx = -speed;
      if (keysPressedRef.current['arrowright'] || keysPressedRef.current['d']) dx = speed;

      if (dx !== 0 || dy !== 0) {
        setLocalPos(prev => {
          const nextX = Math.max(3, Math.min(97, prev.x + dx));
          const nextY = Math.max(3, Math.min(97, prev.y + dy));
          return { x: nextX, y: nextY };
        });
      }

      gameLoopRef.current = requestAnimationFrame(tick);
    };

    gameLoopRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [view]);

  // Sincronizador de coordenadas con la base de datos (Throttled a 90ms)
  useEffect(() => {
    if (view !== 'game') return;

    const interval = setInterval(async () => {
      const cur = currentUserRef.current;
      const rm = roomRef.current;
      const lp = localPosRef.current;

      if (cur.eliminado || !rm?.id) return;

      const dx = Math.abs(lp.x - lastSentPosRef.current.x);
      const dy = Math.abs(lp.y - lastSentPosRef.current.y);

      // Si ha habido algún movimiento significativo (ej. > 0.8% de recorrido)
      if (dx > 0.8 || dy > 0.8) {
        lastSentPosRef.current = { x: lp.x, y: lp.y };
        try {
          await moverJugador(cur.id, Math.round(lp.x), Math.round(lp.y), rm.id);
        } catch (err) {
          console.error(err);
        }
      }
    }, 90);

    return () => clearInterval(interval);
  }, [view]);

  // Mando táctil en pantalla (para móviles): incrementa posición suavemente
  const handleMoverTáctil = (dir) => {
    if (currentUserRef.current.eliminado) return;
    const offset = 8; // salto discreto para toques en móvil
    setLocalPos(prev => {
      let nextX = prev.x;
      let nextY = prev.y;
      if (dir === 'UP') nextY = Math.max(3, prev.y - offset);
      else if (dir === 'DOWN') nextY = Math.min(97, prev.y + offset);
      else if (dir === 'LEFT') nextX = Math.max(3, prev.x - offset);
      else if (dir === 'RIGHT') nextX = Math.min(97, prev.x + offset);
      return { x: nextX, y: nextY };
    });
  };

  const handleDisparar = async (direccion) => {
    const cur = currentUserRef.current;
    const rm = roomRef.current;
    const lp = localPosRef.current;

    if (cur.arma_tipo === 'ninguna' || cur.arma_municion <= 0 || cur.eliminado) {
      return;
    }

    try {
      // Disparar en la dirección apuntada desde nuestra localPos actual
      await disparar(
        cur.id,
        rm.id,
        Math.round(lp.x),
        Math.round(lp.y),
        direccion,
        cur.arma_tipo,
        cur.bajas
      );

      // Pintar el rayo láser de color cyan para mí
      setLaserHits(prev => [...prev, { x: lp.x, y: lp.y, direccion, color: 'cyan' }]);
      setTimeout(() => {
        setLaserHits(prev => prev.filter(l => !(l.x === lp.x && l.y === lp.y && l.direccion === direccion)));
      }, 400);

    } catch (err) {
      console.error('Error al disparar:', err);
    }
  };

  // Pintar el rayo láser rojo de un enemigo
  const triggerOponenteLaser = (oponente) => {
    const { x, y, ultima_accion } = oponente;
    const parts = ultima_accion.split('_');
    const dir = parts[1]; // 'UP', 'DOWN', 'LEFT', 'RIGHT'
    if (dir) {
      setLaserHits(prev => [...prev, { x, y, direccion: dir, color: 'pink' }]);
      setTimeout(() => {
        setLaserHits(prev => prev.filter(l => !(l.x === x && l.y === y && l.direccion === dir)));
      }, 400);
    }
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
        x: hostJugador.x,
        y: hostJugador.y,
        vida: 100,
        escudo: 50,
        arma_tipo: 'ninguna',
        arma_municion: 0,
        eliminado: false,
        bajas: 0
      });
      setLocalPos({ x: hostJugador.x, y: hostJugador.y });
      lastSentPosRef.current = { x: hostJugador.x, y: hostJugador.y };
      
      setRoom({
        id: salaId,
        host_name: nombre,
        estado: 'lobby',
        tormenta_radio: 10,
        tormenta_centro_x: 50,
        tormenta_centro_y: 50
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
      setLocalPos({ x: jugador.x, y: jugador.y });
      lastSentPosRef.current = { x: jugador.x, y: jugador.y };
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
        <section className="view active" style={{ padding: 0, margin: 0, background: '#000', overflow: 'hidden' }}>
          {stormWarning && (
            <div style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', background: 'var(--neon-pink)', color: '#fff', padding: '0.8rem 1.5rem', borderRadius: '10px', zIndex: 1000, fontFamily: 'var(--font-title)', fontWeight: 'bold', boxShadow: '0 0 20px var(--neon-pink)', textTransform: 'uppercase', letterSpacing: '1px', animation: 'pulse 1s infinite', fontSize: '0.9rem' }}>
              ⚠️ ¡La Tormenta de Datos se ha contraído! ⚠️
            </div>
          )}

          {/* 1. MAPA DE TODA LA PANTALLA */}
          <div className="arena-arena-2d full-screen">
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
                  {p.avatar}
                </div>
              );
            })}

            {/* Efectos de Láseres en 2D en Full-screen */}
            {laserHits.map((h, index) => {
              let style = {};
              if (h.direccion === 'UP') {
                style = { left: `${h.x}%`, top: `${h.y / 2.0}%`, width: '4px', height: `${h.y}%` };
              } else if (h.direccion === 'DOWN') {
                style = { left: `${h.x}%`, top: `${(100.0 + h.y) / 2.0}%`, width: '4px', height: `${100.0 - h.y}%` };
              } else if (h.direccion === 'LEFT') {
                style = { left: `${h.x / 2.0}%`, top: `${h.y}%`, width: `${h.x}%`, height: '4px' };
              } else if (h.direccion === 'RIGHT') {
                style = { left: `${(100.0 + h.x) / 2.0}%`, top: `${h.y}%`, width: `${100.0 - h.x}%`, height: '4px' };
              }
              return (
                <div
                  key={index}
                  className={`laser-line-2d ${h.color === 'pink' ? 'opponent' : ''}`}
                  style={style}
                />
              );
            })}
          </div>

          {/* ==========================================
             SISTEMA DE HUD DE JUEGO AAA (OVERLAYS)
             ========================================== */}

          {/* ARRIBA A LA IZQUIERDA: Nombre del jugador */}
          <div className="hud-top-left">
            <div className="hud-player-badge">
              <span className="hud-avatar">{currentUser.avatar}</span>
              <span className="hud-name">{currentUser.nombre}</span>
            </div>
          </div>

          {/* ARRIBA A LA DERECHA: Minimapa, Kills, y Salir */}
          <div className="hud-top-right">
            {/* Minimapa Táctico 2D */}
            <div className="hud-minimap">
              {/* Storm Safe Area on Minimap */}
              <div 
                className="minimap-storm-overlay"
                style={{
                  width: `${room.tormenta_radio * 10.0}%`,
                  height: `${room.tormenta_radio * 10.0}%`
                }}
              />
              
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

          {/* ABAJO A LA IZQUIERDA: Armamento */}
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

          {/* ABAJO A LA DERECHA: Integridad Física (Vida) y Escudo */}
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

          {/* BANNER DE ESPECTADOR (SI ELIMINADO) */}
          {currentUser.eliminado && (
            <div className="hud-spectator-banner">
              👁️ ESPECTANDO A LOS COMBATIENTES ACTIVOS
            </div>
          )}

          {/* CONTROLES TÁCTILES FLOTANTES (PARA MÓVILES) */}
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
