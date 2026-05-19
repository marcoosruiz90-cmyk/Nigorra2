import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isConfigured = !!(url && key && !url.includes('YOUR_'));

export const supabase = isConfigured ? createClient(url, key) : null;

// ==========================================
// OPERACIONES AUXILIARES
// ==========================================

export function generarCodigoSala() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'ROY-';
  for (let i = 0; i < 4; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

// 1. Crear Sala
export async function crearSala(hostName, avatar = '👑') {
  if (!supabase) throw new Error('Supabase no configurado.');

  const salaId = generarCodigoSala();

  // A. Crear la sala
  const { error: errorSala } = await supabase
    .from('cr_salas')
    .insert({
      id: salaId,
      host_name: hostName,
      estado: 'lobby',
      tormenta_radio: 10,
      tormenta_centro_x: 50,
      tormenta_centro_y: 50
    });

  if (errorSala) throw errorSala;

  // B. Crear el host en el centro (50, 50)
  const { data: hostJugador, error: errorHost } = await supabase
    .from('cr_jugadores')
    .insert({
      sala_id: salaId,
      nombre: hostName,
      avatar: avatar,
      es_host: true,
      x: 50,
      y: 50,
      vida: 100,
      escudo: 50,
      arma_tipo: 'ninguna',
      arma_municion: 0,
      eliminado: false
    })
    .select()
    .single();

  if (errorHost) throw errorHost;

  // C. Generar 20 cajas de botín aleatorias en el tablero 2D continuo (5% a 95%)
  const tiposCaja = ['pistola', 'escopeta', 'sniper', 'escudo', 'botiquin'];
  const cajas = [];

  while (cajas.length < 20) {
    const x = Math.floor(Math.random() * 86) + 7;
    const y = Math.floor(Math.random() * 86) + 7;
    // Evitar spawnear justo encima del centro para no dar ventaja al host
    const distCentro = Math.hypot(x - 50, y - 50);
    if (distCentro > 15) {
      const tipoRandom = tiposCaja[Math.floor(Math.random() * tiposCaja.length)];
      cajas.push({
        sala_id: salaId,
        x,
        y,
        tipo: tipoRandom,
        recogida: false
      });
    }
  }

  const { error: errorCajas } = await supabase
    .from('cr_cajas')
    .insert(cajas);

  if (errorCajas) console.error('Error spawnear botín:', errorCajas);

  return { salaId, hostJugador };
}

// 2. Unirse a Sala
export async function unirseASala(codigoSala, playerName, avatar = '👾') {
  if (!supabase) throw new Error('Supabase no configurado.');

  const salaId = codigoSala.toUpperCase().trim();

  // A. Comprobar si la sala existe y está en lobby
  const { data: sala, error: errorSala } = await supabase
    .from('cr_salas')
    .select('*')
    .eq('id', salaId)
    .single();

  if (errorSala || !sala) throw new Error('La sala no existe o el código es incorrecto.');
  if (sala.estado !== 'lobby') throw new Error('La partida ya ha comenzado en esta sala.');

  // B. Spawn aleatorio en los extremos del mapa 2D (porcentaje 5 a 95)
  const spawns = [
    { x: 10, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
    { x: 90, y: 10 },
    { x: 50, y: 10 },
    { x: 10, y: 50 },
    { x: 90, y: 50 },
    { x: 50, y: 90 }
  ];
  const spawnRandom = spawns[Math.floor(Math.random() * spawns.length)];

  const { data: jugador, error: errorJugador } = await supabase
    .from('cr_jugadores')
    .insert({
      sala_id: salaId,
      nombre: playerName,
      avatar: avatar,
      es_host: false,
      x: spawnRandom.x,
      y: spawnRandom.y,
      vida: 100,
      escudo: 50,
      arma_tipo: 'ninguna',
      arma_municion: 0,
      eliminado: false
    })
    .select()
    .single();

  if (errorJugador) throw errorJugador;

  return { sala, jugador };
}

// 3. Iniciar Partida
export async function iniciarPartida(salaId) {
  if (!supabase) return;
  const { error } = await supabase
    .from('cr_salas')
    .update({ estado: 'jugando' })
    .eq('id', salaId);

  if (error) throw error;
}

// 4. Mover Jugador
export async function moverJugador(jugadorId, x, y, salaId) {
  if (!supabase) return;

  // A. Actualizar coordenadas continuas del jugador
  const { data: jugador, error } = await supabase
    .from('cr_jugadores')
    .update({
      x,
      y,
      ultima_accion: 'move',
      timestamp_accion: new Date().toISOString()
    })
    .eq('id', jugadorId)
    .select()
    .single();

  if (error) throw error;

  // B. Comprobar si pisa una caja de botín recogida = false (distancia < 5.5% del tablero)
  const { data: cajas } = await supabase
    .from('cr_cajas')
    .select('*')
    .eq('sala_id', salaId)
    .eq('recogida', false);

  if (cajas && cajas.length > 0) {
    const cajaCercana = cajas.find(c => Math.hypot(c.x - x, c.y - y) < 6);
    if (cajaCercana) {
      await recogerBotin(jugador, cajaCercana);
    }
  }

  return jugador;
}

// 5. Recoger Botín
async function recogerBotin(jugador, caja) {
  if (!supabase) return;

  // Marcar la caja como recogida
  await supabase
    .from('cr_cajas')
    .update({ recogida: true })
    .eq('id', caja.id);

  let updates = {
    ultima_accion: 'pickup'
  };

  if (caja.tipo === 'botiquin') {
    updates.vida = Math.min(100, jugador.vida + 40);
  } else if (caja.tipo === 'escudo') {
    updates.escudo = Math.min(100, jugador.escudo + 50);
  } else if (caja.tipo === 'pistola') {
    updates.arma_tipo = 'pistola';
    updates.arma_municion = 15;
  } else if (caja.tipo === 'escopeta') {
    updates.arma_tipo = 'escopeta';
    updates.arma_municion = 8;
  } else if (caja.tipo === 'sniper') {
    updates.arma_tipo = 'sniper';
    updates.arma_municion = 4;
  }

  await supabase
    .from('cr_jugadores')
    .update(updates)
    .eq('id', jugador.id);
}

// 6. Realizar Disparo en la Arena 2D Libre
export async function disparar(jugadorId, salaId, x, y, direccion, armaTipo, bajasActuales) {
  if (!supabase) return;

  // A. Reducir munición del atacante
  const { data: atacante } = await supabase
    .from('cr_jugadores')
    .select('arma_municion')
    .eq('id', jugadorId)
    .single();

  const nuevaMunicion = Math.max(0, (atacante?.arma_municion || 0) - 1);
  const nuevoTipo = nuevaMunicion === 0 ? 'ninguna' : armaTipo;

  await supabase
    .from('cr_jugadores')
    .update({
      arma_tipo: nuevoTipo,
      arma_municion: nuevaMunicion,
      ultima_accion: `shoot_${direccion}`,
      timestamp_accion: new Date().toISOString()
    })
    .eq('id', jugadorId);

  // B. Generar coordenadas del rayo láser para pintarlo en la pantalla
  let celdasAfectadas = []; // Array de {x, y} para graficar la línea de disparo
  
  if (direccion === 'UP') {
    for (let i = 0; i <= y; i += 5) celdasAfectadas.push({ x, y: y - i });
  } else if (direccion === 'DOWN') {
    for (let i = 0; i <= (100 - y); i += 5) celdasAfectadas.push({ x, y: y + i });
  } else if (direccion === 'LEFT') {
    for (let i = 0; i <= x; i += 5) celdasAfectadas.push({ x: x - i, y });
  } else if (direccion === 'RIGHT') {
    for (let i = 0; i <= (100 - x); i += 5) celdasAfectadas.push({ x: x + i, y });
  }

  // C. Consultar jugadores oponentes activos
  const { data: oponentes } = await supabase
    .from('cr_jugadores')
    .select('*')
    .eq('sala_id', salaId)
    .eq('eliminado', false)
    .neq('id', jugadorId);

  if (!oponentes || oponentes.length === 0) return celdasAfectadas;

  // D. Comprobar colisiones de línea de disparo con oponentes
  let bajasHechas = 0;
  const danioArma = { pistola: 30, escopeta: 60, sniper: 80 };
  const damage = danioArma[armaTipo] || 0;
  const margenColision = 8.0; // Radio de hit test del láser continuo en %

  for (const op of oponentes) {
    let golpeado = false;

    if (direccion === 'UP') {
      golpeado = Math.abs(op.x - x) < margenColision && op.y < y;
    } else if (direccion === 'DOWN') {
      golpeado = Math.abs(op.x - x) < margenColision && op.y > y;
    } else if (direccion === 'LEFT') {
      golpeado = Math.abs(op.y - y) < margenColision && op.x < x;
    } else if (direccion === 'RIGHT') {
      golpeado = Math.abs(op.y - y) < margenColision && op.x > x;
    }

    // Limitación de rango corto para la Escopeta (máximo 30% del mapa)
    if (armaTipo === 'escopeta' && golpeado) {
      const distancia = Math.hypot(op.x - x, op.y - y);
      if (distancia > 30) golpeado = false;
    }

    if (golpeado) {
      let vidaRestante = op.vida;
      let escudoRestante = op.escudo;

      // Aplicar daño primero al escudo
      if (escudoRestante >= damage) {
        escudoRestante -= damage;
      } else {
        const danioSobrante = damage - escudoRestante;
        escudoRestante = 0;
        vidaRestante = Math.max(0, vidaRestante - danioSobrante);
      }

      const muerto = vidaRestante <= 0;

      await supabase
        .from('cr_jugadores')
        .update({
          vida: vidaRestante,
          escudo: escudoRestante,
          eliminado: muerto,
          ultima_accion: muerto ? 'died' : 'damage'
        })
        .eq('id', op.id);

      if (muerto) {
        bajasHechas += 1;
      }
    }
  }

  // Actualizar bajas si hubo
  if (bajasHechas > 0) {
    const totalBajas = bajasActuales + bajasHechas;
    await supabase
      .from('cr_jugadores')
      .update({ bajas: totalBajas })
      .eq('id', jugadorId);
  }

  // Comprobar ganador
  await chequearGanador(salaId);

  return celdasAfectadas;
}

// 7. Chequear Ganador
export async function chequearGanador(salaId) {
  if (!supabase) return;

  // A. Obtener todos los jugadores registrados en esta sala
  const { data: todos } = await supabase
    .from('cr_jugadores')
    .select('id')
    .eq('sala_id', salaId);

  // Si solo hay 1 jugador en total, es modo prueba/sandbox. No terminar partida.
  if (todos && todos.length <= 1) {
    return;
  }

  // B. Si hay múltiples jugadores, ver cuántos quedan vivos
  const { data: vivos } = await supabase
    .from('cr_jugadores')
    .select('*')
    .eq('sala_id', salaId)
    .eq('eliminado', false);

  if (vivos && vivos.length === 1) {
    // Declarar fin de partida
    await supabase
      .from('cr_salas')
      .update({ estado: 'terminado' })
      .eq('id', salaId);

    // Sumar record histórico de victorias del ganador
    const ganador = vivos[0];
    await guardarEnLeaderboard(ganador.nombre, 1, ganador.bajas);
  }
}

// 8. Contraer la Tormenta (Battle Royale Continuo)
export async function contraerTormenta(salaId, radioActual) {
  if (!supabase) return;

  const nuevoRadio = Math.max(0, radioActual - 2);

  // A. Actualizar el radio en la base de datos
  await supabase
    .from('cr_salas')
    .update({ tormenta_radio: nuevoRadio })
    .eq('id', salaId);

  // B. Leer jugadores vivos de esta sala
  const { data: vivos } = await supabase
    .from('cr_jugadores')
    .select('*')
    .eq('sala_id', salaId)
    .eq('eliminado', false);

  if (!vivos) return;

  // Centro seguro en coordenadas (50, 50)
  const centroX = 50;
  const centroY = 50;
  // Convertimos el radio de la tormenta (10 a 0) en un radio de porcentaje (50% a 0%)
  const radioPorcentaje = nuevoRadio * 5.0;

  for (const j of vivos) {
    // Distancia Chebyshev en la cuadrícula de porcentajes
    const dx = Math.abs(j.x - centroX);
    const dy = Math.abs(j.y - centroY);
    const distancia = Math.max(dx, dy);

    // Si está fuera de la zona segura, recibe daño masivo
    if (distancia > radioPorcentaje) {
      let vidaRestante = Math.max(0, j.vida - 25);
      const muerto = vidaRestante <= 0;

      await supabase
        .from('cr_jugadores')
        .update({
          vida: vidaRestante,
          eliminado: muerto,
          ultima_accion: muerto ? 'died_storm' : 'storm_damage'
        })
        .eq('id', j.id);
    }
  }

  // Comprobar si queda ganador tras tormenta
  await chequearGanador(salaId);
}


// 9. Abandonar Sala / Desconexión
export async function abandonarSala(jugadorId) {
  if (!supabase) return;

  const { data: jugador } = await supabase
    .from('cr_jugadores')
    .select('es_host, sala_id')
    .eq('id', jugadorId)
    .single();

  if (!jugador) return;

  if (jugador.es_host) {
    // Si el host sale, se borra la sala completa (cascada borra jugadores y cajas)
    await supabase
      .from('cr_salas')
      .delete()
      .eq('id', jugador.sala_id);
  } else {
    // Si es jugador normal, se borra solo a él
    await supabase
      .from('cr_jugadores')
      .delete()
      .eq('id', jugadorId);

    // Chequear si queda solo uno
    await chequearGanador(jugador.sala_id);
  }
}

// 10. Leaderboard
export async function obtenerLeaderboard() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cr_leaderboard')
    .select('*')
    .order('victorias', { ascending: false })
    .order('bajas_totales', { ascending: false })
    .limit(10);

  if (error) throw error;
  return data || [];
}

export async function guardarEnLeaderboard(nombre, victorias = 0, bajas = 0) {
  if (!supabase) return;

  // Ver si ya existe
  const { data: existente } = await supabase
    .from('cr_leaderboard')
    .select('*')
    .eq('nombre', nombre)
    .maybeSingle();

  if (existente) {
    await supabase
      .from('cr_leaderboard')
      .update({
        victorias: existente.victorias + victorias,
        bajas_totales: existente.bajas_totales + bajas,
        partidas_jugadas: existente.partidas_jugadas + 1
      })
      .eq('id', existente.id);
  } else {
    await supabase
      .from('cr_leaderboard')
      .insert({
        nombre,
        victorias,
        bajas_totales: bajas,
        partidas_jugadas: 1
      });
  }
}
