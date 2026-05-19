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

// Componentes Modulares de Interfaz
import Home from './components/Home';
import Lobby from './components/Lobby';
import Results from './components/Results';
import Arena2D from './components/Arena2D';
import LeaderboardModal from './components/LeaderboardModal';

// Componentes del Sistema de HUD AAA
import HUDPlayerBadge from './components/hud/HUDPlayerBadge';
import HUDWeaponCard from './components/hud/HUDWeaponCard';
import HUDStatsCard from './components/hud/HUDStatsCard';
import HUDMinimap from './components/hud/HUDMinimap';

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
  const syncInProgressRef = useRef(false); // Seguro para evitar peticiones de red paralelas desordenadas
  const lastMousePosRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // Referencias optimizadas para evitar stutters de Garbage Collection y re-renderizados
  const currentUserRef = useRef(currentUser);
  const localPosRef = useRef(localPos);
  const roomRef = useRef(room);

  const playersRef = useRef([]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

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
        
        if (eventType === 'INSERT') {
          setPlayers(prev => {
            if (prev.some(p => p.id === newJug.id)) return prev;
            return [...prev, newJug];
          });
        } else if (eventType === 'UPDATE') {
          // Buscar al jugador anterior en la referencia mutable para comparar estadísticas
          const oldJug = playersRef.current.find(p => p.id === newJug.id);
          
          const statsChanged = !oldJug ||
            oldJug.nombre !== newJug.nombre ||
            oldJug.avatar !== newJug.avatar ||
            oldJug.vida !== newJug.vida ||
            oldJug.escudo !== newJug.escudo ||
            oldJug.arma_tipo !== newJug.arma_tipo ||
            oldJug.arma_municion !== newJug.arma_municion ||
            oldJug.eliminado !== newJug.eliminado ||
            oldJug.bajas !== newJug.bajas;

          // 1. Guardar siempre los nuevos datos en la referencia rápida de 60 FPS
          playersRef.current = playersRef.current.map(p => p.id === newJug.id ? newJug : p);

          // 2. Solo re-renderizar en React si cambiaron estadísticas o estado importante
          if (statsChanged) {
            setPlayers(prev => prev.map(p => p.id === newJug.id ? newJug : p));
          }

          // Sincronizar mis propias estadísticas locales
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

            // Resincronizar posición forzada de seguridad si hay una desviación muy grande (rubberbanding correction)
            setLocalPos(prevPos => {
              if (Math.hypot(prevPos.x - newJug.x, prevPos.y - newJug.y) > 15) {
                lastSentPosRef.current = { x: newJug.x, y: newJug.y };
                
                // Actualizar directamente el DOM para evitar lag visual
                const meEl = document.querySelector('.entity-player-2d.me');
                if (meEl) {
                  meEl.style.left = `${newJug.x}%`;
                  meEl.style.top = `${newJug.y}%`;
                }
                const meDot = document.querySelector('.minimap-player-dot.me');
                if (meDot) {
                  meDot.style.left = `${newJug.x}%`;
                  meDot.style.top = `${newJug.y}%`;
                }

                return { x: newJug.x, y: newJug.y };
              }
              return prevPos;
            });
          }
        } else if (eventType === 'DELETE') {
          setPlayers(prev => prev.filter(p => p.id === oldJug.id));
        }

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
    };

    const handleKeyUp = (e) => {
      keysPressedRef.current[e.key.toLowerCase()] = false;
    };

    // Función para actualizar la rotación del avatar (cara/icono) del jugador apuntando al ratón en 360 grados
    const updateAvatarRotation = () => {
      const cur = currentUserRef.current;
      if (cur.eliminado) return;

      const playerPixelX = (localPosRef.current.x / 100.0) * window.innerWidth;
      const playerPixelY = (localPosRef.current.y / 100.0) * window.innerHeight;

      const dx = lastMousePosRef.current.x - playerPixelX;
      const dy = lastMousePosRef.current.y - playerPixelY;

      const angulo = Math.atan2(dy, dx);

      // Aplicar rotación al wrapper de avatar del DOM directamente (0ms React render lag)
      const wrapper = document.querySelector('.entity-player-2d.me .player-avatar-wrapper');
      if (wrapper) {
        wrapper.style.transform = `rotate(${angulo}rad)`;
      }
    };

    const handleMouseMove = (e) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      updateAvatarRotation();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    // Loop a 60 FPS con manipulaciones DOM de alto rendimiento
    const tick = () => {
      if (currentUserRef.current.eliminado) {
        gameLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      let dx = 0;
      let dy = 0;
      const speed = 0.42; // velocidad de movimiento libre en % por frame (más táctico y controlable)

      if (keysPressedRef.current['arrowup'] || keysPressedRef.current['w']) dy = -speed;
      if (keysPressedRef.current['arrowdown'] || keysPressedRef.current['s']) dy = speed;
      if (keysPressedRef.current['arrowleft'] || keysPressedRef.current['a']) dx = -speed;
      if (keysPressedRef.current['arrowright'] || keysPressedRef.current['d']) dx = speed;

      if (dx !== 0 || dy !== 0) {
        const nextX = Math.max(3, Math.min(97, localPosRef.current.x + dx));
        const nextY = Math.max(3, Math.min(97, localPosRef.current.y + dy));
        localPosRef.current = { x: nextX, y: nextY };

        // 1. Reposicionar avatar local directamente en el DOM (0ms de retraso y sin re-renderizar React)
        const meEl = document.querySelector('.entity-player-2d.me');
        if (meEl) {
          meEl.style.left = `${nextX}%`;
          meEl.style.top = `${nextY}%`;
        }

        // 2. Reposicionar punto del minimapa local directamente en el DOM
        const meDot = document.querySelector('.minimap-player-dot.me');
        if (meDot) {
          meDot.style.left = `${nextX}%`;
          meDot.style.top = `${nextY}%`;
        }
      }

      // Actualizar rotación en 360 grados cada frame para el apuntado continuo
      updateAvatarRotation();

      // 3. Sincronizar dinámicamente oponentes en el DOM para evitar re-renderizados a 60 FPS
      playersRef.current.forEach(p => {
        if (p.id === currentUserRef.current.id) return; // Omitir al propio jugador local

        // Reposicionar avatar del oponente en la arena
        const opEl = document.querySelector(`.entity-player-2d[data-id="${p.id}"]`);
        if (opEl) {
          opEl.style.left = `${p.x}%`;
          opEl.style.top = `${p.y}%`;
        }

        // Reposicionar punto del oponente en el minimapa
        const opDot = document.querySelector(`.minimap-player-dot[data-id="${p.id}"]`);
        if (opDot) {
          opDot.style.left = `${p.x}%`;
          opDot.style.top = `${p.y}%`;
        }
      });

      gameLoopRef.current = requestAnimationFrame(tick);
    };

    gameLoopRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
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
      if (syncInProgressRef.current) return; // Esperar si hay una actualización en curso

      const dx = Math.abs(lp.x - lastSentPosRef.current.x);
      const dy = Math.abs(lp.y - lastSentPosRef.current.y);

      // Si ha habido algún movimiento significativo (ej. > 0.8% de recorrido)
      if (dx > 0.8 || dy > 0.8) {
        lastSentPosRef.current = { x: lp.x, y: lp.y };
        syncInProgressRef.current = true;
        try {
          // Mantener sincronizado el estado React de forma perezosa y throttled (baja frecuencia)
          setLocalPos({ x: lp.x, y: lp.y });
          await moverJugador(cur.id, Math.round(lp.x), Math.round(lp.y), rm.id);
        } catch (err) {
          console.error(err);
        } finally {
          syncInProgressRef.current = false;
        }
      }
    }, 90);

    return () => clearInterval(interval);
  }, [view]);

  // Mando táctil en pantalla (para móviles): incrementa posición suavemente
  const handleMoverTáctil = (dir) => {
    if (currentUserRef.current.eliminado) return;
    const offset = 2.5; // salto discreto para toques en móvil (proporcional al nuevo ritmo lento)
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

  const handleDisparar = async (angulo) => {
    const cur = currentUserRef.current;
    const rm = roomRef.current;
    const lp = localPosRef.current;

    if (cur.arma_tipo === 'ninguna' || cur.arma_municion <= 0 || cur.eliminado) {
      return;
    }

    try {
      // Disparar en el ángulo continuo de 360 grados (en radianes)
      await disparar(
        cur.id,
        rm.id,
        Math.round(lp.x),
        Math.round(lp.y),
        angulo,
        cur.arma_tipo,
        cur.bajas
      );

      // Pintar el rayo láser de color cyan para mí
      setLaserHits(prev => [...prev, { x: lp.x, y: lp.y, angulo, color: 'cyan' }]);
      setTimeout(() => {
        setLaserHits(prev => prev.filter(l => !(l.x === lp.x && l.y === lp.y && l.angulo === angulo)));
      }, 400);

    } catch (err) {
      console.error('Error al disparar:', err);
    }
  };

  // Disparo y apuntado con el ratón: calcula el ángulo de 360 grados usando atan2
  const handleMapClick = (e) => {
    const cur = currentUserRef.current;
    if (cur.eliminado || view !== 'game') return;

    // Obtener la posición del jugador local en píxeles (basada en porcentaje sobre el viewport full-screen)
    const playerPixelX = (localPosRef.current.x / 100.0) * window.innerWidth;
    const playerPixelY = (localPosRef.current.y / 100.0) * window.innerHeight;

    const dx = e.clientX - playerPixelX;
    const dy = e.clientY - playerPixelY;

    // Calcular el ángulo matemático continuo (de -PI a PI)
    const angulo = Math.atan2(dy, dx);

    handleDisparar(angulo);
  };

  // Pintar el rayo láser rojo de un enemigo
  const triggerOponenteLaser = (oponente) => {
    const { x, y, ultima_accion } = oponente;
    const parts = ultima_accion.split('_');
    if (parts[0] === 'shoot') {
      const angulo = parseFloat(parts[1]); // Parsear ángulo en radianes
      if (!isNaN(angulo)) {
        setLaserHits(prev => [...prev, { x, y, angulo, color: 'pink' }]);
        setTimeout(() => {
          setLaserHits(prev => prev.filter(l => !(l.x === x && l.y === y && l.angulo === angulo)));
        }, 400);
      }
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

      {/* VISTA 1: INICIO (HOME) */}
      {view === 'home' && (
        <Home
          username={username}
          setUsername={setUsername}
          avatar={avatar}
          setAvatar={setAvatar}
          roomCodeInput={roomCodeInput}
          setRoomCodeInput={setRoomCodeInput}
          handleCrearSala={handleCrearSala}
          handleUnirseSala={handleUnirseSala}
          handleVerLeaderboard={handleVerLeaderboard}
          isConfigured={isConfigured}
        />
      )}

      {/* VISTA 2: LOBBY DE ESPERA */}
      {view === 'lobby' && room && (
        <Lobby
          room={room}
          players={players}
          currentUser={currentUser}
          handleIniciarPartida={handleIniciarPartida}
          handleSalirPartida={handleSalirPartida}
        />
      )}

      {/* VISTA 3: EN ARENA DE JUEGO (GAMEPLAY) */}
      {view === 'game' && room && (
        <section className="view active" style={{ padding: 0, margin: 0, background: '#000', overflow: 'hidden' }}>
          {stormWarning && (
            <div style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', background: 'var(--neon-pink)', color: '#fff', padding: '0.8rem 1.5rem', borderRadius: '10px', zIndex: 1000, fontFamily: 'var(--font-title)', fontWeight: 'bold', boxShadow: '0 0 20px var(--neon-pink)', textTransform: 'uppercase', letterSpacing: '1px', animation: 'pulse 1s infinite', fontSize: '0.9rem' }}>
              ⚠️ ¡La Tormenta de Datos se ha contraído! ⚠️
            </div>
          )}

          {/* Viewport del mapa continuo 2D */}
          <Arena2D
            room={room}
            players={players}
            currentUser={currentUser}
            localPos={localPos}
            lootBoxes={lootBoxes}
            laserHits={laserHits}
            onMapClick={handleMapClick}
          />

          {/* Sistema de HUD AAA (Overlays) */}
          <HUDPlayerBadge currentUser={currentUser} />
          
          <HUDMinimap
            room={room}
            players={players}
            currentUser={currentUser}
            localPos={localPos}
            lootBoxes={lootBoxes}
            handleSalirPartida={handleSalirPartida}
          />

          <HUDWeaponCard currentUser={currentUser} />
          
          <HUDStatsCard currentUser={currentUser} />

          {/* Banner de espectador si es eliminado */}
          {currentUser.eliminado && (
            <div className="hud-spectator-banner">
              👁️ ESPECTANDO A LOS COMBATIENTES ACTIVOS
            </div>
          )}
        </section>
      )}

      {/* VISTA 4: RESULTADOS FINALES / VICTORIA */}
      {view === 'results' && (
        <Results
          players={players}
          getGanador={getGanador}
          handleVolverHome={() => setView('home')}
        />
      )}

      {/* MODAL: RANKING DE CIBER-SOLDADOS */}
      {showLeaderboard && (
        <LeaderboardModal
          leaderboardLoading={leaderboardLoading}
          globalLeaderboard={globalLeaderboard}
          setShowLeaderboard={setShowLeaderboard}
        />
      )}
    </div>
  );
}
