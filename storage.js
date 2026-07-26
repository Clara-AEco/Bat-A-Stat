// IndexedDB persistence of the whole Project tree, plus JSON export/import for backup/portability.
window.BatID = window.BatID || {};

(function (ns) {
  const DB_NAME = 'BatAStat';
  const OLD_DB_NAME = 'BatIDHelper'; // pre-rename database - migrated from once, then left alone
  // v2: repairs installs where the "projects" store never got created (e.g. an interrupted
  // first-ever open left the database stuck at v1 with no store - reopening at v1 forever after
  // never re-runs onupgradeneeded, so the store would never exist and every transaction would
  // fail with "object store not found". Bumping the version forces onupgradeneeded to run again.
  // v3: adds the folderHandles store (project <-> linked local folder for file-based storage).
  const DB_VERSION = 3;
  const STORE = 'projects';
  const HANDLES_STORE = 'folderHandles';

  let dbPromise = null;
  let migratePromise = null;

  function openDbNamed(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(HANDLES_STORE)) {
          db.createObjectStore(HANDLES_STORE, { keyPath: 'projectId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllFrom(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // One-time MOVE of any projects left in the pre-rename "BatIDHelper" database into the new
  // "BatAStat" one, so renaming the app doesn't orphan work already saved under the old name.
  // Projects are deleted from the old database once copied - otherwise every fresh page load
  // would re-copy them back in, silently resurrecting anything the user deleted after migrating.
  async function migrateFromOldDbOnce() {
    if (migratePromise) return migratePromise;
    migratePromise = (async () => {
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          if (!dbs.some((d) => d.name === OLD_DB_NAME)) return;
        }
        const oldDb = await openDbNamed(OLD_DB_NAME);
        if (!oldDb.objectStoreNames.contains(STORE)) { oldDb.close(); return; }
        const oldProjects = await getAllFrom(oldDb);
        if (oldProjects.length === 0) { oldDb.close(); return; }

        const newDb = await openDb();
        const existingIds = new Set((await getAllFrom(newDb)).map((p) => p.id));
        const toCopy = oldProjects.filter((p) => !existingIds.has(p.id));
        if (toCopy.length > 0) {
          await new Promise((resolve, reject) => {
            const tx = newDb.transaction(STORE, 'readwrite');
            toCopy.forEach((p) => tx.objectStore(STORE).put(p));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
        // Every old project is now accounted for in the new DB (just copied, or already there
        // from a prior migration) - clear the old store so nothing can be resurrected later.
        await new Promise((resolve, reject) => {
          const tx = oldDb.transaction(STORE, 'readwrite');
          oldProjects.forEach((p) => tx.objectStore(STORE).delete(p.id));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        oldDb.close();
      } catch (e) {
        console.warn('Bat-A-Stat: migration from the old BatIDHelper database failed', e);
      }
    })();
    return migratePromise;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = openDbNamed(DB_NAME);
    return dbPromise;
  }

  async function saveProject(project) {
    ns.Models.touch(project);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(project);
      tx.oncomplete = () => resolve(project);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadProject(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listProjects() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteProject(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------------- Folder-linked storage ----------------
  // Lets the analyst choose a real folder on disk for a project's data instead of it being
  // invisible inside the browser's IndexedDB - project.json in that folder becomes the whole
  // project, shareable by just sharing the folder. IndexedDB stays the source of truth for the
  // live session; the folder is kept in sync on every save. Chrome/Edge only (File System Access
  // API) - Firefox/Safari callers should check `supportsFolderStorage` first.
  const supportsFolderStorage = typeof window.showDirectoryPicker === 'function';

  async function pickProjectFolder() {
    return window.showDirectoryPicker({ mode: 'readwrite' });
  }

  async function saveFolderHandle(projectId, handle) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readwrite');
      tx.objectStore(HANDLES_STORE).put({ projectId, handle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadFolderHandle(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readonly');
      const req = tx.objectStore(HANDLES_STORE).get(projectId);
      req.onsuccess = () => resolve(req.result ? req.result.handle : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFolderHandle(projectId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readwrite');
      tx.objectStore(HANDLES_STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function writeProjectJsonToFolder(handle, project, attempt) {
    attempt = attempt || 0;
    try {
      const fileHandle = await handle.getFileHandle('project.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(project, null, 2));
      await writable.close();
    } catch (e) {
      // Cloud-synced folders (OneDrive/Google Drive/Dropbox) can transiently lock the file mid-
      // sync, surfacing as e.g. "state cached in an interface object... changed since it was read
      // from disk" - one short retry clears most of these before giving up and surfacing an error.
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return writeProjectJsonToFolder(handle, project, attempt + 1);
      }
      throw e;
    }
  }

  async function readProjectJsonFromFolder(handle) {
    const fileHandle = await handle.getFileHandle('project.json');
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  }

  function exportProjectJson(project) {
    return JSON.stringify(project, null, 2);
  }

  function downloadProjectJson(project) {
    const json = exportProjectJson(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (project.projectName || 'project').replace(/[^A-Za-z0-9_-]+/g, '_');
    a.href = url;
    a.download = `BatAStat_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importProjectJson(jsonString, { asCopy = false } = {}) {
    const project = JSON.parse(jsonString);
    if (asCopy) {
      project.id = ns.Models.uid();
      project.projectName = (project.projectName || 'Project') + ' (copy)';
    }
    return project;
  }

  ns.Storage = {
    openDb,
    migrateFromOldDbOnce,
    saveProject,
    loadProject,
    listProjects,
    deleteProject,
    exportProjectJson,
    downloadProjectJson,
    importProjectJson,
    supportsFolderStorage,
    pickProjectFolder,
    saveFolderHandle,
    loadFolderHandle,
    deleteFolderHandle,
    writeProjectJsonToFolder,
    readProjectJsonFromFolder,
  };
})(window.BatID);
