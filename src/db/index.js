// src/db/index.js
// IndexedDB layer for OnlyPeak (Section 5). Thin wrapper over `idb`.
//
// All persistence flows through here. Stores:
//   songs       keyPath 'videoId'
//   peaks       keyPath 'id', index 'by-videoId' on videoId
//   playlists   keyPath 'id'
//   settings    out-of-line key = 'app', single record
//
// The upgrade() callback is written idempotently so a version bump that adds a
// store or index never throws on a DB that already has it.

import { openDB } from 'idb';

const DB_NAME = 'onlypeak';
// Bump DB_VERSION whenever a NEW store/index must be created. Data-shape
// migrations live in runMigrations() and are keyed off settings.schemaVersion.
const DB_VERSION = 1;

const SETTINGS_KEY = 'app';

// Schema version for *data shape* (record contents), separate from the IndexedDB
// structural DB_VERSION above. runMigrations() walks from the stored value up to
// this. Bump when the shape of a record changes (not when adding a store).
export const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  defaultPeakLengthSec: 20,
  crossfadeMs: 0,
  lastPlaylistId: null,
  recentPeakIds: [],
  searchHistory: [],   // recent search queries (most-recent first)
  seeded: false,       // true once the first-run demo seed has run
};

let _dbPromise = null;

/**
 * Open (and cache) the single shared DB connection. Idempotent.
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function getDB() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db /*, oldVersion, newVersion, tx */) {
        // Idempotent store/index creation: safe across repeated version bumps.
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'videoId' });
        }
        if (!db.objectStoreNames.contains('peaks')) {
          const peaks = db.createObjectStore('peaks', { keyPath: 'id' });
          peaks.createIndex('by-videoId', 'videoId');
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          // out-of-line key = SETTINGS_KEY ('app')
          db.createObjectStore('settings');
        }
      },
    });
  }
  return _dbPromise;
}

/* ----------------------------------------------------------------------------
 * Songs (keyPath 'videoId')
 * ------------------------------------------------------------------------- */

/** Upsert a Song record. @param {object} song @returns {Promise<string>} key */
export async function putSong(song) {
  const db = await getDB();
  return db.put('songs', song);
}

/** @param {string} videoId @returns {Promise<object|undefined>} */
export async function getSong(videoId) {
  const db = await getDB();
  return db.get('songs', videoId);
}

/** @returns {Promise<object[]>} all songs */
export async function getAllSongs() {
  const db = await getDB();
  return db.getAll('songs');
}

/* ----------------------------------------------------------------------------
 * Peaks (keyPath 'id', index 'by-videoId')
 * ------------------------------------------------------------------------- */

/** Upsert a Peak record. @param {object} peak @returns {Promise<string>} key */
export async function putPeak(peak) {
  const db = await getDB();
  return db.put('peaks', peak);
}

/** @param {string} id @returns {Promise<object|undefined>} */
export async function getPeak(id) {
  const db = await getDB();
  return db.get('peaks', id);
}

/** @returns {Promise<object[]>} all peaks */
export async function getAllPeaks() {
  const db = await getDB();
  return db.getAll('peaks');
}

/** @param {string} videoId @returns {Promise<object[]>} peaks for one song */
export async function getPeaksByVideoId(videoId) {
  const db = await getDB();
  return db.getAllFromIndex('peaks', 'by-videoId', videoId);
}

/**
 * Delete a peak and remove its id from every playlist.peakIds. Done in one
 * read/write transaction so the DB never has a dangling peakId.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePeak(id) {
  const db = await getDB();
  const tx = db.transaction(['peaks', 'playlists'], 'readwrite');
  await tx.objectStore('peaks').delete(id);
  const playlistStore = tx.objectStore('playlists');
  const playlists = await playlistStore.getAll();
  for (const pl of playlists) {
    if (Array.isArray(pl.peakIds) && pl.peakIds.includes(id)) {
      pl.peakIds = pl.peakIds.filter((pid) => pid !== id);
      await playlistStore.put(pl);
    }
  }
  await tx.done;
}

/* ----------------------------------------------------------------------------
 * Playlists (keyPath 'id')
 * ------------------------------------------------------------------------- */

/** Upsert a Playlist record. @param {object} playlist @returns {Promise<string>} key */
export async function putPlaylist(playlist) {
  const db = await getDB();
  return db.put('playlists', playlist);
}

/** @param {string} id @returns {Promise<object|undefined>} */
export async function getPlaylist(id) {
  const db = await getDB();
  return db.get('playlists', id);
}

/** @returns {Promise<object[]>} all playlists */
export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll('playlists');
}

/** @param {string} id @returns {Promise<void>} removes only the playlist record (peaks are untouched) */
export async function deletePlaylist(id) {
  const db = await getDB();
  return db.delete('playlists', id);
}

/* ----------------------------------------------------------------------------
 * Settings (single out-of-line record under 'app')
 * ------------------------------------------------------------------------- */

/**
 * Read settings, merging the stored record over DEFAULT_SETTINGS so newly added
 * keys always have a value.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const db = await getDB();
  const stored = await db.get('settings', SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

/**
 * Shallow-merge a partial settings object over the current settings and persist.
 * @param {object} partial
 * @returns {Promise<object>} the merged, persisted settings
 */
export async function putSettings(partial) {
  const db = await getDB();
  // Read + merge + write inside ONE readwrite transaction. IndexedDB serializes
  // overlapping readwrite transactions on the same store, so concurrent partial
  // updates (e.g. savePeak's recents + the player's recents) can't lose-update
  // each other. (Don't await any non-tx promise between ops or the tx commits.)
  const tx = db.transaction('settings', 'readwrite');
  const stored = await tx.store.get(SETTINGS_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored || {}), ...(partial || {}) };
  await tx.store.put(merged, SETTINGS_KEY);
  await tx.done;
  return merged;
}

/* ----------------------------------------------------------------------------
 * Migrations
 * ------------------------------------------------------------------------- */

/**
 * Apply forward data-shape migrations from the stored settings.schemaVersion up
 * to CURRENT_SCHEMA_VERSION. Safe to call on every app init; a no-op once the
 * stored version already matches.
 *
 * To add a migration: bump CURRENT_SCHEMA_VERSION, then add a `case N:` below
 * that transforms records from version N to N+1 (fall-through, no `break`, so a
 * stale DB walks through every intermediate step). Persist the new version at
 * the end.
 * @returns {Promise<number>} the schemaVersion after migrating
 */
export async function runMigrations() {
  const settings = await getSettings();
  let version = settings.schemaVersion || 1;

  // Forward-only, fall-through migration ladder.
  switch (version) {
    // case 1:
    //   // migrate v1 records -> v2 here (e.g. backfill a new peak field)
    //   version = 2;
    //   // falls through to case 2
    // case 2:
    //   ...
    //   version = 3;
    default:
      break;
  }

  if (version !== settings.schemaVersion) {
    await putSettings({ schemaVersion: version });
  }
  return version;
}
