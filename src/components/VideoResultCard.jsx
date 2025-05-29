export const VideoResultCard = ({ video, onAddSnippet }) => {
    const videoId = video.id.videoId;
    const thumbnailUrl = `http://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    return (
        <div className="border p-4 mb-2 rounded shadow cursor-pointer" onClick={() => onAddSnippet(video)}>
            <img
                src={thumbnailUrl}
                alt={video.snippet.title}
                className="w-full h-auto rounded-md object-cover"
                style={{ maxWidth: '100%', height: 'auto' }}
            />
            <p className="font-semibold mt-2 text-lg">{video.snippet.title}</p>
            <p className="font-semibold mt-2 text-lg">{video.snippet.channelTitle}</p>
            <button
                className="mt-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition duration-300 ease-in-out"
                onClick={() => onAddSnippet(video)}
            >
                Select Snippet
            </button>
        </div>
    );
};