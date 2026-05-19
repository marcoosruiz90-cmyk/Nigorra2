import { createClient } from '@supabase/supabase-js';

// 1. Obtener las credenciales de las variables de entorno de Vite (.env)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Bandera para verificar si las credenciales están correctamente cargadas
export const isConfigured = 
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'https://tu-proyecto-id.supabase.co' && 
  supabaseAnonKey !== 'tu-supabase-anon-key-aqui';

// Inicializar el cliente. Si no está configurado, exportamos null pero sin romper la ejecución
export const supabase = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

/**
 * Genera un código de sala aleatorio de 6 letras y números
 */
function generarCodigoSala() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluidos caracteres confusos
  let codigo = 'TRIV-';
  for (let i = 0; i < 4; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

/**
 * ==========================================
 * MÉTODOS DE BASE DE DATOS Y JUEGO
 * ==========================================
 */

/**
 * 👑 Crear una nueva sala de juego
 */
export async function crearSala(hostName) {
  if (!supabase) throw new Error('Supabase no está configurado. Revisa tu archivo .env');

  // 1. Generar un código único
  const salaId = generarCodigoSala();

  // 2. Obtener 10 preguntas aleatorias de la base de datos
  const { data: preguntas, error: errorPreguntas } = await supabase
    .from('preguntas')
    .select('id');

  if (errorPreguntas) throw errorPreguntas;
  if (!preguntas || preguntas.length === 0) {
    throw new Error('No hay preguntas en la base de datos. Ejecuta primero el script SQL de inicialización.');
  }

  // Mezclar preguntas y elegir máximo 10
  const preguntasIds = preguntas
    .map(p => p.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 10);

  // 3. Crear el registro de la sala en la tabla 'salas'
  const { error: errorSala } = await supabase
    .from('salas')
    .insert({
      id: salaId,
      host_name: hostName,
      estado: 'lobby',
      pregunta_actual_idx: 0,
      pregunta_actual_id: preguntasIds[0],
      preguntas_orden: preguntasIds,
      temporizador_limite: 15,
      timestamp_pregunta: null
    });

  if (errorSala) throw errorSala;

  // 4. Crear al jugador anfitrión en la tabla 'jugadores_sala'
  const { data: hostJugador, error: errorHost } = await supabase
    .from('jugadores_sala')
    .insert({
      sala_id: salaId,
      nombre: hostName,
      es_host: true,
      puntos: 0
    })
    .select()
    .single();

  if (errorHost) throw errorHost;

  return { salaId, hostJugador, preguntasOrden: preguntasIds };
}

/**
 * 🚀 Unirse a una sala existente como jugador regular
 */
export async function unirseASala(salaIdFormateado, playerName) {
  if (!supabase) throw new Error('Supabase no está configurado. Revisa tu archivo .env');

  const salaId = salaIdFormateado.toUpperCase().trim();

  // 1. Buscar la sala
  const { data: sala, error: errorSala } = await supabase
    .from('salas')
    .select('*')
    .eq('id', salaId)
    .single();

  if (errorSala || !sala) {
    throw new Error('La sala especificada no existe. Verifica el código.');
  }

  if (sala.estado !== 'lobby') {
    throw new Error('La partida ya ha comenzado en esta sala o ha terminado.');
  }

  // 2. Registrar al jugador en jugadores_sala
  const { data: jugador, error: errorJugador } = await supabase
    .from('jugadores_sala')
    .insert({
      sala_id: salaId,
      nombre: playerName,
      es_host: false,
      puntos: 0
    })
    .select()
    .single();

  if (errorJugador) throw errorJugador;

  return { sala, jugador };
}

/**
 * 🚪 Salir de una sala
 */
export async function abandonarSala(jugadorId) {
  if (!supabase) return;
  await supabase
    .from('jugadores_sala')
    .delete()
    .eq('id', jugadorId);
}

/**
 * 🔥 Comenzar la partida (Solo Host)
 */
export async function iniciarPartida(salaId, primerPreguntaId) {
  if (!supabase) return;
  
  const { error } = await supabase
    .from('salas')
    .update({
      estado: 'jugando',
      pregunta_actual_idx: 0,
      pregunta_actual_id: primerPreguntaId,
      timestamp_pregunta: new Date().toISOString()
    })
    .eq('id', salaId);

  if (error) throw error;
}

/**
 * ⏱️ Avanzar a la siguiente pregunta (Solo Host)
 */
export async function avanzarSiguientePregunta(salaId, siguienteIdx, siguientePreguntaId) {
  if (!supabase) return;

  // 1. Resetear las respuestas de todos los jugadores de esta sala en jugadores_sala
  const { error: errorReset } = await supabase
    .from('jugadores_sala')
    .update({
      ultima_respuesta: -1,
      tiempo_respuesta: 0.0
    })
    .eq('sala_id', salaId);

  if (errorReset) throw errorReset;

  // 2. Actualizar el estado de la sala
  const { error: errorSala } = await supabase
    .from('salas')
    .update({
      pregunta_actual_idx: siguienteIdx,
      pregunta_actual_id: siguientePreguntaId,
      timestamp_pregunta: new Date().toISOString()
    })
    .eq('id', salaId);

  if (errorSala) throw errorSala;
}

/**
 * 🛑 Terminar la partida (Solo Host)
 */
export async function finalizarPartida(salaId) {
  if (!supabase) return;

  const { error } = await supabase
    .from('salas')
    .update({ estado: 'terminado' })
    .eq('id', salaId);

  if (error) throw error;
}

/**
 * ✍️ Enviar respuesta de un jugador y otorgar puntos en base a rapidez
 */
export async function registrarRespuesta(jugadorId, opcionIdx, tiempoEnResponder, esCorrecta) {
  if (!supabase) return null;

  // Calcular puntos si es correcta:
  // Base de 100 puntos + Bonus por rapidez (máx 100 puntos extra según la rapidez en un límite de 15s)
  // Fórmula: puntos = 100 + Math.max(0, Math.round((15 - tiempoEnResponder) * 6.6))
  let puntosGanados = 0;
  if (esCorrecta) {
    puntosGanados = 100 + Math.max(0, Math.round((15.0 - tiempoEnResponder) * 6.6));
  }

  // Leer puntos actuales del jugador
  const { data: jugadorActual } = await supabase
    .from('jugadores_sala')
    .select('puntos')
    .eq('id', jugadorId)
    .single();

  const nuevosPuntos = (jugadorActual?.puntos || 0) + puntosGanados;

  // Actualizar jugador en la base de datos
  const { data: jugadorActualizado, error } = await supabase
    .from('jugadores_sala')
    .update({
      ultima_respuesta: opcionIdx,
      tiempo_respuesta: tiempoEnResponder,
      puntos: nuevosPuntos
    })
    .eq('id', jugadorId)
    .select()
    .single();

  if (error) throw error;
  return { jugadorActualizado, puntosGanados };
}

/**
 * 🔍 Obtener los datos completos de una pregunta por su ID
 */
export async function obtenerPregunta(preguntaId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('preguntas')
    .select('*')
    .eq('id', preguntaId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * 🏆 Ránking Global Histórico - Obtener Top 10
 */
export async function obtenerLeaderboard() {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('puntos_maximos', { ascending: false })
    .limit(10);

  if (error) throw error;
  return data || [];
}

/**
 * 💾 Guardar o actualizar record en Ránking Global Histórico
 */
export async function guardarEnLeaderboard(nombre, puntos) {
  if (!supabase) return;

  // Buscar si ya existe este usuario
  const { data: existente } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('nombre', nombre)
    .single();

  if (existente) {
    // Si ya existe y la puntuación es superior, la actualizamos
    if (puntos > existente.puntos_maximos) {
      await supabase
        .from('leaderboard')
        .update({
          puntos_maximos: puntos,
          partidas_jugadas: existente.partidas_jugadas + 1,
          fecha: new Date().toISOString()
        })
        .eq('id', existente.id);
    } else {
      // Si existe pero no superó récord, solo aumentamos partidas jugadas
      await supabase
        .from('leaderboard')
        .update({
          partidas_jugadas: existente.partidas_jugadas + 1
        })
        .eq('id', existente.id);
    }
  } else {
    // Insertar nueva puntuación global
    await supabase
      .from('leaderboard')
      .insert({
        nombre,
        puntos_maximos: puntos,
        partidas_jugadas: 1
      });
  }
}

/**
 * ➕ Añadir una pregunta sugerida por el usuario
 */
export async function agregarPregunta(pregunta, categoria, dificultad, opciones, opcionCorrecta) {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const { data, error } = await supabase
    .from('preguntas')
    .insert({
      pregunta,
      categoria,
      dificultad,
      opciones,
      opcion_correcta: opcionCorrecta
    })
    .select();

  if (error) throw error;
  return data;
}
