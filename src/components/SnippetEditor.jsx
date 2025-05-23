import React, { useState } from 'react';

export const SnippetEditor = ({ video, onSave, onCancel }) => {
    const [startMinutes, setStartMinutes] = useState(0);
    const [startSeconds, setStartSeconds] = useState(0);
    const [endMinutes, setEndMinutes] = useState(0);
    const [endSeconds, setEndSeconds] = useState(10);

    const handleSave = () => {
        const start = startMinutes * 60 + startSeconds;
        const end = endMinutes * 60 + endSeconds;

        if (start >= end) {
            alert("End time must be greater than start time.");
            return;
        }

        onSave({
            videoId: video.id.videoId,
            title: video.snippet.title,
            start,
            end,
        });
    };

    return (
        <div style={{ border: '1px solid #ccc', padding: '1rem', marginTop: '1rem' }}>
            <h3>Editing Snippet: {video.snippet.title}</h3>

            <div style={{ marginBottom: '1rem' }}>
                <strong>Start Time:</strong><br />
                <input
                    type="number"
                    value={startMinutes}
                    onChange={(e) => setStartMinutes(Number(e.target.value))}
                    placeholder="Minutes"
                    style={{ width: '60px', marginRight: '10px' }}
                />
                <input
                    type="number"
                    value={startSeconds}
                    onChange={(e) => setStartSeconds(Number(e.target.value))}
                    placeholder="Seconds"
                    style={{ width: '60px' }}
                />
            </div>

            <div style={{ marginBottom: '1rem' }}>
                <strong>End Time:</strong><br />
                <input
                    type="number"
                    value={endMinutes}
                    onChange={(e) => setEndMinutes(Number(e.target.value))}
                    placeholder="Minutes"
                    style={{ width: '60px', marginRight: '10px' }}
                />
                <input
                    type="number"
                    value={endSeconds}
                    onChange={(e) => setEndSeconds(Number(e.target.value))}
                    placeholder="Seconds"
                    style={{ width: '60px' }}
                />
            </div>

            <button onClick={handleSave}>✅ Save Snippet</button>
            <button onClick={onCancel} style={{ marginLeft: '1rem' }}>❌ Cancel</button>
        </div>
    );
};
