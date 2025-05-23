import React, { useEffect, useRef } from 'react';
import { usePlaylist } from '../context/PlaylistContext';

export const Player = () => {
    const { playlist } = usePlaylist();
    const playerRef = useRef(null);
    const currentIndexRef = useRef(0);
    const playlistRef = useRef(playlist);
    const endedRef = useRef(false);
    const ytScriptAddedRef = useRef(false);

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
                    },
                    onStateChange: (event) => {
                        console.log('Player state changed:', event.data);

                        if (event.data === window.YT.PlayerState.ENDED) {
                            if (endedRef.current) return; // debounce
                            endedRef.current = true;

                            const currentPlaylist = playlistRef.current;
                            currentIndexRef.current = (currentIndexRef.current + 1) % currentPlaylist.length;
                            const next = currentPlaylist[currentIndexRef.current];

                            console.log('Video ended. Loading next snippet index:', currentIndexRef.current, next);

                            playerRef.current.loadVideoById({
                                videoId: next.videoId,
                                startSeconds: next.start,
                                endSeconds: next.end,
                            });

                            setTimeout(() => {
                                endedRef.current = false;
                            }, 1000);
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

    return <div id="yt-player" className="my-4"></div>;
};
