import React from 'react';
import useGameEngine from './hooks/useGameEngine';
import { isConfigured } from './supabase';

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
  const {
    view,
    username,
    setUsername,
    avatar,
    setAvatar,
    roomCodeInput,
    setRoomCodeInput,
    currentUser,
    room,
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
  } = useGameEngine();

  return (
    <div id="app-container">
      {/* Glowing Blobs de Fondo */}
      <div className="blob-container">
        <div className="blob blob-purple"></div>
        <div className="blob blob-cyan"></div>
        <div className="blob blob-pink"></div>
      </div>

      {/* Renderizado de Vistas Principales */}
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

      {view === 'lobby' && (
        <Lobby
          room={room}
          players={players}
          currentUser={currentUser}
          handleIniciarPartida={handleIniciarPartida}
          handleSalirPartida={handleSalirPartida}
        />
      )}

      {view === 'game' && (
        <>
          {/* Arena de Juego 2D */}
          <Arena2D
            players={players}
            currentUser={currentUser}
            localPos={localPos}
            lootBoxes={lootBoxes}
            laserHits={laserHits}
            onMapClick={handleMapClick}
          />

          {/* Sistema de HUD AAA Desacoplado */}
          <HUDPlayerBadge currentUser={currentUser} />
          <HUDWeaponCard currentUser={currentUser} />
          <HUDStatsCard currentUser={currentUser} />
          
          <HUDMinimap
            room={room}
            players={players}
            currentUser={currentUser}
            localPos={localPos}
            lootBoxes={lootBoxes}
            handleSalirPartida={handleSalirPartida}
          />
        </>
      )}

      {view === 'results' && (
        <Results
          players={players}
          getGanador={getGanador}
          handleVolverHome={handleSalirPartida}
        />
      )}

      {/* Modal del Leaderboard Global */}
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
