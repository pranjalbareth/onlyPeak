const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;

export const searchYouTube = async (query) => {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&key=${API_KEY}`);
    const data = await res.json();
    return data.items;
};