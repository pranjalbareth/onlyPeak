import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePlaylist } from './context/PlaylistContext';
import { searchYouTube } from './services/youtubeApi';
import { SearchBar } from './components/SearchBar';
import { VideoResultCard } from './components/VideoResultCard';
import { SnippetEditor } from './components/SnippetEditor';
import { PlaylistItem } from './components/PlaylistItem';
import { Player } from './components/Player';

export const App = () => {
  const [results, setResults] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const { playlist, addToPlaylist, removeFromPlaylist } = usePlaylist();

  const [currentSnippetIndex, setCurrentSnippetIndex] = useState(null);

  const handleSearch = async (query) => {
    const videos = await searchYouTube(query);
    setResults(videos);
    setSelectedVideo(null);
  };

  const handleAddSnippet = (video) => {
    setSelectedVideo(video);
  };

  const handleSaveSnippet = (snippet) => {
    if (!snippet.id) {
      snippet.id = uuidv4();
    }

    addToPlaylist(snippet);
    setSelectedVideo(null);
    if (playlist.length === 0) {
      setCurrentSnippetIndex(0);
    }
  };

  const handleRemoveSnippet = (id) => {
    removeFromPlaylist(id);

    if (
      currentSnippetIndex !== null &&
      playlist[currentSnippetIndex]?.id === id
    ) {
      setCurrentSnippetIndex(
        playlist.length > 1 ? 0 : null
      );
    }
  };

  const handleStartPlaylist = () => {
    if (playlist.length > 0) {
      setCurrentSnippetIndex(0);
    }
  };

  const handleSnippetEnded = () => {
    if (currentSnippetIndex === null) return;

    const nextIndex = currentSnippetIndex + 1;
    if (nextIndex < playlist.length) {
      setCurrentSnippetIndex(nextIndex);
    } else {
      setCurrentSnippetIndex(null);
    }
  };

  console.log('Playlist IDs:', playlist.map(item => item.id));
  console.log('Current playing snippet index:', currentSnippetIndex);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4" style={{ placeSelf: 'center' }}>🎵 OnlyPeak</h1>
      <SearchBar onSearch={handleSearch} />
      {
        results.map((video) => (
          <VideoResultCard
            key={video.id.videoId}
            video={video}
            onAddSnippet={handleAddSnippet}
          />
        ))
      }

      {
        selectedVideo && (
          <SnippetEditor
            video={selectedVideo}
            onSave={handleSaveSnippet}
            onCancel={() => setSelectedVideo(null)}
          />
        )
      }

      <h2 className="text-xl mt-6 mb-2 font-semibold flex justify-between items-center">
        🎧 Playlist
        {playlist.length > 0 && (
          <button
            onClick={handleStartPlaylist}
            className="text-lg px-3 py-1 text-white rounded"
          >
            ▶
          </button>
        )}
      </h2>

      {
        playlist.map((item, index) => (
          <PlaylistItem
            key={item.id}
            snippet={item}
            onRemove={handleRemoveSnippet}
            isPlaying={currentSnippetIndex === index}
            onPlay={() => setCurrentSnippetIndex(index)}
          />
        ))
      }

      {
        playlist.length > 0 && currentSnippetIndex !== null && (
          <Player
            snippet={playlist[currentSnippetIndex]}
            onEnded={handleSnippetEnded}
          />
        )
      }
    </div >
  );
};
