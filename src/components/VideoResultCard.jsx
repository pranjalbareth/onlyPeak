export const VideoResultCard = ({ video, onAddSnippet }) => (
    <div className="border p-4 mb-2 rounded shadow">
        <img src={video.snippet.thumbnails.default.url} alt={video.snippet.title} />
        <p className="font-semibold mt-2">{video.snippet.title}</p>
        <button className="mt-2 bg-green-500 text-white px-3 py-1 rounded" onClick={() => onAddSnippet(video)}>Select Snippet</button>
    </div>
);
