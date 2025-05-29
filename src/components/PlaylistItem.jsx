export const PlaylistItem = ({ snippet, onRemove, isPlaying, onPlay }) => {
    console.log('[RENDER] PlaylistItem ID:', snippet.id);
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div
            className={`flex justify-between items-center border-b py-2 ${isPlaying ? 'bg-grey-300' : ''
                }`}
        >   <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold', fontSize: '15px' }}>
                    {snippet.title.split(" ").slice(0, 7).join(" ")}
                </span>
                <span style={{ fontSize: '10px' }}>
                    ({formatTime(snippet.start)} - {formatTime(snippet.end)})
                </span>
            </div>

            <div className="flex gap-2">
                {/* <button onClick={onPlay} className="text-blue-500">▶</button> */}
                {/* <button onClick={() => onRemove(snippet.id)} className="text-red-500">
                    ❌
                </button> */}
            </div>
        </div >
    );
};
