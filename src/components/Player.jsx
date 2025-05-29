import React, { useEffect, useRef, useState } from 'react';
import { usePlaylist } from '../context/PlaylistContext';

export const Player = () => {
    const { playlist } = usePlaylist();
    const playerRef = useRef(null);
    const currentIndexRef = useRef(0);
    const playlistRef = useRef(playlist);
    const endedRef = useRef(false);
    const ytScriptAddedRef = useRef(false);
    const [thumbnail, setThumbnail] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const intervalRef = useRef(null);

    useEffect(() => {
        playlistRef.current = playlist;
    }, [playlist]);

    useEffect(() => {
        if (!playlist.length) return;

        if (!ytScriptAddedRef.current) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            document.body.appendChild(tag);
            ytScriptAddedRef.current = true;
        }

        window.onYouTubeIframeAPIReady = () => {
            const snippet = playlistRef.current[currentIndexRef.current];
            setThumbnail(`https://img.youtube.com/vi/${snippet.videoId}/hqdefault.jpg`);

            playerRef.current = new window.YT.Player('yt-player', {
                height: '360',
                width: '640',
                videoId: snippet.videoId,
                playerVars: {
                    start: snippet.start,
                    end: snippet.end,
                    autoplay: 1,
                },
                events: {
                    onReady: (event) => {
                        event.target.playVideo();
                        setIsPlaying(true);
                    },
                    onStateChange: (event) => {
                        if (event.data === window.YT.PlayerState.ENDED) {
                            if (endedRef.current) return;
                            endedRef.current = true;

                            const currentPlaylist = playlistRef.current;
                            currentIndexRef.current = (currentIndexRef.current + 1) % currentPlaylist.length;
                            const next = currentPlaylist[currentIndexRef.current];
                            setThumbnail(`https://img.youtube.com/vi/${next.videoId}/hqdefault.jpg`);

                            playerRef.current.loadVideoById({
                                videoId: next.videoId,
                                startSeconds: next.start,
                                endSeconds: next.end,
                            });

                            setTimeout(() => {
                                endedRef.current = false;
                            }, 1000);
                        } else if (event.data === window.YT.PlayerState.PLAYING) {
                            setIsPlaying(true);
                        } else if (event.data === window.YT.PlayerState.PAUSED) {
                            setIsPlaying(false);
                        }
                    },
                },
            });
        };

        return () => {
            if (playerRef.current) {
                playerRef.current.destroy();
                playerRef.current = null;
            }
            endedRef.current = false;
        };
    }, [playlist]);

    useEffect(() => {
        clearInterval(intervalRef.current);
        if (isPlaying && playerRef.current) {
            intervalRef.current = setInterval(() => {
                const player = playerRef.current;
                const currentTime = player.getCurrentTime();
                const snippet = playlistRef.current[currentIndexRef.current];
                const duration = snippet.end - snippet.start;
                const progressPercent = ((currentTime - snippet.start) / duration) * 100;
                setProgress(progressPercent);
            }, 500);
        }

        return () => clearInterval(intervalRef.current);
    }, [isPlaying]);

    const togglePlay = () => {
        if (!playerRef.current) return;
        if (isPlaying) {
            playerRef.current.pauseVideo();
        } else {
            playerRef.current.playVideo();
        }
    };

    const playNext = () => {
        const currentPlaylist = playlistRef.current;
        currentIndexRef.current = (currentIndexRef.current + 1) % currentPlaylist.length;
        const next = currentPlaylist[currentIndexRef.current];
        playerRef.current.loadVideoById({
            videoId: next.videoId,
            startSeconds: next.start,
            endSeconds: next.end,
        });
        setThumbnail(`https://img.youtube.com/vi/${next.videoId}/hqdefault.jpg`);
    };

    const playPrevious = () => {
        const currentPlaylist = playlistRef.current;
        currentIndexRef.current = (currentIndexRef.current - 1 + currentPlaylist.length) % currentPlaylist.length;
        const prev = currentPlaylist[currentIndexRef.current];
        playerRef.current.loadVideoById({
            videoId: prev.videoId,
            startSeconds: prev.start,
            endSeconds: prev.end,
        });
        setThumbnail(`https://img.youtube.com/vi/${prev.videoId}/hqdefault.jpg`);
    };

    return (
        <div className="my-4 flex flex-col items-center">
            <div id="yt-player" style={{ display: 'none' }}></div>

            {thumbnail && (
                <div className="w-80 h-80 overflow-hidden rounded-lg mb-4">
                    <img
                        src={thumbnail}
                        alt="Thumbnail"
                        className="w-full h-auto min-h-full object-cover object-center scale-150"
                    />
                </div>
            )}

            <div className="w-80 bg-gray-300 h-2 rounded mt-4 overflow-hidden">
                <div
                    className="bg-blue-500 h-full"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>

            <div className="mt-4 flex gap-4">
                <button onClick={playPrevious}>⏮</button>
                <button onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
                <button onClick={playNext}>⏭</button>
            </div>
        </div>
    );
};
