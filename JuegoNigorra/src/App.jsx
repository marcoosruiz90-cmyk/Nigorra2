import { useState, useEffect, useRef } from 'react';
import { 
  supabase, 
  isConfigured, 
  crearSala, 
  unirseASala, 
  abandonarSala, 
  iniciarPartida, 
  avanzarSiguientePregunta, 
  finalizarPartida, 
  obtenerPregunta, 
  obtenerLeaderboard, 
  guardarEnLeaderboard, 
  agregarPregunta 
} from './supabase';

export default function App() {
  // ==========================================
  // ESTADO DE LA APLICACIÓN
  // ==========================================
  const [view, setView] = useState('home'); // home, lobby, game, round-summary, results
  const [username, setUsername] = useState(() => {
    const nicknames = ['Ninja', 'Einstein', 'Curie', 'Hacker', 'ProGamer', 'Tesla', 'Cervantes', 'Newton', 'Galileo'];
    return nicknames[Math.floor(Math.random() * nicknames.length)] + Math.floor(Math.random() * 90 + 10);
  });
  const [avatar, setAvatar] = useState('🚀');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  // Usuario y Sala Activos
  const [currentUser, setCurrentUser] = useState({ id: null, nombre: '', avatar: '', esHost: false, puntos: 0 });
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  
  // Gameplay
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(15);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Modales
  const [showCreator, setShowCreator] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Formulario de Preguntas
  const [creatorPregunta, setCreatorPregunta] = useState('');
  const [creatorCategoria, setCreatorCategoria] = useState('Tecnología');
  const [creatorDificultad, setCreatorDificultad] = useState('medio');
  const [creatorOpciones, setCreatorOpciones] = useState(['', '', '', '']);
  const [creatorCorrecta, setCreatorCorrecta] = useState(0);

  // Referencias para evitar loops
  const timerIntervalRef = useRef(null);
  const roomSubscriptionRef = useRef(null);
  const playersSubscriptionRef = useRef(null);

  // ==========================================
  // SUSCRIPCIONES REALTIME Y ACTUALIZACIONES
  // ==========================================
  
  // Sincronizar lista de jugadores del servidor
  const refrescarJugadores = async (salaId) => {
    if (!supabase || !salaId) return;

    const { data: jugadores, error } = await supabase
      .from('jugadores_sala')
      .select('*')
      .eq('sala_id', salaId)
      .order('puntos', { ascending: false });

    if (error) {
      console.error('Error cargando jugadores:', error);
      return;
    }

    const listado = jugadores || [];
    setPlayers(listado);

    // Actualizar los puntos locales del usuario actual en base al servidor
    const match = listado.find(p => p.id === currentUser.id);
    if (match) {
      setCurrentUser(prev => ({ ...prev, puntos: match.puntos }));
    }
  };

  // Escuchar cambios en tiempo real
  useEffect(() => {
    if (!room?.id) return;

    // Desuscribirse de canales anteriores
    desuscribirCanales();

    const salaId = room.id;

    // 1. Canal de la Sala (Estado general, pregunta activa)
    roomSubscriptionRef.current = supabase
      .channel(`room_${salaId}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'salas', 
        filter: `id=eq.${salaId}` 
      }, async (payload) => {
        const nuevaSala = payload.new;
        setRoom(nuevaSala);

        // A) Transición LOBBY -> JUGANDO
        if (nuevaSala.estado === 'jugando' && view === 'lobby') {
          setView('game');
          cargarPreguntaActiva(nuevaSala.pregunta_actual_id, 0);
        }
        
        // B) Transición SIGUIENTE PREGUNTA
        else if (nuevaSala.estado === 'jugando' && nuevaSala.pregunta_actual_id !== activeQuestion?.id) {
          setView('game');
          cargarPreguntaActiva(nuevaSala.pregunta_actual_id, nuevaSala.pregunta_actual_idx);
        }

        // C) Transición JUEGO -> TERMINADO
        else if (nuevaSala.estado === 'terminado') {
          setView('results');
        }
      })
      .subscribe();

    // 2. Canal de los Jugadores (Nuevos registros, respuestas dadas, puntajes)
    playersSubscriptionRef.current = supabase
      .channel(`players_${salaId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jugadores_sala',
        filter: `sala_id=eq.${salaId}`
      }, () => {
        refrescarJugadores(salaId);
      })
      .subscribe();

    // Carga inicial de jugadores
    refrescarJugadores(salaId);

    return () => {
      desuscribirCanales();
    };
  }, [room?.id, currentUser.id, view, activeQuestion?.id]);

  const desuscribirCanales = () => {
    if (roomSubscriptionRef.current) {
      roomSubscriptionRef.current.unsubscribe();
      roomSubscriptionRef.current = null;
    }
    if (playersSubscriptionRef.current) {
      playersSubscriptionRef.current.unsubscribe();
      playersSubscriptionRef.current = null;
    }
  };

  // ==========================================
  // CONTROL DE TEMPORIZADOR DEL JUEGO
  // ==========================================
  useEffect(() => {
    if (view !== 'game') {
      clearInterval(timerIntervalRef.current);
      return;
    }

    // Intervalo de cuenta atrás
    timerIntervalRef.current = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          finalizarRonda();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerIntervalRef.current);
  }, [view, activeQuestion?.id]);

  // Chequear si todos los jugadores respondieron para avanzar rápido (Solo el Host)
  useEffect(() => {
    if (view !== 'game' || !currentUser.esHost || players.length === 0) return;

    const todosHanRespondido = players.every(p => p.ultima_respuesta !== -1);
    if (todosHanRespondido && secondsRemaining > 0) {
      clearInterval(timerIntervalRef.current);
      finalizarRonda();
    }
  }, [players, view, currentUser.esHost, secondsRemaining]);

  // ==========================================
  // LÓGICA DE TRANSICIÓN DE PREGUNTAS Y RESPUESTAS
  // ==========================================

  const cargarPreguntaActiva = async (preguntaId, idx) => {
    setHasAnswered(false);
    setSelectedAnswer(null);
    setSecondsRemaining(15);
    setStatusMsg('');
    
    try {
      const qData = await obtenerPregunta(preguntaId);
      setActiveQuestion(qData);
      setStartTime(Date.now());
    } catch (err) {
      console.error(err);
      alert('Error cargando la pregunta: ' + err.message);
    }
  };

  const handleResponder = async (opcionIdx) => {
    if (hasAnswered || view !== 'game') return;

    setHasAnswered(true);
    setSelectedAnswer(opcionIdx);

    const tiempoTranscurrido = ((Date.now() - startTime) / 1000).toFixed(2);
    const esCorrecta = opcionIdx === activeQuestion.opcion_correcta;

    setStatusMsg(esCorrecta 
      ? '¡Respuesta registrada! Cruzando los dedos... 🤞' 
      : '¡Respuesta registrada! Esperando al resto... ⏳'
    );

    try {
      await registrarRespuesta(currentUser.id, opcionIdx, parseFloat(tiempoTranscurrido), esCorrecta);
    } catch (err) {
      console.error('Error enviando respuesta:', err);
    }
  };

  const finalizarRonda = async () => {
    // Si no ha respondido a tiempo, registrar fallo en BD
    if (!hasAnswered) {
      setHasAnswered(true);
      try {
        await registrarRespuesta(currentUser.id, -1, 15.0, false);
      } catch (err) {
        console.error(err);
      }
    }

    // Esperar un breve momento de feedback visual y pasar al intermedio de la ronda
    setTimeout(() => {
      setView('round-summary');
      if (room?.id) refrescarJugadores(room.id);
    }, 3200);
  };

  // ==========================================
  // OPERACIONES DE SALAS (HOST Y JUGADOR)
  // ==========================================

  const handleCrearSala = async () => {
    const nombre = username.trim();
    if (!nombre) {
      alert('Por favor, escribe un nickname.');
      return;
    }

    try {
      const userObj = { nombre, avatar, esHost: true, puntos: 0 };
      const { salaId, hostJugador, preguntasOrden } = await crearSala(nombre);

      setCurrentUser({
        id: hostJugador.id,
        nombre: nombre,
        avatar: avatar,
        esHost: true,
        puntos: 0
      });

      setRoom({
        id: salaId,
        host_name: nombre,
        estado: 'lobby',
        pregunta_actual_idx: 0,
        pregunta_actual_id: preguntasOrden[0],
        preguntas_orden: preguntasOrden,
        temporizador_limite: 15
      });

      setView('lobby');
    } catch (err) {
      console.error(err);
      alert('Error creando la sala: ' + err.message);
    }
  };

  const handleUnirseSala = async () => {
    const nombre = username.trim();
    const codigo = roomCodeInput.trim();

    if (!nombre) {
      alert('Por favor, escribe un nickname.');
      return;
    }
    if (!codigo || codigo.length < 4) {
      alert('Por favor, introduce un código de sala válido.');
      return;
    }

    try {
      const { sala, jugador } = await unirseASala(codigo, nombre);

      setCurrentUser({
        id: jugador.id,
        nombre: nombre,
        avatar: avatar,
        esHost: false,
        puntos: 0
      });

      setRoom(sala);
      setView('lobby');
    } catch (err) {
      console.error(err);
      alert('No se pudo unir a la sala: ' + err.message);
    }
  };

  const handleIniciarPartida = async () => {
    if (!currentUser.esHost || !room) return;

    try {
      const primerPreguntaId = room.preguntas_orden[0];
      await iniciarPartida(room.id, primerPreguntaId);
    } catch (err) {
      console.error(err);
      alert('Error iniciando la partida: ' + err.message);
    }
  };

  const handleAvanzarPregunta = async () => {
    if (!currentUser.esHost || !room) return;

    try {
      const siguienteIdx = room.pregunta_actual_idx + 1;
      
      if (siguienteIdx >= room.preguntas_orden.length) {
        // Enviar récord automático local al leaderboard global antes de terminar
        const miRecord = players.find(p => p.id === currentUser.id);
        if (miRecord) {
          await guardarEnLeaderboard(miRecord.nombre, miRecord.puntos);
        }
        await finalizarPartida(room.id);
      } else {
        const siguientePreguntaId = room.preguntas_orden[siguienteIdx];
        await avanzarSiguientePregunta(room.id, siguienteIdx, siguientePreguntaId);
      }
    } catch (err) {
      console.error(err);
      alert('Error al avanzar de pregunta: ' + err.message);
    }
  };

  const handleSalirSala = async () => {
    if (confirm('¿Estás seguro de que quieres salir de la sala?')) {
      clearInterval(timerIntervalRef.current);
      desuscribirCanales();

      if (currentUser.id) {
        try {
          await abandonarSala(currentUser.id);
        } catch (err) {
          console.error(err);
        }
      }

      // Limpiar estados
      setCurrentUser({ id: null, nombre: '', avatar: '', esHost: false, puntos: 0 });
      setRoom(null);
      setPlayers([]);
      setActiveQuestion(null);
      setView('home');
    }
  };

  // ==========================================
  // OPERACIONES DE MODALES
  // ==========================================

  const handleVerLeaderboard = async () => {
    setShowLeaderboard(true);
    setLeaderboardLoading(true);
    try {
      const records = await obtenerLeaderboard();
      setGlobalLeaderboard(records);
    } catch (err) {
      console.error(err);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const handleGuardarPreguntaSugerida = async (e) => {
    e.preventDefault();
    if (!creatorPregunta.trim() || creatorOpciones.some(o => !o.trim())) {
      alert('Completa la pregunta y todas las opciones.');
      return;
    }

    try {
      await agregarPregunta(
        creatorPregunta.trim(),
        creatorCategoria,
        creatorDificultad,
        creatorOpciones,
        creatorCorrecta
      );

      alert('¡Pregunta guardada con éxito en la base de datos global!');
      setCreatorPregunta('');
      setCreatorOpciones(['', '', '', '']);
      setCreatorCorrecta(0);
      setShowCreator(false);
    } catch (err) {
      console.error(err);
      alert('Error al guardar la pregunta: ' + err.message);
    }
  };

  // ==========================================
  // RENDERIZADO DEL COMPONENTE
  // ==========================================
  return (
    <div id="app-container">
      {/* Fondo de Glowing Blobs */}
      <div className="blob-container">
        <div className="blob blob-purple"></div>
        <div className="blob blob-cyan"></div>
        <div className="blob blob-pink"></div>
      </div>

      {/* CABECERA GLOBAL */}
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <h1>TRIVIA<span className="highlight">ROYALE</span></h1>
        </div>
        {view !== 'home' && currentUser.id && (
          <div id="player-badge" className="player-badge">
            <span className="badge-avatar">{currentUser.avatar}</span>
            <span className="badge-name">{currentUser.nombre} ({currentUser.puntos} pts)</span>
          </div>
        )}
      </header>

      {/* ==========================================
         VISTA 1: INICIO (HOME)
         ========================================== */}
      {view === 'home' && (
        <section id="view-home" className="view active">
          {/* Banner si Supabase no está configurado */}
          {!isConfigured && (
            <div className="config-banner">
              <h3>⚙️ Conexión Pendiente</h3>
              <p>
                ¡El entorno React 19 está listo! Para que el juego funcione, conecta tu base de datos de <strong>Supabase</strong>.<br />
                Crea un archivo <code>.env</code> en la raíz del proyecto y copia las variables de <code>.env.example</code> rellenándolas con tus datos.<br />
                Tienes las instrucciones paso a paso en el archivo <code>guia_despliegue.md</code>.
              </p>
            </div>
          )}

          <div className="card glassmorphic hero-card">
            <h2>Desafía a tus amigos en <span className="text-gradient">Tiempo Real</span></h2>
            <p className="subtitle">Crea una sala de juego, compártela con tu clase y demuestra quién es el cerebro del aula.</p>
            
            <div className="setup-section">
              <div className="input-group">
                <label htmlFor="username">Elige tu Nickname</label>
                <input 
                  type="text" 
                  id="username" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  placeholder="Escribe tu nombre aquí..." 
                  maxLength={15} 
                  autoComplete="off"
                  disabled={!isConfigured}
                />
              </div>

              <div className="avatar-selector">
                <span className="label-avatar">Elige tu Avatar</span>
                <div className="avatar-options">
                  {['🚀', '🐱', '👾', '🦊', '🦁', '🦉'].map(emoji => (
                    <button 
                      key={emoji}
                      type="button" 
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
                id="btn-create-room" 
                className="btn btn-primary btn-glow"
                onClick={handleCrearSala}
                disabled={!isConfigured}
              >
                <span className="btn-text">👑 Crear Sala</span>
              </button>
              
              <div className="join-box">
                <input 
                  type="text" 
                  id="room-code-input" 
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="CÓDIGO DE SALA" 
                  maxLength={6} 
                  autoComplete="off"
                  disabled={!isConfigured}
                />
                <button 
                  id="btn-join-room" 
                  className="btn btn-secondary"
                  onClick={handleUnirseSala}
                  disabled={!isConfigured}
                >
                  <span className="btn-text">🚀 Unirse</span>
                </button>
              </div>
            </div>
            
            <div className="secondary-actions">
              <button 
                id="btn-show-leaderboard" 
                className="btn-link"
                onClick={handleVerLeaderboard}
                disabled={!isConfigured}
              >
                🏆 Ver Ránking Global
              </button>
              <span className="divider">|</span>
              <button 
                id="btn-open-creator" 
                className="btn-link"
                onClick={() => setShowCreator(true)}
                disabled={!isConfigured}
              >
                ➕ Sugerir Pregunta
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 2: LOBBY DE ESPERA
         ========================================== */}
      {view === 'lobby' && room && (
        <section id="view-lobby" className="view active">
          <div className="card glassmorphic lobby-card">
            <div className="lobby-header">
              <div className="room-code-section">
                <span className="room-label">Código de la Sala</span>
                <div className="room-code-display">
                  <h2 id="lobby-room-code">{room.id}</h2>
                  <button 
                    id="btn-copy-code" 
                    className="btn-copy" 
                    title="Copiar código"
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
                <span id="lobby-status-text">Esperando jugadores...</span>
              </div>
            </div>

            <div className="players-panel">
              <h3>Jugadores en la Sala ({players.length})</h3>
              <div id="players-list" className="players-list">
                {players.map(player => (
                  <div key={player.id} className={`player-item ${player.es_host ? 'is-host' : ''}`}>
                    <span className="item-avatar">{player.id === currentUser.id ? currentUser.avatar : '👾'}</span>
                    <span className="item-name">{player.nombre}</span>
                    {player.es_host && <span className="host-crown">Host 👑</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="lobby-actions">
              {currentUser.esHost ? (
                <button 
                  id="btn-start-game" 
                  className="btn btn-primary btn-glow"
                  onClick={handleIniciarPartida}
                >
                  <span className="btn-text">🔥 Comenzar Partida</span>
                </button>
              ) : (
                <div id="lobby-waiting-msg" className="lobby-waiting-msg">
                  <span className="loading-spinner"></span>
                  <p>Esperando a que el host inicie el juego...</p>
                </div>
              )}
              <button id="btn-exit-lobby" className="btn btn-danger" onClick={handleSalirSala}>
                Salir de la Sala
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 3: EN JUEGO
         ========================================== */}
      {view === 'game' && activeQuestion && (
        <section id="view-game" className="view active">
          <div className="game-layout">
            <div className="game-main">
              {/* Temporizador */}
              <div className="timer-container">
                <div 
                  className={`timer-bar ${secondsRemaining <= 5 ? 'warning' : ''}`} 
                  style={{ width: `${(secondsRemaining / 15) * 100}%`, transition: 'width 1s linear' }}
                ></div>
                <span className="timer-text">{secondsRemaining}s</span>
              </div>

              {/* Encabezado Pregunta */}
              <div className="question-header">
                <span className="category-pill">💻 {activeQuestion.categoria}</span>
                <span className="progress-pill">Pregunta {(room?.pregunta_actual_idx || 0) + 1} de {room?.preguntas_orden.length}</span>
              </div>

              {/* Tarjeta de Pregunta */}
              <div className="card glassmorphic question-card">
                <h2>{activeQuestion.pregunta}</h2>
              </div>

              {/* Respuestas Grid */}
              <div className="answers-grid">
                {activeQuestion.opciones.map((opcion, idx) => {
                  let cardClass = 'answer-card';
                  if (selectedAnswer === idx) cardClass += ' selected';

                  return (
                    <button 
                      key={idx}
                      className={cardClass}
                      data-index={idx}
                      onClick={() => handleResponder(idx)}
                      disabled={hasAnswered}
                    >
                      <span className="answer-letter">{['A', 'B', 'C', 'D'][idx]}</span>
                      <span className="answer-text">{opcion}</span>
                    </button>
                  );
                })}
              </div>

              {statusMsg && (
                <div className="game-status-message">
                  {statusMsg}
                </div>
              )}
            </div>

            {/* Clasificación lateral en vivo */}
            <aside className="game-sidebar card glassmorphic">
              <h3>Puntuaciones en Vivo</h3>
              <div className="live-standings">
                {players.map((player, idx) => (
                  <div key={player.id} className={`standing-item ${player.id === currentUser.id ? 'active-player' : ''} ${player.ultima_respuesta !== -1 ? 'answered' : ''}`}>
                    <div className="standing-left">
                      <span className="standing-rank">{idx + 1}</span>
                      <span className="standing-name">{player.nombre}</span>
                      {player.ultima_respuesta !== -1 && <span className="standing-check">✓</span>}
                    </div>
                    <span className="standing-points">{player.puntos} pts</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 4: INTERMEDIO / RESUMEN DE RONDA
         ========================================== */}
      {view === 'round-summary' && activeQuestion && (
        <section id="view-round-summary" className="view active">
          <div className="card glassmorphic summary-card">
            <h2>Ránking de la Ronda</h2>
            <div className="correct-answer-reveal">
              <p>La respuesta correcta era:</p>
              <div className="correct-answer-value">
                {activeQuestion.opciones[activeQuestion.opcion_correcta]}
              </div>
            </div>
            
            <div className="round-standings">
              <h3>Clasificación Actual</h3>
              <div className="round-standings-list">
                {players.map(player => {
                  const acerto = player.ultima_respuesta === activeQuestion.opcion_correcta;
                  
                  return (
                    <div key={player.id} className={`round-standings-item ${acerto ? 'correct' : 'incorrect'}`}>
                      <span className="round-standings-name">{player.nombre}</span>
                      <div className="round-standings-right">
                        <span className={`round-pts-added ${acerto ? 'plus' : 'zero'}`}>
                          {acerto ? '¡Acertó! 👍' : 'Incorrecto ❌'}
                        </span>
                        <span className="round-standings-score">
                          <strong>{player.puntos} pts</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="summary-actions">
              {currentUser.esHost ? (
                <button 
                  id="btn-next-question" 
                  className="btn btn-primary btn-glow"
                  onClick={handleAvanzarPregunta}
                >
                  <span className="btn-text">
                    {(room?.pregunta_actual_idx || 0) + 1 >= room?.preguntas_orden.length 
                      ? '🏁 Finalizar Partida' 
                      : 'Siguiente Pregunta ➡️'}
                  </span>
                </button>
              ) : (
                <div className="host-advancing-msg">
                  <span className="loading-spinner"></span>
                  <p>Esperando a que el host avance de pregunta...</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ==========================================
         VISTA 5: RESULTADOS FINALES
         ========================================== */}
      {view === 'results' && (
        <section id="view-results" className="view active">
          <div className="card glassmorphic results-card">
            <h2>🎉 ¡Partida Completada!</h2>
            <p className="subtitle">Gran partida de todos los competidores. He aquí los resultados definitivos.</p>

            {/* El Podio */}
            <div className="podium-container">
              {/* 2º Puesto */}
              {players[1] && (
                <div className="podium-step step-second">
                  <span className="podium-avatar">🥈</span>
                  <span className="podium-name">{players[1].nombre}</span>
                  <span className="podium-points">{players[1].puntos} pts</span>
                  <div className="podium-bar">2º</div>
                </div>
              )}
              {/* 1º Puesto */}
              {players[0] && (
                <div className="podium-step step-first">
                  <span className="podium-avatar">👑</span>
                  <span className="podium-name">{players[0].nombre}</span>
                  <span className="podium-points">{players[0].puntos} pts</span>
                  <div className="podium-bar">1º</div>
                </div>
              )}
              {/* 3º Puesto */}
              {players[2] && (
                <div className="podium-step step-third">
                  <span className="podium-avatar">🥉</span>
                  <span className="podium-name">{players[2].nombre}</span>
                  <span className="podium-points">{players[2].puntos} pts</span>
                  <div className="podium-bar">3º</div>
                </div>
              )}
            </div>

            {/* Clasificación Completa */}
            <div className="complete-ranking">
              <h3>Tabla de Posiciones Completa</h3>
              <div className="final-ranking-list">
                {players.map((player, idx) => (
                  <div key={player.id} className="final-ranking-item">
                    <div className="final-ranking-left">
                      <span className="final-ranking-pos">{idx + 1}º</span>
                      <span className="final-ranking-name">{player.nombre}</span>
                    </div>
                    <span className="final-ranking-points">{player.puntos} pts</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="results-actions">
              <button id="btn-home-return" className="btn btn-secondary" onClick={handleSalirSala}>
                Volver al Inicio
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ==========================================
         MODAL: SUGERIR PREGUNTA
         ========================================== */}
      {showCreator && (
        <div className="modal active">
          <div className="modal-content card glassmorphic">
            <div className="modal-header">
              <h3>➕ Añadir Pregunta a la Base de Datos</h3>
              <button className="btn-close" onClick={() => setShowCreator(false)}>&times;</button>
            </div>
            <form onSubmit={handleGuardarPreguntaSugerida} className="creator-form">
              <div className="form-group">
                <label>Pregunta</label>
                <textarea 
                  value={creatorPregunta} 
                  onChange={(e) => setCreatorPregunta(e.target.value)} 
                  placeholder="Escribe la pregunta aquí..." 
                  required 
                  autoComplete="off"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Categoría</label>
                  <select value={creatorCategoria} onChange={(e) => setCreatorCategoria(e.target.value)} required>
                    <option value="Tecnología">💻 Tecnología</option>
                    <option value="Ciencia">🧪 Ciencia</option>
                    <option value="Geografía">🌍 Geografía</option>
                    <option value="Arte">🎨 Arte</option>
                    <option value="Literatura">📚 Literatura</option>
                    <option value="Videojuegos">🎮 Videojuegos</option>
                    <option value="General">🧩 Cultura General</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Dificultad</label>
                  <select value={creatorDificultad} onChange={(e) => setCreatorDificultad(e.target.value)} required>
                    <option value="fácil">🟢 Fácil</option>
                    <option value="medio">🟡 Medio</option>
                    <option value="difícil">🔴 Difícil</option>
                  </select>
                </div>
              </div>

              <div className="form-options">
                <label>Opciones y Respuesta Correcta (Selecciona la correcta)</label>
                
                {creatorOpciones.map((opcion, idx) => (
                  <div key={idx} className="option-input-group">
                    <input 
                      type="radio" 
                      name="correct-opt" 
                      checked={creatorCorrecta === idx}
                      onChange={() => setCreatorCorrecta(idx)}
                      required 
                    />
                    <input 
                      type="text" 
                      value={opcion} 
                      onChange={(e) => {
                        const newOpts = [...creatorOpciones];
                        newOpts[idx] = e.target.value;
                        setCreatorOpciones(newOpts);
                      }}
                      placeholder={`Opción ${['A', 'B', 'C', 'D'][idx]}`} 
                      required 
                      autoComplete="off" 
                    />
                  </div>
                ))}
              </div>

              <button type="submit" className="btn btn-primary btn-glow">
                <span>Guardar Pregunta</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
         MODAL: LEADERBOARD GLOBAL
         ========================================== */}
      {showLeaderboard && (
        <div className="modal active">
          <div className="modal-content card glassmorphic">
            <div className="modal-header">
              <h3>🏆 Ránking Global Histórico</h3>
              <button className="btn-close" onClick={() => setShowLeaderboard(false)}>&times;</button>
            </div>
            <div className="leaderboard-table-container">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Puesto</th>
                    <th>Jugador</th>
                    <th>Puntos Máximos</th>
                    <th>Partidas Jugadas</th>
                  </tr>
                </thead>
                <tbody>
                  {globalLeaderboard.map((rec, idx) => (
                    <tr key={rec.id}>
                      <td style={{ fontWeight: 800, color: 'var(--text-muted)' }}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`}
                      </td>
                      <td style={{ fontWeight: 600 }}>{rec.nombre}</td>
                      <td style={{ fontWeight: 700, color: 'hsl(var(--secondary))' }}>{rec.puntos_maximos} pts</td>
                      <td>{rec.partidas_jugadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leaderboardLoading && (
                <div className="leaderboard-loading">
                  <span className="loading-spinner"></span>
                  <p>Cargando clasificación...</p>
                </div>
              )}
              {!leaderboardLoading && globalLeaderboard.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  ¡Nadie ha registrado récords aún! Sé el primero.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
