-- ==========================================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS - CYBER ROYALE
-- ==========================================================================

-- 1. Eliminar tablas existentes para evitar conflictos
DROP TABLE IF EXISTS public.cr_cajas CASCADE;
DROP TABLE IF EXISTS public.cr_jugadores CASCADE;
DROP TABLE IF EXISTS public.cr_salas CASCADE;
DROP TABLE IF EXISTS public.cr_leaderboard CASCADE;

-- 2. Tabla de Salas de Juego (Lobbies de Battle Royale)
CREATE TABLE public.cr_salas (
    id TEXT PRIMARY KEY, -- Código corto de sala (ej. "ROY-ABCD")
    host_name TEXT NOT NULL,
    estado TEXT CHECK (estado IN ('lobby', 'jugando', 'terminado')) DEFAULT 'lobby' NOT NULL,
    tormenta_radio INTEGER DEFAULT 10 NOT NULL, -- Radio del círculo seguro (inicia en 10, reduce a 8, 6, 4, 2, 0)
    tormenta_centro_x INTEGER DEFAULT 4 NOT NULL, -- Centro X de la zona segura
    tormenta_centro_y INTEGER DEFAULT 4 NOT NULL, -- Centro Y de la zona segura
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabla de Jugadores en la Arena
CREATE TABLE public.cr_jugadores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sala_id TEXT REFERENCES public.cr_salas(id) ON DELETE CASCADE NOT NULL,
    nombre TEXT NOT NULL,
    avatar TEXT NOT NULL,
    es_host BOOLEAN DEFAULT false NOT NULL,
    x INTEGER DEFAULT 0 NOT NULL, -- Posición X en la cuadrícula (0 a 9)
    y INTEGER DEFAULT 0 NOT NULL, -- Posición Y en la cuadrícula (0 a 9)
    vida INTEGER DEFAULT 100 NOT NULL, -- Vida actual (0 a 100)
    escudo INTEGER DEFAULT 50 NOT NULL, -- Escudo actual (0 a 100)
    arma_tipo TEXT CHECK (arma_tipo IN ('ninguna', 'pistola', 'escopeta', 'sniper')) DEFAULT 'ninguna' NOT NULL,
    arma_municion INTEGER DEFAULT 0 NOT NULL,
    eliminado BOOLEAN DEFAULT false NOT NULL, -- Si ha muerto en el Battle Royale
    bajas INTEGER DEFAULT 0 NOT NULL, -- Número de bajas hechas en esta partida
    puntos INTEGER DEFAULT 0 NOT NULL,
    ultima_accion TEXT DEFAULT 'join' NOT NULL, -- 'move', 'shoot', 'pickup', 'storm'
    timestamp_accion TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ultima_conexion TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Cajas de Botín (Loot en el mapa)
CREATE TABLE public.cr_cajas (
    id SERIAL PRIMARY KEY,
    sala_id TEXT REFERENCES public.cr_salas(id) ON DELETE CASCADE NOT NULL,
    x INTEGER NOT NULL, -- Coordenada X (0 a 9)
    y INTEGER NOT NULL, -- Coordenada Y (0 a 9)
    tipo TEXT CHECK (tipo IN ('pistola', 'escopeta', 'sniper', 'escudo', 'botiquin')) NOT NULL,
    recogida BOOLEAN DEFAULT false NOT NULL
);

-- 5. Tabla de Leaderboard Global Histórico
CREATE TABLE public.cr_leaderboard (
    id SERIAL PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    victorias INTEGER DEFAULT 0 NOT NULL,
    bajas_totales INTEGER DEFAULT 0 NOT NULL,
    partidas_jugadas INTEGER DEFAULT 1 NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================================
-- HABILITAR EL SISTEMA REALTIME EN SUPABASE
-- ==========================================================================
begin;
  -- Desactivar publicación previa si existiera
  drop publication if exists cr_realtime;
  
  -- Crear la publicación
  create publication cr_realtime;
commit;

-- Añadir las tablas a la publicación de tiempo real
alter publication cr_realtime add table public.cr_salas;
alter publication cr_realtime add table public.cr_jugadores;
alter publication cr_realtime add table public.cr_cajas;
