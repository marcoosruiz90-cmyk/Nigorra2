import { supabase } from './supabaseClient';

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
