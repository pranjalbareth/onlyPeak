export const PlaylistItem = ({ snippet, onRemove, isPlaying, onPlay }) => {
    console.log('[RENDER] PlaylistItem ID:', snippet.id);
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div
            className={`flex justify-between items-center border-b py-2 ${isPlaying ? 'bg-green-100' : ''
                }`}
        >
            <span>
                {snippet.title} ({formatTime(snippet.start)} - {formatTime(snippet.end)})
            </span>
            <div className="flex gap-2">
                <button onClick={onPlay} className="text-blue-500">▶</button>
                <button onClick={() => onRemove(snippet.id)} className="text-red-500">
                    ❌
                </button>
            </div>
        </div>
    );
};
