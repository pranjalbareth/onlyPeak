import React, { createContext, useContext, useEffect, useState } from 'react';

const PlaylistContext = createContext();

export const usePlaylist = () => useContext(PlaylistContext);

export const PlaylistProvider = ({ children }) => {
    const [playlist, setPlaylist] = useState(() => {
        try {
            const stored = localStorage.getItem('playlist');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });

    // Save to localStorage whenever playlist changes
    useEffect(() => {
        localStorage.setItem('playlist', JSON.stringify(playlist));
    }, [playlist]);

    const addToPlaylist = (snippet) => {
        setPlaylist((prev) => [...prev, snippet]);
    };

    const removeFromPlaylist = (id) => {
        setPlaylist((prev) => prev.filter((item) => item.id !== id));
    };

    const clearPlaylist = () => {
        setPlaylist([]);
    };

    return (
        <PlaylistContext.Provider
            value={{ playlist, addToPlaylist, removeFromPlaylist, clearPlaylist }}
        >
            {children}
        </PlaylistContext.Provider>
    );
};
