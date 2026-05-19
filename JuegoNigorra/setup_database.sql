-- ==========================================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS - TRIVIA ROYALE
-- ==========================================================================

-- 1. Eliminar tablas existentes para evitar conflictos si se vuelve a correr
DROP TABLE IF EXISTS public.leaderboard CASCADE;
DROP TABLE IF EXISTS public.jugadores_sala CASCADE;
DROP TABLE IF EXISTS public.salas CASCADE;
DROP TABLE IF EXISTS public.preguntas CASCADE;

-- 2. Tabla de Preguntas
CREATE TABLE public.preguntas (
    id SERIAL PRIMARY KEY,
    pregunta TEXT NOT NULL,
    categoria TEXT NOT NULL,
    dificultad TEXT CHECK (dificultad IN ('fácil', 'medio', 'difícil')) DEFAULT 'medio' NOT NULL,
    opciones JSONB NOT NULL, -- Array de 4 opciones: ["Opción A", "Opción B", ...]
    opcion_correcta INTEGER NOT NULL, -- Índice (0, 1, 2 o 3) de la opción correcta
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabla de Salas de Juego (Lobbies)
CREATE TABLE public.salas (
    id TEXT PRIMARY KEY, -- Código corto de sala (ej. "TRIV-ABCD")
    host_name TEXT NOT NULL,
    estado TEXT CHECK (estado IN ('lobby', 'jugando', 'terminado')) DEFAULT 'lobby' NOT NULL,
    pregunta_actual_idx INTEGER DEFAULT 0 NOT NULL,
    pregunta_actual_id INTEGER REFERENCES public.preguntas(id) ON DELETE SET NULL,
    preguntas_orden JSONB NOT NULL, -- Array de IDs de preguntas para esta partida
    temporizador_limite INTEGER DEFAULT 15 NOT NULL, -- Segundos por pregunta
    timestamp_pregunta TIMESTAMP WITH TIME ZONE, -- Cuándo se inició la pregunta actual
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Jugadores en Sala
CREATE TABLE public.jugadores_sala (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sala_id TEXT REFERENCES public.salas(id) ON DELETE CASCADE NOT NULL,
    nombre TEXT NOT NULL,
    puntos INTEGER DEFAULT 0 NOT NULL,
    ultima_respuesta INTEGER DEFAULT -1, -- Índice de su respuesta elegida, -1 es ninguna
    tiempo_respuesta FLOAT DEFAULT 0.0, -- Cuánto tardó en responder en segundos
    es_host BOOLEAN DEFAULT false NOT NULL,
    ultima_conexion TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabla de Leaderboard Global (Puntuaciones Históricas)
CREATE TABLE public.leaderboard (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    puntos_maximos INTEGER NOT NULL,
    partidas_jugadas INTEGER DEFAULT 1 NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================================
-- HABILITAR EL SISTEMA REALTIME EN SUPABASE
-- ==========================================================================
-- Nota: Habilita la replicación en tiempo real para las tablas clave
begin;
  -- Desactivar replicación previa si existiera para evitar duplicados
  drop publication if exists supabase_realtime;
  
  -- Crear la publicación
  create publication supabase_realtime;
commit;

-- Añadir las tablas a la publicación de tiempo real
alter publication supabase_realtime add table public.salas;
alter publication supabase_realtime add table public.jugadores_sala;

-- ==========================================================================
-- INSERCIÓN DE PREGUNTAS SEMILLA (15 PREGUNTAS DE VARIAS CATEGORÍAS)
-- ==========================================================================

INSERT INTO public.preguntas (pregunta, categoria, dificultad, opciones, opcion_correcta) VALUES
-- Categoría: Tecnología
(
    '¿Cuál es el lenguaje de programación nativo utilizado para compilar aplicaciones nativas en Android actualmente?',
    'Tecnología',
    'medio',
    '["Java", "Kotlin", "Swift", "C#"]'::jsonb,
    1
),
(
    '¿Qué significan las siglas "API" en el desarrollo de software?',
    'Tecnología',
    'fácil',
    '["Application Programming Interface", "Access Point Internet", "Advanced Protocol Integration", "Array Processor Input"]'::jsonb,
    0
),
(
    '¿En qué año se lanzó al público la primera versión del sistema operativo Windows?',
    'Tecnología',
    'difícil',
    '["1981", "1985", "1990", "1995"]'::jsonb,
    1
),

-- Categoría: Ciencia
(
    '¿Cuál es el elemento químico más abundante en el universo visible?',
    'Ciencia',
    'fácil',
    '["Oxígeno", "Helio", "Carbono", "Hidrógeno"]'::jsonb,
    3
),
(
    '¿Qué tipo de partícula subatómica tiene una carga eléctrica negativa?',
    'Ciencia',
    'fácil',
    '["Protón", "Neutrón", "Electrón", "Quark"]'::jsonb,
    2
),
(
    '¿Cuál es la velocidad aproximada de la luz en el vacío?',
    'Ciencia',
    'medio',
    '["150.000 km/s", "300.000 km/s", "450.000 km/s", "600.000 km/s"]'::jsonb,
    1
),

-- Categoría: Geografía
(
    '¿Cuál es la capital oficial de Australia?',
    'Geografía',
    'medio',
    '["Sídney", "Melbourne", "Camberra", "Brisbane"]'::jsonb,
    2
),
(
    '¿Cuál es el río más largo del mundo?',
    'Geografía',
    'medio',
    '["Río Nilo", "Río Amazonas", "Río Misisipi", "Río Yangtsé"]'::jsonb,
    1
),

-- Categoría: Arte & Literatura
(
    '¿Quién pintó la famosa obra de "La noche estrellada" en 1889?',
    'Arte',
    'fácil',
    '["Pablo Picasso", "Claude Monet", "Vincent van Gogh", "Salvador Dalí"]'::jsonb,
    2
),
(
    '¿Cuál es la primera novela moderna de la literatura universal escrita por Miguel de Cervantes?',
    'Literatura',
    'fácil',
    '["La Galatea", "Don Quijote de la Mancha", "El lazarillo de Tormes", "La Celestina"]'::jsonb,
    1
),

-- Categoría: Videojuegos
(
    '¿Cuál es el videojuego más vendido de la historia de la humanidad actualmente?',
    'Videojuegos',
    'fácil',
    '["Minecraft", "Grand Theft Auto V", "Tetris", "Wii Sports"]'::jsonb,
    0
),
(
    '¿En qué año se lanzó comercialmente la consola original PlayStation en Japón?',
    'Videojuegos',
    'difícil',
    '["1990", "1992", "1994", "1996"]'::jsonb,
    2
),

-- Categoría: Cultura General
(
    '¿Cuántos elementos componen la tabla periódica clásica actualmente?',
    'General',
    'medio',
    '["112", "115", "118", "121"]'::jsonb,
    2
),
(
    '¿Qué país ganó la primera Copa Mundial de la FIFA celebrada en el año 1930?',
    'General',
    'medio',
    '["Argentina", "Uruguay", "Brasil", "Italia"]'::jsonb,
    1
),
(
    '¿Qué filósofo griego fue el maestro y tutor de Alejandro Magno?',
    'General',
    'difícil',
    '["Sócrates", "Platón", "Aristóteles", "Pitágoras"]'::jsonb,
    2
);
