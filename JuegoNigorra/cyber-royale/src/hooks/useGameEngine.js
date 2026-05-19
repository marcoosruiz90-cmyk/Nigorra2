import { useState, useEffect, useRef } from 'react';
import {
  supabase,
  crearSala,
  unirseASala,
  iniciarPartida,
  moverJugador,
  disparar,
  abandonarSala,
  obtenerLeaderboard
} from '../supabase';

export default function useGameEngine() {
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
  const [currentUser, setCurrentUser] = useState({
    id: null,
    nombre: '',
    avatar: '',
    esHost: false,
    x: 50,
    y: 50,
    vida: 100,
    escudo: 50,
    arma_tipo: 'ninguna',
    arma_municion: 0,
    eliminado: false,
    bajas: 0
  });
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [lootBoxes, setLootBoxes] = useState([]);
  
  // Posición continua en tiempo real del jugador local (0% a 100%)
  const [localPos, setLocalPos] = useState({ x: 50, y: 50 });

  // Efectos Visuales Especiales (Láser y Alertas)
  const [laserHits, setLaserHits] = useState([]); // Array de {x, y, angulo, color}

  // Leaderboard Modal
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Referencias de Realtime y Loop de Juego Continuo
  const roomSubRef = useRef(null);
  const playersSubRef = useRef(null);
  const lootSubRef = useRef(null);
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

  // Desuscribir Canales
  const desuscribirCanales = () => {
    if (roomSubRef.current) supabase.removeChannel(roomSubRef.current);
    if (playersSubRef.current) supabase.removeChannel(playersSubRef.current);
    if (lootSubRef.current) supabase.removeChannel(lootSubRef.current);
  };

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

          playersRef.current = playersRef.current.map(p => p.id === newJug.id ? newJug : p);

          if (statsChanged) {
            setPlayers(prev => prev.map(p => p.id === newJug.id ? newJug : p));
          }

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

    return () => desuscribirCanales();
  }, [room?.id]);

  // ==========================================
  // LOOP DE MOVIMIENTO CONTINUO (60 FPS) Y TECLADO
  // ==========================================
  useEffect(() => {
    if (view !== 'game') {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      return;
    }

    const handleKeyDown = (e) => {
      if (currentUserRef.current.eliminado) return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      keysPressedRef.current[e.key.toLowerCase()] = true;
    };

    const handleKeyUp = (e) => {
      keysPressedRef.current[e.key.toLowerCase()] = false;
    };

    const updateAvatarRotation = () => {
      const cur = currentUserRef.current;
      if (cur.eliminado) return;

      const playerPixelX = (localPosRef.current.x / 100.0) * window.innerWidth;
      const playerPixelY = (localPosRef.current.y / 100.0) * window.innerHeight;

      const dx = lastMousePosRef.current.x - playerPixelX;
      const dy = lastMousePosRef.current.y - playerPixelY;

      const angulo = Math.atan2(dy, dx);

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

    const tick = () => {
      if (currentUserRef.current.eliminado) {
        gameLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      let dx = 0;
      let dy = 0;
      const speed = 0.42;

      if (keysPressedRef.current['arrowup'] || keysPressedRef.current['w']) dy = -speed;
      if (keysPressedRef.current['arrowdown'] || keysPressedRef.current['s']) dy = speed;
      if (keysPressedRef.current['arrowleft'] || keysPressedRef.current['a']) dx = -speed;
      if (keysPressedRef.current['arrowright'] || keysPressedRef.current['d']) dx = speed;

      if (dx !== 0 || dy !== 0) {
        const nextX = Math.max(3, Math.min(97, localPosRef.current.x + dx));
        const nextY = Math.max(3, Math.min(97, localPosRef.current.y + dy));
        localPosRef.current = { x: nextX, y: nextY };

        const meEl = document.querySelector('.entity-player-2d.me');
        if (meEl) {
          meEl.style.left = `${nextX}%`;
          meEl.style.top = `${nextY}%`;
        }

        const meDot = document.querySelector('.minimap-player-dot.me');
        if (meDot) {
          meDot.style.left = `${nextX}%`;
          meDot.style.top = `${nextY}%`;
        }
      }

      updateAvatarRotation();

      playersRef.current.forEach(p => {
        if (p.id === currentUserRef.current.id) return;

        const opEl = document.querySelector(`.entity-player-2d[data-id="${p.id}"]`);
        if (opEl) {
          opEl.style.left = `${p.x}%`;
          opEl.style.top = `${p.y}%`;
        }

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
      if (syncInProgressRef.current) return;

      const dx = Math.abs(lp.x - lastSentPosRef.current.x);
      const dy = Math.abs(lp.y - lastSentPosRef.current.y);

      if (dx > 0.8 || dy > 0.8) {
        lastSentPosRef.current = { x: lp.x, y: lp.y };
        syncInProgressRef.current = true;
        try {
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

  const handleDisparar = async (angulo) => {
    const cur = currentUserRef.current;
    const rm = roomRef.current;
    const lp = localPosRef.current;

    if (cur.arma_tipo === 'ninguna' || cur.arma_municion <= 0 || cur.eliminado) {
      return;
    }

    try {
      await disparar(
        cur.id,
        rm.id,
        Math.round(lp.x),
        Math.round(lp.y),
        angulo,
        cur.arma_tipo,
        cur.bajas
      );

      setLaserHits(prev => [...prev, { x: lp.x, y: lp.y, angulo, color: 'cyan' }]);
      setTimeout(() => {
        setLaserHits(prev => prev.filter(l => !(l.x === lp.x && l.y === lp.y && l.angulo === angulo)));
      }, 400);

    } catch (err) {
      console.error('Error al disparar:', err);
    }
  };

  const handleMapClick = (e) => {
    const cur = currentUserRef.current;
    if (cur.eliminado || view !== 'game') return;

    const playerPixelX = (localPosRef.current.x / 100.0) * window.innerWidth;
    const playerPixelY = (localPosRef.current.y / 100.0) * window.innerHeight;

    const dx = e.clientX - playerPixelX;
    const dy = e.clientY - playerPixelY;

    const angulo = Math.atan2(dy, dx);

    handleDisparar(angulo);
  };

  const triggerOponenteLaser = (oponente) => {
    const { x, y, ultima_accion } = oponente;
    const parts = ultima_accion.split('_');
    if (parts[0] === 'shoot') {
      const angulo = parseFloat(parts[1]);
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
      desuscribirCanales();
      if (currentUser.id) {
        await abandonarSala(currentUser.id).catch(console.error);
      }
      setView('home');
    }
  };

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

  const getGanador = () => {
    const superviviente = players.find(p => !p.eliminado);
    return superviviente || players[0];
  };

  return {
    view,
    setView,
    username,
    setUsername,
    avatar,
    setAvatar,
    roomCodeInput,
    setRoomCodeInput,
    currentUser,
    setCurrentUser,
    room,
    setRoom,
    players,
    lootBoxes,
    localPos,
    laserHits,
    showLeaderboard,
    setShowLeaderboard,
    globalLeaderboard,
    leaderboardLoading,
    handleCrearSala,
    handleUnirseSala,
    handleIniciarPartida,
    handleSalirPartida,
    handleMapClick,
    handleVerLeaderboard,
    getGanador
  };
}
