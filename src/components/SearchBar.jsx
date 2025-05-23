import React, { useState } from 'react';

export const SearchBar = ({ onSearch }) => {
    const [query, setQuery] = useState('');
    return (
        <div className="flex gap-2 p-4">
            <input className="flex-1 p-2 border rounded" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a song..." />
            <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={() => onSearch(query)}>Search</button>
        </div>
    );
};