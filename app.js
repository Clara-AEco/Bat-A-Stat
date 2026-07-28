const { useState, useEffect, useRef, useMemo } = React;
const h = React.createElement;
const M = window.BatID.Models;
const S = window.BatID.Storage;
const Bto = window.BatID.Bto;
const Wav = window.BatID.Wav;
const Dsp = window.BatID.Dsp;
const SpeciesData = window.BatID.SpeciesData;
const EmergenceData = window.BatID.EmergenceData;
const QaProfiles = window.BatID.QaProfiles;
const Sun = window.BatID.Sun;
const Stats = window.BatID.Stats;
const Exports = window.BatID.Exports;

const QA_OUTCOME_LABELS = {
  correct: 'Correct',
  'correct-but-incomplete': 'Correct but incomplete',
  'incorrect-species': 'Incorrect species',
  'incorrect-identification-level': 'Downgraded to genus (sonogram too degraded to call to species)',
  'reassigned-other': 'Reassigned (group/non-bat/unidentified)',
  'false-positive-noise': 'False positive - noise',
  'no-bto-primary': 'No BTO primary to grade',
  unresolved: 'Unresolved',
};

// Three-tier navigation, per Clara's own framing: a Deployment answers "what happened" (this
// list), a Location answers "how did it vary through the year" (LocationOverview's Time
// comparison section), and the Project/Site answers "how do locations compare to each other"
// (the sidebar's Compare Locations page). "Statistics" was split into General (effort/activity/
// species/timing/reliability - the headline numbers) and Night Activity (nightly variation +
// hourly pattern - the "when, and does it vary night to night" questions) so each tab answers one
// question rather than mixing both. "Comparisons" moved to the Location level entirely - it never
// belonged to a single deployment in the first place.
const DEPLOYMENT_TABS = [
  { id: 'overview', label: 'Overview', phase: 1 },
  { id: 'detections', label: 'Detections', phase: 2 },
  { id: 'qa', label: 'QA', phase: 4 },
  { id: 'review', label: 'Manual Review', phase: 3 },
  { id: 'general-stats', label: 'General Statistics', phase: 5 },
  { id: 'night-stats', label: 'Night Activity Statistics', phase: 5 },
  { id: 'figures', label: 'Figures', phase: 6 },
  { id: 'reports', label: 'Reports', phase: 8 },
];

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Bat-A-Stat: caught render error', error, info);
  }
  render() {
    if (this.state.error) {
      return h('div', { className: 'content' },
        h('div', { className: 'empty-state' },
          h('div', { className: 'empty-title' }, 'This section hit an error'),
          h('div', { className: 'empty-text' }, String(this.state.error && this.state.error.message || this.state.error)),
          h('button', { className: 'btn btn-primary', style: { marginTop: 16 }, onClick: () => this.setState({ error: null }) }, 'Try again')
        )
      );
    }
    return this.props.children;
  }
}

function Modal({ title, onClose, children }) {
  return h('div', { className: 'modal-overlay', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { className: 'modal' },
      h('div', { className: 'modal-title' }, title),
      children
    )
  );
}

function Field({ label, children }) {
  return h('div', { className: 'field' }, h('label', null, label), children);
}

// ---------------- Projects list (landing page) ----------------

function ProjectsListView({ projects, onOpen, onCreate, onImport, onOpenFromFolder, onDelete }) {
  const [showNew, setShowNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // project id awaiting confirmation
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  function openFromFolder() {
    setImportError(null);
    onOpenFromFolder().catch((err) => {
      if (err && err.name === 'AbortError') return; // user cancelled the folder picker - not an error
      setImportError(err && err.message ? err.message : String(err));
    });
  }

  return h('div', { className: 'content', style: { maxWidth: 720, margin: '0 auto' } },
    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Projects'),
      h('div', { style: { display: 'flex', gap: 8 } },
        onOpenFromFolder && h('button', { className: 'btn btn-secondary btn-small', onClick: openFromFolder }, '📁 Open from folder'),
        h('button', { className: 'btn btn-secondary btn-small', onClick: () => fileInputRef.current.click() }, 'Import JSON'),
        h('button', { className: 'btn btn-primary btn-small', onClick: () => setShowNew(true) }, '+ New project')
      )
    ),
    h('input', {
      ref: fileInputRef, type: 'file', accept: 'application/json', style: { display: 'none' },
      onChange: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          setImportError(null);
          try { onImport(reader.result); } catch (err) { setImportError(err.message); }
        };
        reader.readAsText(file);
        e.target.value = '';
      },
    }),
    importError && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--danger)' } }, `Could not open that project: ${importError}`),
    projects.length === 0 && h('div', { className: 'empty-state' },
      h('div', { className: 'empty-title' }, 'No projects yet'),
      h('div', { className: 'empty-text' }, 'Create a project to start organising Locations, Deployments and Detection Events for a survey site.')
    ),
    h('div', { className: 'card-list' },
      projects.map((p) => h('div', {
        key: p.id, className: 'card', style: { display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' },
        onClick: () => onOpen(p.id),
      },
        h('div', { style: { flex: 1 } },
          h('div', { className: 'card-title' }, p.projectName || '(untitled project)'),
          h('div', { className: 'card-sub' }, [p.client, p.siteName].filter(Boolean).join(' · ') || 'No client/site set'),
          h('div', { className: 'card-sub' }, `${(p.locations || []).length} location${(p.locations || []).length === 1 ? '' : 's'}`)
        ),
        h('button', { className: 'btn btn-danger btn-small', onClick: (e) => { e.stopPropagation(); setPendingDelete(p.id); } }, 'Delete')
      ))
    ),
    showNew && h(NewProjectModal, { onClose: () => setShowNew(false), onCreate: (fields) => { onCreate(fields); setShowNew(false); } }),
    pendingDelete && h(ConfirmModal, {
      title: 'Delete project?',
      text: 'This removes the project and everything inside it - every Location, Deployment and Detection Event. This cannot be undone.',
      onClose: () => setPendingDelete(null),
      onConfirm: () => { onDelete(pendingDelete); setPendingDelete(null); },
    })
  );
}

function NewProjectModal({ onClose, onCreate }) {
  const [client, setClient] = useState('');
  const [projectName, setProjectName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [notes, setNotes] = useState('');
  return h(Modal, { title: 'New project', onClose },
    h(Field, { label: 'Project name' }, h('input', { autoFocus: true, value: projectName, onChange: (e) => setProjectName(e.target.value), placeholder: 'e.g. Victoria Pleasure Ground' })),
    h(Field, { label: 'Client' }, h('input', { value: client, onChange: (e) => setClient(e.target.value) })),
    h(Field, { label: 'Site name' }, h('input', { value: siteName, onChange: (e) => setSiteName(e.target.value) })),
    h(Field, { label: 'Notes' }, h('textarea', { rows: 3, value: notes, onChange: (e) => setNotes(e.target.value) })),
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn btn-secondary', onClick: onClose }, 'Cancel'),
      h('button', { className: 'btn btn-primary', disabled: !projectName.trim(), onClick: () => onCreate({ client, projectName, siteName, notes }) }, 'Create')
    )
  );
}

// ---------------- Workspace (a single open project) ----------------

// Cloud-synced folders (OneDrive/Google Drive/Dropbox) transiently lock a file mid-sync, which
// surfaces from the File System Access API as a raw, alarming DOMException message. Translated
// to something that makes clear the browser copy (IndexedDB) is still safe regardless.
function friendlyFolderError(e) {
  const msg = e && e.message ? e.message : String(e);
  if (/state.*changed since it was read from disk|cached in an interface object/i.test(msg)) {
    return "Couldn't save to the linked folder just now - it may be mid-sync (e.g. OneDrive). Your data is safe in the browser and this will retry automatically on the next change.";
  }
  return `Couldn't save to the linked folder: ${msg}`;
}

function Workspace({ project, onChange, onBackToProjects, onExport }) {
  const [selection, setSelection] = useState({ locationId: null, deploymentId: null });
  const [activeTab, setActiveTab] = useState('overview');
  const [modal, setModal] = useState(null);
  // Site/Project-level page (Stage 7 - Level 2 location comparisons) - its own nav state, separate
  // from selection.locationId/deploymentId, since it's a third tier above both: a Location answers
  // "how did it vary through the year", the Site answers "how do Locations compare to each other".
  const [showSiteComparison, setShowSiteComparison] = useState(false);

  // Folder-linked storage: mirrors the project to a real project.json in a user-chosen folder,
  // so its location is up to the analyst and the whole project is shareable as that one folder.
  const [folderStatus, setFolderStatus] = useState('checking'); // checking | none | linked | permission-needed
  const [folderError, setFolderError] = useState(null);
  const folderHandleRef = useRef(null);
  const folderSaveTimer = useRef(null);

  // Tracks the most recently written project synchronously, so that several updateProject() calls
  // fired back-to-back in the same event handler (e.g. adding a custom label then setting a Final ID)
  // each build on the other's result instead of both cloning the same stale `project` prop and the
  // second one silently overwriting the first before React has re-rendered with the new prop.
  const latestProjectRef = useRef(project);
  useEffect(() => { latestProjectRef.current = project; }, [project]);

  useEffect(() => {
    let cancelled = false;
    setFolderStatus('checking');
    S.loadFolderHandle(project.id).then(async (handle) => {
      if (cancelled) return;
      if (!handle) { setFolderStatus('none'); return; }
      folderHandleRef.current = handle;
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        setFolderStatus(perm === 'granted' ? 'linked' : 'permission-needed');
      } catch (e) {
        setFolderStatus('permission-needed');
      }
    }).catch(() => setFolderStatus('none'));
    return () => { cancelled = true; };
  }, [project.id]);

  async function linkFolder() {
    try {
      const handle = await S.pickProjectFolder();
      await S.saveFolderHandle(project.id, handle);
      folderHandleRef.current = handle;
      await S.writeProjectJsonToFolder(handle, project);
      setFolderStatus('linked');
      setFolderError(null);
    } catch (e) {
      if (e.name !== 'AbortError') setFolderError(friendlyFolderError(e));
    }
  }

  async function reconnectFolder() {
    if (!folderHandleRef.current) return;
    try {
      const perm = await folderHandleRef.current.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        setFolderStatus('linked');
        await S.writeProjectJsonToFolder(folderHandleRef.current, project);
        setFolderError(null);
      }
    } catch (e) {
      setFolderError(friendlyFolderError(e));
    }
  }

  async function unlinkFolder() {
    await S.deleteFolderHandle(project.id);
    folderHandleRef.current = null;
    setFolderStatus('none');
  }

  const selectedLocation = selection.locationId ? M.findLocation(project, selection.locationId) : null;
  const selectedDeployment = selection.deploymentId
    ? (M.findDeployment(project, selection.deploymentId) || {}).deployment
    : null;

  function updateProject(mutator) {
    const next = structuredClone(latestProjectRef.current);
    mutator(next);
    latestProjectRef.current = next;
    onChange(next);
    if (folderStatus === 'linked' && folderHandleRef.current) {
      if (folderSaveTimer.current) clearTimeout(folderSaveTimer.current);
      folderSaveTimer.current = setTimeout(() => {
        S.writeProjectJsonToFolder(folderHandleRef.current, next)
          .then(() => setFolderError(null)) // a later successful save must clear any earlier error - it was staying on screen forever otherwise
          .catch((e) => setFolderError(friendlyFolderError(e)));
      }, 500);
    }
  }

  function addLocation(fields) {
    updateProject((p) => { p.locations.push(M.createLocation(fields)); });
    setModal(null);
  }

  function addDeployment(locationId, fields) {
    updateProject((p) => {
      const loc = M.findLocation(p, locationId);
      const dep = M.createDeployment(fields);
      loc.deployments.push(dep);
      setSelection({ locationId, deploymentId: dep.id });
    });
    setModal(null);
    setActiveTab('overview');
  }

  function deleteLocation(locationId) {
    updateProject((p) => { p.locations = p.locations.filter((l) => l.id !== locationId); });
    setSelection({ locationId: null, deploymentId: null });
    setModal(null);
  }

  function deleteDeployment(locationId, deploymentId) {
    updateProject((p) => {
      const loc = M.findLocation(p, locationId);
      loc.deployments = loc.deployments.filter((d) => d.id !== deploymentId);
    });
    setSelection({ locationId, deploymentId: null });
    setModal(null);
  }

  function patchDeployment(deploymentId, patch) {
    updateProject((p) => {
      const found = M.findDeployment(p, deploymentId);
      if (found) Object.assign(found.deployment, patch);
    });
  }

  function patchLocation(locationId, patch) {
    updateProject((p) => {
      const loc = M.findLocation(p, locationId);
      if (loc) Object.assign(loc, patch);
    });
  }

  function patchDetectionEvent(deploymentId, eventId, patch) {
    updateProject((p) => {
      const found = M.findDeployment(p, deploymentId);
      if (!found) return;
      const ev = (found.deployment.detectionEvents || []).find((e) => e.id === eventId);
      if (ev) Object.assign(ev, patch);
    });
  }

  function addCustomLabel(label) {
    updateProject((p) => {
      p.customLabels = p.customLabels || [];
      if (!p.customLabels.includes(label)) p.customLabels.push(label);
    });
  }

  function importBtoFile(deploymentId, csvText, fileName) {
    let result = null;
    let error = null;
    updateProject((p) => {
      const found = M.findDeployment(p, deploymentId);
      if (found) {
        try {
          result = Bto.importBtoIntoDeployment(found.deployment, csvText, fileName);
        } catch (e) {
          error = e.message;
        }
      }
    });
    return { result, error };
  }

  const treeChildren = [];
  (project.locations || []).forEach((loc) => {
    treeChildren.push(h('div', {
      key: loc.id,
      className: 'tree-node tree-node-location' + (selection.locationId === loc.id && !selection.deploymentId && !showSiteComparison ? ' tree-node-active' : ''),
      onClick: () => { setShowSiteComparison(false); setSelection({ locationId: loc.id, deploymentId: null }); setActiveTab('overview'); },
    },
      h('span', { style: { flex: 1 } }, loc.name || '(untitled location)'),
      h('span', { className: 'badge-count' }, String((loc.deployments || []).length))
    ));
    (loc.deployments || []).forEach((dep) => {
      treeChildren.push(h('div', {
        key: dep.id,
        className: 'tree-node tree-indent' + (selection.deploymentId === dep.id && !showSiteComparison ? ' tree-node-active' : ''),
        onClick: () => { setShowSiteComparison(false); setSelection({ locationId: loc.id, deploymentId: dep.id }); setActiveTab('overview'); },
      }, dep.name || '(untitled deployment)'));
    });
    treeChildren.push(h('button', {
      key: loc.id + '-add', className: 'tree-add-btn tree-indent',
      onClick: () => setModal({ kind: 'newDeployment', locationId: loc.id }),
    }, '+ Add deployment'));
  });

  let mainContent;
  if (showSiteComparison) {
    mainContent = h(SiteComparisonPage, { project });
  } else if (!selectedLocation) {
    mainContent = h('div', { className: 'empty-state' },
      h('div', { className: 'empty-title' }, 'Select or create a Location'),
      h('div', { className: 'empty-text' }, 'Locations are persistent monitoring points (e.g. "East boundary", "Woodland edge") that can receive repeated Deployments over multiple years.')
    );
  } else if (!selectedDeployment) {
    mainContent = h(LocationOverview, {
      location: selectedLocation,
      onPatch: (patch) => patchLocation(selectedLocation.id, patch),
      onDelete: () => setModal({ kind: 'deleteLocation', locationId: selectedLocation.id }),
      onAddDeployment: () => setModal({ kind: 'newDeployment', locationId: selectedLocation.id }),
    });
  } else {
    mainContent = h(DeploymentPanel, {
      project,
      location: selectedLocation,
      deployment: selectedDeployment,
      activeTab,
      setActiveTab,
      onPatch: (patch) => patchDeployment(selectedDeployment.id, patch),
      onDelete: () => setModal({ kind: 'deleteDeployment', locationId: selectedLocation.id, deploymentId: selectedDeployment.id }),
      onImportBto: (csvText, fileName) => importBtoFile(selectedDeployment.id, csvText, fileName),
      onPatchEvent: (eventId, patch) => patchDetectionEvent(selectedDeployment.id, eventId, patch),
      customLabels: project.customLabels || [],
      onAddCustomLabel: addCustomLabel,
    });
  }

  return h('div', { className: 'app-shell' },
    h('div', { className: 'sidebar' },
      h('div', { className: 'sidebar-header' },
        h('div', { className: 'sidebar-app-name' }, project.projectName || '(untitled project)'),
        h('div', { className: 'sidebar-app-sub' }, [project.client, project.siteName].filter(Boolean).join(' · ') || 'Bat-A-Stat')
      ),
      h('div', { className: 'sidebar-section', style: { display: 'flex', gap: 6 } },
        h('button', { className: 'btn btn-secondary btn-small', style: { flex: 1 }, onClick: onBackToProjects }, '← Projects'),
        h('button', { className: 'btn btn-secondary btn-small', style: { flex: 1 }, onClick: onExport }, 'Export')
      ),
      (project.locations || []).length >= 1 && h('div', { className: 'sidebar-section' },
        h('button', {
          className: 'btn btn-small' + (showSiteComparison ? ' btn-primary' : ' btn-secondary'),
          style: { width: '100%' },
          onClick: () => setShowSiteComparison(true),
        }, '📊 Compare Locations')
      ),
      S.supportsFolderStorage && h('div', { className: 'sidebar-section' },
        folderStatus === 'none' && h('button', { className: 'btn btn-secondary btn-small', style: { width: '100%' }, onClick: linkFolder }, '📁 Link to a folder'),
        folderStatus === 'linked' && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { className: 'card-sub', style: { color: 'var(--teal)' } }, '📁 Saved to linked folder'),
          h('button', { className: 'btn btn-secondary btn-small', onClick: unlinkFolder }, 'Unlink')
        ),
        folderStatus === 'permission-needed' && h('button', { className: 'btn btn-secondary btn-small', style: { width: '100%' }, onClick: reconnectFolder }, '📁 Reconnect folder'),
        folderError && h('div', { className: 'card-sub', style: { color: 'var(--danger)', marginTop: 4 } }, folderError)
      ),
      h('div', { className: 'sidebar-section', style: { flex: 1 } },
        h('div', { className: 'sidebar-section-title' },
          h('span', null, 'Locations'),
          h('span', { className: 'badge-count' }, String((project.locations || []).length))
        ),
        h('div', { className: 'tree' }, treeChildren),
        h('button', { className: 'tree-add-btn', style: { marginTop: 8 }, onClick: () => setModal({ kind: 'newLocation' }) }, '+ Add location')
      )
    ),
    h('div', { className: 'main' }, mainContent),
    modal && modal.kind === 'newLocation' && h(NewLocationModal, { onClose: () => setModal(null), onCreate: addLocation }),
    modal && modal.kind === 'newDeployment' && h(NewDeploymentModal, { onClose: () => setModal(null), onCreate: (fields) => addDeployment(modal.locationId, fields) }),
    modal && modal.kind === 'deleteLocation' && h(ConfirmModal, {
      title: 'Delete location?',
      text: 'This removes the location and every deployment/detection event inside it. This cannot be undone.',
      onClose: () => setModal(null),
      onConfirm: () => deleteLocation(modal.locationId),
    }),
    modal && modal.kind === 'deleteDeployment' && h(ConfirmModal, {
      title: 'Delete deployment?',
      text: 'This removes the deployment and every detection event inside it. This cannot be undone.',
      onClose: () => setModal(null),
      onConfirm: () => deleteDeployment(modal.locationId, modal.deploymentId),
    })
  );
}

function ConfirmModal({ title, text, onClose, onConfirm }) {
  return h(Modal, { title, onClose },
    h('p', { style: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 } }, text),
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn btn-secondary', onClick: onClose }, 'Cancel'),
      h('button', { className: 'btn btn-danger', onClick: onConfirm }, 'Delete')
    )
  );
}

function NewLocationModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  return h(Modal, { title: 'New location', onClose },
    h(Field, { label: 'Name' }, h('input', { autoFocus: true, value: name, onChange: (e) => setName(e.target.value), placeholder: 'e.g. East boundary' })),
    h(Field, { label: 'Notes' }, h('textarea', { rows: 3, value: notes, onChange: (e) => setNotes(e.target.value) })),
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn btn-secondary', onClick: onClose }, 'Cancel'),
      h('button', { className: 'btn btn-primary', disabled: !name.trim(), onClick: () => onCreate({ name, notes }) }, 'Create')
    )
  );
}

function NewDeploymentModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  return h(Modal, { title: 'New deployment', onClose },
    h(Field, { label: 'Name' }, h('input', { autoFocus: true, value: name, onChange: (e) => setName(e.target.value), placeholder: 'e.g. June 2026' })),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Start date' }, h('input', { type: 'date', value: startDate, onChange: (e) => setStartDate(e.target.value) })),
      h(Field, { label: 'End date' }, h('input', { type: 'date', value: endDate, onChange: (e) => setEndDate(e.target.value) }))
    ),
    h('div', { className: 'modal-actions' },
      h('button', { className: 'btn btn-secondary', onClick: onClose }, 'Cancel'),
      h('button', { className: 'btn btn-primary', disabled: !name.trim(), onClick: () => onCreate({ name, startDate, endDate }) }, 'Create')
    )
  );
}

function LocationOverview({ location, onPatch, onDelete, onAddDeployment }) {
  return h(React.Fragment, null,
    h('div', { className: 'main-header' },
      h('div', null,
        h('div', { className: 'main-title' }, location.name || '(untitled location)'),
        h('div', { className: 'main-subtitle' }, `Location · ${(location.deployments || []).length} deployment(s)`)
      ),
      h('div', { className: 'main-actions' },
        h('button', { className: 'btn btn-primary btn-small', onClick: onAddDeployment }, '+ Add deployment'),
        h('button', { className: 'btn btn-danger btn-small', onClick: onDelete }, 'Delete location')
      )
    ),
    h('div', { className: 'content' },
      h('div', { className: 'section-title' }, 'Details'),
      h(Field, { label: 'Name' }, h('input', { value: location.name, onChange: (e) => onPatch({ name: e.target.value }) })),
      h(Field, { label: 'Notes' }, h('textarea', { rows: 4, value: location.notes, onChange: (e) => onPatch({ notes: e.target.value }) })),
      h('div', { className: 'field-row' },
        h(Field, { label: 'Latitude' }, h('input', {
          type: 'number', step: 'any', value: location.latitude ?? '', placeholder: 'e.g. 50.964',
          onChange: (e) => onPatch({ latitude: e.target.value === '' ? null : Number(e.target.value) }),
        })),
        h(Field, { label: 'Longitude' }, h('input', {
          type: 'number', step: 'any', value: location.longitude ?? '', placeholder: 'e.g. 0.094',
          onChange: (e) => onPatch({ longitude: e.target.value === '' ? null : Number(e.target.value) }),
        }))
      ),
      (location.latitude == null || location.longitude == null) && h('div', { className: 'card-sub', style: { marginTop: -8, marginBottom: 14 } },
        "Sets this Location's coordinates for sunset-relative activity timing in Statistics/Figures - without these, timing falls back to raw clock time."),
      h('div', { className: 'section-title' }, 'Deployments'),
      (location.deployments || []).length === 0 && h('div', { className: 'card-sub' }, 'No deployments yet.'),
      h('div', { className: 'card-list' },
        (location.deployments || []).map((d) => h('div', { key: d.id, className: 'card' },
          h('div', { className: 'card-title' }, d.name || '(untitled)'),
          h('div', { className: 'card-sub' }, `${d.startDate || '?'} → ${d.endDate || '?'} · ${(d.detectionEvents || []).length} detection event(s)`)
        ))
      ),
      h('div', { className: 'section-title', style: { marginTop: 24 } }, `Time comparison - deployments along the year at ${location.name || 'this location'}`),
      h(LocationTimeComparison, { location })
    )
  );
}

function DeploymentPanel({ project, location, deployment, activeTab, setActiveTab, onPatch, onDelete, onImportBto, onPatchEvent, customLabels, onAddCustomLabel }) {
  const [wavFileMap, setWavFileMap] = useState(new Map());
  let tabContent;
  if (activeTab === 'overview') {
    tabContent = h(DeploymentOverviewTab, { deployment, onPatch, wavFileMap, location });
  } else if (activeTab === 'detections') {
    tabContent = h(DetectionsTab, { deployment, onImportBto });
  } else if (activeTab === 'qa') {
    tabContent = h(QaTab, { deployment, onPatch, wavFileMap, setWavFileMap, onGoToReview: () => setActiveTab('review') });
  } else if (activeTab === 'review') {
    tabContent = h(ReviewTab, { deployment, onPatchEvent, wavFileMap, setWavFileMap, customLabels, onAddCustomLabel });
  } else if (activeTab === 'general-stats') {
    tabContent = h(GeneralStatisticsTab, { deployment, location });
  } else if (activeTab === 'night-stats') {
    tabContent = h(NightActivityStatisticsTab, { deployment, location, onPatch });
  } else if (activeTab === 'figures') {
    tabContent = h(FigureWorkspaceTab, { deployment, location, onPatch });
  } else if (activeTab === 'reports') {
    tabContent = h(ReportsTab, { project, deployment, location });
  } else {
    tabContent = h(ComingSoonTab, { tab: DEPLOYMENT_TABS.find((t) => t.id === activeTab) });
  }
  return h(React.Fragment, null,
    h('div', { className: 'main-header' },
      h('div', null,
        h('div', { className: 'main-title' }, deployment.name || '(untitled deployment)'),
        h('div', { className: 'main-subtitle' }, `${location.name} · ${deployment.startDate || '?'} → ${deployment.endDate || '?'}`)
      ),
      h('div', { className: 'main-actions' },
        h('button', { className: 'btn btn-danger btn-small', onClick: onDelete }, 'Delete deployment')
      )
    ),
    h('div', { className: 'tab-bar' },
      DEPLOYMENT_TABS.map((t) => h('button', {
        key: t.id,
        className: 'tab-btn' + (activeTab === t.id ? ' tab-btn-active' : ''),
        onClick: () => setActiveTab(t.id),
      }, t.label))
    ),
    h(ErrorBoundary, { key: activeTab }, tabContent)
  );
}

function DetectionsTab({ deployment, onImportBto }) {
  const fileInputRef = useRef(null);
  const [importMsg, setImportMsg] = useState(null);
  const events = deployment.detectionEvents || [];

  const groupCounts = {};
  const speciesCounts = {};
  for (const ev of events) {
    const primary = ev.primaryBtoId;
    const group = primary ? (primary.group || 'bat') : 'no-id';
    groupCounts[group] = (groupCounts[group] || 0) + 1;
    const label = primary ? (primary.englishName || primary.species) : 'No ID';
    speciesCounts[label] = (speciesCounts[label] || 0) + 1;
  }
  const speciesRows = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
  const previewEvents = events.slice(0, 150);
  const resolvedRecordCount = events.reduce((s, ev) => s + M.resolveSpeciesRecords(ev).length, 0);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { result, error } = onImportBto(reader.result, file.name);
      if (error) setImportMsg({ ok: false, text: error });
      else {
        const dupText = result.duplicateRowCount > 0 ? ` (${result.duplicateRowCount} row(s) skipped - already imported for this deployment)` : '';
        setImportMsg({ ok: true, text: `Imported ${file.name}: ${result.rowCount} rows -> ${result.eventCount} detection events, ${result.recordCount} species detection records${dupText}.` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return h('div', { className: 'content' },
    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'BTO imports'),
      h('button', { className: 'btn btn-primary btn-small', onClick: () => fileInputRef.current.click() }, '+ Import BTO CSV')
    ),
    h('input', { ref: fileInputRef, type: 'file', accept: '.csv,text/csv', style: { display: 'none' }, onChange: handleFile }),
    importMsg && h('div', { className: 'card-sub', style: { color: importMsg.ok ? 'var(--teal)' : 'var(--danger)', marginBottom: 10 } }, importMsg.text),
    (deployment.btoImports || []).length === 0
      ? h('div', { className: 'card-sub' }, 'No BTO exports imported yet for this deployment.')
      : h('div', { className: 'card-list' },
          (deployment.btoImports || []).map((imp) => h('div', { key: imp.id, className: 'card' },
            h('div', { className: 'card-title' }, imp.fileName),
            h('div', { className: 'card-sub' }, `${imp.rowCount} rows -> ${imp.eventCount} detection events${imp.duplicateRowCount ? ` (${imp.duplicateRowCount} skipped as duplicates)` : ''} · imported ${new Date(imp.importedAt).toLocaleString()}`)
          ))
        ),

    h('div', { className: 'section-title' }, 'Detection Events'),
    h('div', { className: 'stat-grid' },
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Total events'), h('div', { className: 'stat-box-value' }, String(events.length))),
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Resolved species records'), h('div', { className: 'stat-box-value' }, String(resolvedRecordCount))),
      Object.entries(groupCounts).map(([g, c]) => h('div', { className: 'stat-box', key: g },
        h('div', { className: 'stat-box-label' }, g), h('div', { className: 'stat-box-value' }, String(c))
      ))
    ),

    speciesRows.length > 0 && h(React.Fragment, null,
      h('div', { className: 'section-title' }, 'By primary species'),
      h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
          h('tbody', null,
            speciesRows.map(([label, count]) => h('tr', { key: label },
              h('td', { style: { padding: '6px 12px', borderBottom: '1px solid var(--border)' } }, label),
              h('td', { style: { padding: '6px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--font-mono)' } }, String(count))
            ))
          )
        )
      )
    ),

    events.length > 0 && h(React.Fragment, null,
      h('div', { className: 'section-title' }, `Preview (first ${previewEvents.length} of ${events.length})`),
      h('div', { className: 'card', style: { padding: 0, overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' } },
          h('thead', null, h('tr', null,
            ['WAV', 'Part', 'Primary ID', 'Prob.', 'Group', 'Candidates', 'Warnings'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 11, textTransform: 'uppercase' },
            }, c))
          )),
          h('tbody', null,
            previewEvents.map((ev) => h('tr', { key: ev.id },
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.originalWav),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.partNumber),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID'),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.primaryBtoId && ev.primaryBtoId.probability != null ? ev.primaryBtoId.probability.toFixed(2) : ''),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.primaryBtoId ? ev.primaryBtoId.group : ''),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center' } }, ev.candidateSpecies.length),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)' } }, ev.primaryBtoId ? ev.primaryBtoId.warnings : '')
            ))
          )
        )
      )
    )
  );
}

function ComingSoonTab({ tab }) {
  return h('div', { className: 'content' },
    h('div', { className: 'empty-state' },
      h('span', { className: 'pill pill-coming-soon', style: { marginBottom: 14 } }, `Phase ${tab.phase}`),
      h('div', { className: 'empty-title' }, `${tab.label} — coming soon`),
      h('div', { className: 'empty-text' }, `This tab is built in Phase ${tab.phase} of the Bat-A-Stat build. The Project/Location/Deployment structure you're setting up now will feed straight into it.`)
    )
  );
}

function fmtNum(v, digits) {
  return v == null || isNaN(v) ? '-' : v.toFixed(digits == null ? 1 : digits);
}
function fmtHour(h) {
  if (h == null) return '-';
  const sign = h < 0 ? '-' : '';
  const abs = Math.abs(h);
  const hh = Math.floor(abs), mm = Math.round((abs - hh) * 60);
  return `${sign}${hh}h${String(mm).padStart(2, '0')}m`;
}
function fmtDateTime(d) {
  return d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
}
// surveyDate/actualDate are stored dd/mm/yyyy (BTO's own convention, see stats.js's
// parseDdMmYyyy) - NOT the yyyy-mm-dd it might look like at a glance.
function parseSurveyDate(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// One coloured line per survey night, abundance on the y-axis - back to the line-chart shape
// Clara confirmed she wants, but at finer resolution: 15-minute bins instead of the table's 1-hour
// bins above, so a peak's actual shape shows rather than being flattened into one hourly total.
// Only whole-hour bins get an x-axis label - labelling every 15-minute gridline would be unreadable
// clutter - though the line itself still passes through all four quarter-hour points within each
// hour. Also overlays typical emergence/return reference times when a single named species is
// selected. The overlay only appears in sunset-relative mode: clock time has no fixed zero-point to
// measure emergence/return from. Return times in the source data are reported as minutes before
// SUNRISE, not sunset, so they're converted onto this chart's sunset-relative axis using one
// representative night from the current view (the middle night by date) - an approximation, since
// day length shifts slightly across a real deployment, but reference lines are inherently "typical",
// not exact.
const NIGHT_LINE_COLORS = ['#e6923a', '#4da3ff', '#7dd87d', '#c77dff', '#ff7d9c', '#ffd93d', '#7ddede', '#ff9f7d', '#a3a3ff', '#b3e05c', '#e05cae', '#5cc9e0'];

function ActivityLineChart({ hourly, filter, location, selectedNights, onToggleNight }) {
  const bins = hourly.bins;
  if (!bins.length || !hourly.rows.length) return null;
  // Ticking a night out of the chart hides its line and rescales the y-axis to whatever's left
  // visible (rather than keeping the full-dataset scale) - lets a couple of quieter nights be
  // compared in detail once the busiest night's line stops flattening everything else. The table
  // above still always shows every night regardless of this selection - only the chart is filtered.
  const visibleRows = selectedNights ? hourly.rows.filter((r) => selectedNights.has(r.surveyDate)) : hourly.rows;
  // Colour assignment stays keyed to each night's position in the FULL row list, not the filtered
  // one - otherwise a night's colour would shift every time a different night gets ticked in/out.
  const colorForNight = new Map(hourly.rows.map((r, i) => [r.surveyDate, NIGHT_LINE_COLORS[i % NIGHT_LINE_COLORS.length]]));
  const width = 720, height = 240;
  const padding = { top: 14, right: 16, bottom: 32, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...(visibleRows.length ? visibleRows : hourly.rows).flatMap((r) => r.counts));

  // Positioned by each bin's actual time VALUE, not its array index - bins only include
  // quarter-hours that had activity on at least one night, so a 15-minute slot with zero activity
  // everywhere is simply absent from the array. Index-based spacing would silently compress that
  // gap on the x-axis (squeezing the next bin closer than its real time difference warrants).
  // Clock-hour bins additionally wrap at midnight (sorted rotated around midday, not by raw value -
  // see computeHourlyActivity's own comment), so "unwrap" them into a continuous increasing
  // sequence first (adding 24 every time the sequence drops) - sunset-relative bins never wrap, so
  // this is a no-op for them and unwrapped === raw throughout.
  const unwrapped = [];
  let offset = 0;
  for (let i = 0; i < bins.length; i++) {
    if (i > 0 && bins[i] < bins[i - 1]) offset += 24;
    unwrapped[i] = bins[i] + offset;
  }
  const minUnwrapped = unwrapped[0], maxUnwrapped = unwrapped[unwrapped.length - 1];
  const span = Math.max(hourly.binSizeHours, maxUnwrapped - minUnwrapped);

  function xForUnwrapped(u) { return padding.left + ((u - minUnwrapped) / span) * plotWidth; }
  function yForValue(v) { return padding.top + plotHeight - (v / maxVal) * plotHeight; }
  function tickLabel(tick) {
    return hourly.sunsetRelative ? `${tick >= 0 ? '+' : ''}${tick}h` : `${String(((tick % 24) + 24) % 24).padStart(2, '0')}:00`;
  }
  const tickUnwrapped = [];
  for (let u = Math.ceil(minUnwrapped); u <= Math.floor(maxUnwrapped); u++) tickUnwrapped.push(u);

  let overlay = null;
  if (hourly.sunsetRelative && filter.type === 'species' && filter.value) {
    const ref = EmergenceData.lookup(filter.value);
    if (ref) {
      // Sunset-relative bins never wrap, so unwrapped === raw here - safe to position an arbitrary
      // hour value (not necessarily one of the bins themselves) the same way as a tick.
      const xForSunsetHour = xForUnwrapped;
      const emergenceHour = ref.emergence && ref.emergence.meanMinutes != null ? ref.emergence.meanMinutes / 60 : null;
      const emergenceRange = ref.emergence && ref.emergence.rangeMinutes ? ref.emergence.rangeMinutes.map((m) => m / 60) : null;

      let returnHour = null, returnRange = null;
      if (ref.return && ref.return.meanMinutes != null && location && location.latitude != null && location.longitude != null) {
        const midNight = hourly.rows[Math.floor(hourly.rows.length / 2)];
        const d = midNight ? parseSurveyDate(midNight.surveyDate) : null;
        if (d) {
          const nextDay = new Date(d); nextDay.setDate(nextDay.getDate() + 1);
          const { sunset } = Sun.sunTimes(d, location.latitude, location.longitude);
          const { sunrise } = Sun.sunTimes(nextDay, location.latitude, location.longitude);
          if (sunset && sunrise) {
            const durationHours = (sunrise.getTime() - sunset.getTime()) / (1000 * 60 * 60);
            returnHour = durationHours - ref.return.meanMinutes / 60;
            if (ref.return.rangeMinutes) returnRange = ref.return.rangeMinutes.map((m) => durationHours - m / 60).sort((a, b) => a - b);
          }
        }
      }
      overlay = { ref, emergenceHour, emergenceRange, returnHour, returnRange, xForSunsetHour };
    }
  }

  return h('div', { style: { marginTop: 10 } },
    h('svg', { viewBox: `0 0 ${width} ${height}`, style: { width: '100%', height: 'auto', display: 'block' } },
      [0, 0.5, 1].map((f) => h('line', {
        key: 'grid' + f, x1: padding.left, x2: width - padding.right, y1: yForValue(maxVal * f), y2: yForValue(maxVal * f),
        stroke: 'var(--border)', strokeWidth: 1,
      })),
      [0, 0.5, 1].map((f) => h('text', {
        key: 'lbl' + f, x: padding.left - 6, y: yForValue(maxVal * f) + 3, textAnchor: 'end', fontSize: 9, fill: 'var(--text-faint)',
      }, fmtNum(maxVal * f, 0))),
      overlay && overlay.emergenceRange && h('rect', {
        key: 'erange', x: overlay.xForSunsetHour(overlay.emergenceRange[0]),
        width: Math.max(0, overlay.xForSunsetHour(overlay.emergenceRange[1]) - overlay.xForSunsetHour(overlay.emergenceRange[0])),
        y: padding.top, height: plotHeight, fill: '#4da3ff', opacity: 0.12,
      }),
      overlay && overlay.returnRange && h('rect', {
        key: 'rrange', x: overlay.xForSunsetHour(overlay.returnRange[0]),
        width: Math.max(0, overlay.xForSunsetHour(overlay.returnRange[1]) - overlay.xForSunsetHour(overlay.returnRange[0])),
        y: padding.top, height: plotHeight, fill: '#c77dff', opacity: 0.12,
      }),
      visibleRows.map((r) => h('polyline', {
        key: r.surveyDate,
        points: r.counts.map((v, i) => `${xForUnwrapped(unwrapped[i])},${yForValue(v)}`).join(' '),
        fill: 'none', stroke: colorForNight.get(r.surveyDate), strokeWidth: 1.5, opacity: 0.9,
      })),
      overlay && overlay.emergenceHour != null && h('line', {
        key: 'eline', x1: overlay.xForSunsetHour(overlay.emergenceHour), x2: overlay.xForSunsetHour(overlay.emergenceHour),
        y1: padding.top, y2: height - padding.bottom, stroke: '#4da3ff', strokeWidth: 1.5, strokeDasharray: '4 2',
      }),
      overlay && overlay.returnHour != null && h('line', {
        key: 'rline', x1: overlay.xForSunsetHour(overlay.returnHour), x2: overlay.xForSunsetHour(overlay.returnHour),
        y1: padding.top, y2: height - padding.bottom, stroke: '#c77dff', strokeWidth: 1.5, strokeDasharray: '4 2',
      }),
      tickUnwrapped.map((u) => h('text', {
        key: 'x' + u, x: xForUnwrapped(u), y: height - padding.bottom + 14, textAnchor: 'middle', fontSize: 9, fill: 'var(--text-faint)',
      }, tickLabel(u)))
    ),
    h('div', { style: { display: 'flex', gap: '2px 10px', fontSize: 11, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' } },
      hourly.rows.map((r) => {
        const isVisible = !selectedNights || selectedNights.has(r.surveyDate);
        return h('label', {
          key: r.surveyDate,
          style: { display: 'flex', alignItems: 'center', gap: 4, cursor: onToggleNight ? 'pointer' : 'default', color: isVisible ? colorForNight.get(r.surveyDate) : 'var(--text-faint)' },
        },
          onToggleNight && h('input', { type: 'checkbox', checked: isVisible, onChange: () => onToggleNight(r.surveyDate), style: { margin: 0 } }),
          r.surveyDate
        );
      }),
      overlay && overlay.emergenceHour != null && h('span', { style: { color: '#4da3ff' } }, `┊ Typical emergence (${overlay.ref.emergence.source})`),
      overlay && overlay.returnHour != null && h('span', { style: { color: '#c77dff' } }, `┊ Typical return (${overlay.ref.return.source})`)
    ),
    !overlay && filter.type === 'species' && filter.value && !hourly.sunsetRelative && h('div', { className: 'card-sub', style: { marginTop: 4 } },
      "Set this Location's Latitude/Longitude (on its Details tab) to overlay typical emergence/return times for this species."),
    !overlay && filter.type === 'species' && filter.value && hourly.sunsetRelative && !EmergenceData.lookup(filter.value) && h('div', { className: 'card-sub', style: { marginTop: 4 } },
      'No emergence/return reference data available for this species.')
  );
}

function GeneralStatisticsTab({ deployment, location }) {
  const stats = useMemo(() => Stats.computeAllStats(deployment, location, ALL_SPECIES_NAMES), [deployment, location]);
  const { effort, activity, species, speciesQaAdjusted, reliability, reliabilityByProbabilityBand, reliabilityBySpecies, confusionBreakdown, totalDetectionEvents, totalSpeciesRecords } = stats;
  const [expandedSpecies, setExpandedSpecies] = useState(() => new Set());
  const [speciesView, setSpeciesView] = useState('raw'); // 'raw' | 'qa-adjusted'
  // Sunset-relative is the default (matches the rest of the app's convention); sunrise-relative
  // (corrective brief section 10.4) is a separate reference system for pre-dawn/return-timing
  // questions - recomputed on demand rather than baked into computeAllStats' one default.
  const [timingReference, setTimingReference] = useState('sunset'); // 'sunset' | 'sunrise'
  const timing = useMemo(() => Stats.computeTimingStats(stats.dataset, location, timingReference), [stats.dataset, location, timingReference]);
  const confusionBySpecies = useMemo(() => new Map((confusionBreakdown || []).map((c) => [c.species, c])), [confusionBreakdown]);

  function toggleExpanded(sp) {
    setExpandedSpecies((prev) => {
      const next = new Set(prev);
      if (next.has(sp)) next.delete(sp); else next.add(sp);
      return next;
    });
  }

  if (totalDetectionEvents === 0) {
    return h('div', { className: 'content' },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No detections to analyse yet'),
        h('div', { className: 'empty-text' }, 'Import a BTO CSV on the Detections tab first.')
      )
    );
  }

  return h('div', { className: 'content' },
    totalSpeciesRecords !== totalDetectionEvents && h('div', { className: 'card', style: { marginBottom: 16, color: 'var(--text-muted)', fontSize: 12 } },
      `${totalDetectionEvents} Detection Events resolved to ${totalSpeciesRecords} Species Detection Records - the difference is calls where manual review confirmed more than one species in the same recording.`),

    h('div', { className: 'section-title' }, 'QA reliability (observed, this deployment)'),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      "Based on manually reviewed calls that had a BTO primary result to check against. Describes what was observed under this deployment's own recording conditions, not a general BTO accuracy figure. Every percentage below carries its 95% confidence interval - treat the interval, not just the headline number, as the honest answer when the sample is small."),
    reliability.reviewedSampleSize === 0
      ? h('div', { className: 'card-sub' }, 'No reviewed calls with a BTO primary result yet - reliability will appear here once some QA has been done.')
      : h(React.Fragment, null,
          h('div', { className: 'stat-grid' },
            h(StatBox, { label: 'Primary-ID reliability', value: fmtNum(reliability.primaryIdReliabilityPct) + '%', sub: fmtCi(reliability.primaryIdReliabilityCiLowerPct, reliability.primaryIdReliabilityCiUpperPct) }),
            h(StatBox, { label: 'Complete-event reliability', value: fmtNum(reliability.completeEventReliabilityPct) + '%', sub: fmtCi(reliability.completeEventReliabilityCiLowerPct, reliability.completeEventReliabilityCiUpperPct) }),
            h(StatBox, { label: 'Additional-species yield', value: fmtNum(reliability.additionalSpeciesRatePct) + '%', sub: (fmtCi(reliability.additionalSpeciesRateCiLowerPct, reliability.additionalSpeciesRateCiUpperPct) || '') + ` · ${reliability.additionalSpeciesRecordCount} extra record(s)` }),
            h(StatBox, { label: 'Genus-level downgrade rate', value: fmtNum(reliability.genusLevelRatePct) + '%' }),
            h(StatBox, { label: 'Primary-ID judged sample (n)', value: reliability.primaryIdJudgedSampleSize }),
            h(StatBox, { label: 'Reviewed sample (n)', value: reliability.reviewedSampleSize })
          ),
          h('div', { className: 'card-sub', style: { marginTop: 6 } },
            'Primary-ID reliability excludes calls downgraded to genus level (e.g. "Myotis sp") from its sample - a sonogram too degraded to confirm or refute species-level accuracy isn\'t evidence either way, so those are tracked separately as the genus-level downgrade rate instead of counting against BTO.'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10, fontSize: 12, fontFamily: 'var(--font-mono)' } },
            Object.entries(reliability.byOutcome).map(([outcome, count]) => h('span', { key: outcome }, `${QA_OUTCOME_LABELS[outcome] || outcome}: ${count}`))
          ),

          h('div', { className: 'card-sub', style: { marginTop: 20, marginBottom: 6, fontWeight: 600 } }, 'By BTO confidence band'),
          h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
            h('div', { style: { overflowX: 'auto' } },
              h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                h('thead', null, h('tr', null,
                  ['BTO probability', 'Primary-ID reliability', '95% CI', 'Judged (n)', 'Genus-level rate'].map((c) => h('th', {
                    key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                  }, c))
                )),
                h('tbody', null, (reliabilityByProbabilityBand || []).filter((b) => b.reviewedSampleSize > 0).map((b) => h('tr', { key: b.label },
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, b.label),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(b.primaryIdReliabilityPct) + '%'),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtCi(b.primaryIdReliabilityCiLowerPct, b.primaryIdReliabilityCiUpperPct) || '-'),
                  h('td', {
                    style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' },
                    title: b.marginOfErrorPct != null ? `95% CI margin of error: ±${fmtNum(b.marginOfErrorPct)}pp` : '',
                  }, b.insufficientPrecision ? `${b.primaryIdJudgedSampleSize} (imprecise)` : b.primaryIdJudgedSampleSize),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(b.genusLevelRatePct) + '%')
                )))
              )
            )
          ),

          h('div', { className: 'card-sub', style: { marginTop: 20, marginBottom: 6, fontWeight: 600 } }, 'By species (BTO primary), with small-sample fallback'),
          h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
            h('div', { style: { overflowX: 'auto' } },
              h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                h('thead', null, h('tr', null,
                  ['', 'Species', 'Reliability shown', '95% CI', 'Level', 'Reviewed (n)'].map((c) => h('th', {
                    key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                  }, c))
                )),
                h('tbody', null, (reliabilityBySpecies || []).map((s) => {
                  const confusion = confusionBySpecies.get(s.species);
                  const isExpanded = expandedSpecies.has(s.species);
                  const rows = [
                    h('tr', {
                      key: s.species, title: s.fallbackNote || '',
                      style: confusion ? { cursor: 'pointer' } : null,
                      onClick: confusion ? () => toggleExpanded(s.species) : undefined,
                    },
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', width: 16 } }, confusion ? (isExpanded ? '▾' : '▸') : ''),
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, s.species),
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.primaryIdReliabilityPct != null ? fmtNum(s.primaryIdReliabilityPct) + '%' : '-'),
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtCi(s.primaryIdReliabilityCiLowerPct, s.primaryIdReliabilityCiUpperPct) || '-'),
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                        s.fallbackLevel === 'species' ? 'Species'
                          : s.fallbackLevel === 'genus' ? 'Genus (fallback)'
                          : s.fallbackLevel === 'deployment' ? 'Deployment (fallback)'
                          : 'Insufficient data'),
                      h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.reviewedSampleSize)
                    ),
                  ];
                  if (isExpanded && confusion) {
                    rows.push(h('tr', { key: s.species + '-detail' },
                      h('td', { colSpan: 6, style: { padding: '4px 10px 12px 32px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle, rgba(255,255,255,0.02))' } },
                        h('div', { style: { fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 4 } },
                          `What ${confusion.reviewedSampleSize} reviewed "${s.species}" call(s) actually resolved to`),
                        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                          confusion.breakdown.map((t) => h('div', { key: t.finalId, style: { display: 'flex', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12 } },
                            h('span', { style: { minWidth: 160, color: t.isPrimaryRetained ? 'var(--text-muted)' : 'inherit' } }, t.isPrimaryRetained ? `${t.finalId} (correct)` : t.finalId),
                            h('span', null, `${t.count} (${fmtNum(t.pct)}%)`)
                          ))
                        )
                      )
                    ));
                  }
                  return rows;
                }))
              )
            )
          ),
          h('div', { className: 'card-sub', style: { marginTop: 4 } },
            "A species' own estimate is shown only when its 95% confidence interval is narrow enough to draw a conclusion from (±10 percentage points by default) - otherwise a genus-level estimate is tried the same way, and if neither is precise enough yet, it's reported as insufficient data rather than a shaky number. Hover a row for the reason. Click a row with an arrow to see what its reviewed calls actually resolved to.")
        ),

    h('div', { className: 'section-title' }, 'Survey effort'),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Nights (entered)', value: effort.nights ?? '-' }),
      h(StatBox, { label: 'Valid Survey Nights', value: effort.nightsInData, sub: 'Status: valid or partial' }),
      h(StatBox, { label: 'Zero-activity nights', value: activity.nightlyBreakdown.filter((n) => n.count === 0).length, sub: 'Of the valid Survey Nights above' }),
      h(StatBox, { label: 'Valid recording hours', value: effort.validRecordingHours ?? '-' }),
      h(StatBox, { label: 'QA completion % (computed)', value: fmtNum(effort.qaCompletionPct) + '%' })
    ),
    effort.nights != null && effort.nights !== effort.nightsInData && h('div', { className: 'card-sub', style: { marginTop: 8 } },
      `Note: ${effort.nightsInData} valid Survey Night(s), vs ${effort.nights} entered on the Overview tab - detections-per-night above uses the entered figure.`),
    (() => {
      const allNights = deployment.surveyNights || [];
      if (!allNights.length) return null;
      const byStatus = {};
      for (const n of allNights) byStatus[n.status] = (byStatus[n.status] || 0) + 1;
      return h('div', { className: 'card-sub', style: { marginTop: 8 } },
        `Survey Nights by status: ${Object.entries(byStatus).map(([status, count]) => `${SURVEY_NIGHT_STATUS_LABELS[status] || status} ${count}`).join(' · ')}.`);
    })(),

    h('div', { className: 'section-title' }, 'Recording conditions'),
    (() => {
      const mic = deployment.microphonePlacement || {};
      const ac = deployment.acousticConditions || {};
      const highNoiseFlags = Object.entries(ac).filter(([k, v]) => k !== 'notes' && v === 'high').map(([k]) => k);
      return h('div', { className: 'card-sub' },
        `Placement: ${mic.placementQuality ? PLACEMENT_QUALITY_LABELS[mic.placementQuality] : 'Not yet assessed'}.`,
        highNoiseFlags.length > 0 ? ` High noise flagged: ${highNoiseFlags.join(', ')} - a reliability/richness gap vs another deployment or location may partly reflect this, not just biology.` : ''
      );
    })(),

    h('div', { className: 'section-title' }, 'Activity'),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      `Resolved observed activity (below) applies manual review where it exists and otherwise trusts BTO's primary identification regardless of its confidence - this is the deployment's working analysis figure. Original BTO activity is a separate, stricter baseline: ${stats.originalBto.totalActivity} bat detections from automated IDs alone, at ≥${stats.originalBto.threshold}% confidence, before any manual review is applied - the two are expected to differ.`),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Total detections (resolved observed)', value: activity.totalDetections }),
      h(StatBox, { label: `Original BTO activity (≥${stats.originalBto.threshold}%)`, value: stats.originalBto.totalActivity }),
      h(StatBox, { label: 'Per night', value: fmtNum(activity.detectionsPerNight) }),
      h(StatBox, { label: 'Per hour', value: effort.validRecordingHours ? fmtNum(activity.detectionsPerHour) : 'Effort unavailable' }),
      h(StatBox, { label: 'Nightly mean', value: fmtNum(activity.nightlyMean) }),
      h(StatBox, { label: 'Nightly median', value: fmtNum(activity.nightlyMedian) }),
      h(StatBox, { label: 'Nightly min/max', value: activity.nightlyMin != null ? `${activity.nightlyMin} / ${activity.nightlyMax}` : '-' }),
      h(StatBox, { label: 'Nightly SD', value: fmtNum(activity.nightlySd) }),
      h(StatBox, { label: 'Nightly CV', value: activity.nightlyCv != null ? fmtNum(activity.nightlyCv, 2) : 'N/A' })
    ),

    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Species'),
      h('div', { style: { display: 'flex', gap: 4 } },
        h('button', {
          className: 'btn btn-small ' + (speciesView === 'raw' ? 'btn-primary' : 'btn-secondary'),
          onClick: () => setSpeciesView('raw'),
        }, 'Resolved observed'),
        h('button', {
          className: 'btn btn-small ' + (speciesView === 'qa-adjusted' ? 'btn-primary' : 'btn-secondary'),
          onClick: () => setSpeciesView('qa-adjusted'),
        }, 'QA-adjusted estimate')
      )
    ),
    speciesView === 'qa-adjusted' && h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      "Still-unreviewed calls are redistributed using the confusion pattern from reviewed calls of the same BTO primary (e.g. if reviewed \"Leisler's Bat\" calls turned out mostly Serotine, unreviewed Leisler's calls are counted mostly toward Serotine here instead). A species is only adjusted once its reviewed sample's 95% confidence interval is narrow enough to draw a conclusion from (±10 percentage points by default) - otherwise it's left as raw counts, not enough evidence yet to trust a correction. First-cut estimate: assumes each species' reviewed sample generalises to its unreviewed calls in this deployment."),
    (() => {
      const activeSpecies = speciesView === 'qa-adjusted' ? speciesQaAdjusted : species;
      const rows = activeSpecies.composition;
      const valueLabel = speciesView === 'qa-adjusted' ? 'Estimated count' : 'Count';
      return h(React.Fragment, null,
        h('div', { className: 'stat-grid' },
          h(StatBox, { label: 'Observed richness', value: activeSpecies.richnessMinimumTaxa, sub: activeSpecies.richnessMinimumTaxa !== activeSpecies.richness ? `${activeSpecies.richness} distinct labels; a genus-level label collapses into an already-present species of that genus` : null }),
          h(StatBox, { label: 'Dominant species', value: activeSpecies.dominantSpecies ? activeSpecies.dominantSpecies.species : '-' }),
          h(StatBox, { label: 'Dominant %', value: activeSpecies.dominantSpecies ? fmtNum(activeSpecies.dominantSpecies.pct) + '%' : '-' })
        ),
        rows.length > 0 && h('div', { className: 'card', style: { marginTop: 12, padding: 0, overflow: 'hidden' } },
          h('div', { style: { overflowX: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
              h('thead', null, h('tr', null,
                ['Species', valueLabel, '% of total', 'Active nights', 'Detection freq.'].map((c) => h('th', {
                  key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                }, c))
              )),
              h('tbody', null, rows.map((s) => h('tr', { key: s.species },
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                  s.species,
                  speciesView === 'qa-adjusted' && s.ownCallsReassigned
                    ? h('span', { style: { color: 'var(--text-faint)', fontSize: 10, marginLeft: 6 }, title: 'Unreviewed calls with this BTO primary were mostly reassigned to other species' }, '(reassigned away)')
                    : null,
                  speciesView === 'qa-adjusted' && s.receivedReassignedCalls
                    ? h('span', { style: { color: 'var(--text-faint)', fontSize: 10, marginLeft: 6 }, title: 'Includes calls reassigned here from a different BTO primary' }, '(gained calls)')
                    : null),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, speciesView === 'qa-adjusted' ? fmtNum(s.weight, 1) : s.count),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.pct) + '%'),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.activeNights),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.detectionFrequencyPct != null ? fmtNum(s.detectionFrequencyPct) + '%' : '-')
              )))
            )
          )
        )
      );
    })(),

    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Timing'),
      location && location.latitude != null && location.longitude != null && h('div', { style: { display: 'flex', gap: 4 } },
        h('button', { className: 'btn btn-small ' + (timingReference === 'sunset' ? 'btn-primary' : 'btn-secondary'), onClick: () => setTimingReference('sunset') }, 'Relative to sunset'),
        h('button', { className: 'btn btn-small ' + (timingReference === 'sunrise' ? 'btn-primary' : 'btn-secondary'), onClick: () => setTimingReference('sunrise') }, 'Relative to sunrise')
      )
    ),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      timing.sunsetRelative
        ? "Times below are hours relative to sunset (negative = before sunset) - uses this Location's coordinates."
        : timing.sunriseRelative
        ? "Times below are hours relative to the following sunrise (positive = before sunrise, negative = after) - useful for return/pre-dawn timing questions."
        : "Times below are raw clock time - set this Location's Latitude/Longitude (on its Details tab) to switch to sunset/sunrise-relative timing."),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'First detection', value: fmtDateTime(timing.firstDetection) }),
      h(StatBox, { label: 'Last detection', value: fmtDateTime(timing.lastDetection) }),
      h(StatBox, { label: (timing.sunsetRelative || timing.sunriseRelative) ? `Median (rel. ${timingReference})` : 'Median hour', value: (timing.sunsetRelative || timing.sunriseRelative) ? fmtHour(timing.medianHour) : fmtNum(timing.medianHour) }),
      h(StatBox, {
        label: 'Peak 30-min window',
        value: timing.peakHalfHour ? `${(timing.sunsetRelative || timing.sunriseRelative) ? fmtHour(timing.peakHalfHour.startHour) : fmtNum(timing.peakHalfHour.startHour)} (${timing.peakHalfHour.count})` : '-',
      }),
      h(StatBox, {
        label: 'Peak rolling hour',
        value: timing.peakRollingHour ? `${(timing.sunsetRelative || timing.sunriseRelative) ? fmtHour(timing.peakRollingHour.startHour) : fmtNum(timing.peakRollingHour.startHour)} (${timing.peakRollingHour.count})` : '-',
      })
    ),
    Object.keys(timing.percentiles || {}).length > 0 && h('div', { style: { marginTop: 12 } },
      h('div', { className: 'card-sub', style: { marginBottom: 6 } }, 'Cumulative activity percentiles:'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 12, fontFamily: 'var(--font-mono)' } },
        [10, 25, 50, 75, 90].map((p) => h('span', { key: p }, `${p}%: ${(timing.sunsetRelative || timing.sunriseRelative) ? fmtHour(timing.percentiles[p]) : fmtNum(timing.percentiles[p])}`))
      )
    )
  );
}

// Night-to-night and hour-by-hour patterns within this deployment - split out from General
// Statistics so the two questions ("how good/how much overall" vs "when, and does it vary night to
// night") each get their own place, per Clara's request.
function NightActivityStatisticsTab({ deployment, location, onPatch }) {
  const stats = useMemo(() => Stats.computeAllStats(deployment, location, ALL_SPECIES_NAMES), [deployment, location]);
  const { species, nightly, confusionBreakdown, totalDetectionEvents } = stats;
  const [hourlyFilterType, setHourlyFilterType] = useState('all'); // 'all' | 'species' | 'group'
  const [hourlyFilterValue, setHourlyFilterValue] = useState(null);
  const [hourlyView, setHourlyView] = useState('raw'); // 'raw' | 'qa-adjusted'
  const speciesNames = useMemo(() => (species.composition || []).map((s) => s.species).sort(), [species]);
  const groupNames = useMemo(() => Array.from(new Set(speciesNames.map((s) => SpeciesData.genusOf(s)).filter(Boolean))).sort(), [speciesNames]);
  // Corrective brief section 22: a deployment that has locked in its own precision bar (see
  // models.js's qaProfile.maxMarginPct) keeps using it here too, same as computeAllStats does
  // internally for reliability/QA-adjusted composition.
  const maxMarginPct = deployment.qaProfile && deployment.qaProfile.maxMarginPct != null ? deployment.qaProfile.maxMarginPct : undefined;
  const hourly = useMemo(
    () => hourlyView === 'qa-adjusted'
      ? Stats.computeHourlyActivityQaAdjusted(stats.dataset, location, { type: hourlyFilterType, value: hourlyFilterValue }, confusionBreakdown, maxMarginPct, undefined, stats.surveyNights)
      : Stats.computeHourlyActivity(stats.dataset, location, { type: hourlyFilterType, value: hourlyFilterValue }, undefined, stats.surveyNights),
    [stats.dataset, stats.surveyNights, location, hourlyFilterType, hourlyFilterValue, hourlyView, confusionBreakdown, maxMarginPct]
  );
  // The chart uses a finer 15-minute bin than the table's 1-hour columns, so a peak's actual shape
  // shows instead of being flattened into one hourly total - table stays hourly since a 4x-wider
  // table would be unreadable, but a chart line can happily pass through more points.
  const hourlyChart = useMemo(
    () => hourlyView === 'qa-adjusted'
      ? Stats.computeHourlyActivityQaAdjusted(stats.dataset, location, { type: hourlyFilterType, value: hourlyFilterValue }, confusionBreakdown, maxMarginPct, 0.25, stats.surveyNights)
      : Stats.computeHourlyActivity(stats.dataset, location, { type: hourlyFilterType, value: hourlyFilterValue }, 0.25, stats.surveyNights),
    [stats.dataset, stats.surveyNights, location, hourlyFilterType, hourlyFilterValue, hourlyView, confusionBreakdown, maxMarginPct]
  );
  const allNightDates = useMemo(() => new Set(hourlyChart.rows.map((r) => r.surveyDate)), [hourlyChart]);
  // null = "all nights" (the default) rather than an actual Set, so switching deployments/filters
  // never carries over a stale selection built from a different night list - toggling always starts
  // from allNightDates (below) instead of whatever set happened to be in state before.
  const [selectedNights, setSelectedNights] = useState(null);
  useEffect(() => { setSelectedNights(null); }, [stats.dataset, location, hourlyFilterType, hourlyFilterValue, hourlyView]);
  function toggleNight(date) {
    setSelectedNights((prev) => {
      const base = prev || allNightDates;
      const next = new Set(base);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  // Export selections: each ticked chart/table view is remembered as {key, label} on the
  // deployment itself (not local state) so it survives navigating away and persists to storage -
  // this is the "mark this specific view for the PDF" mechanism Clara asked for. The full-dump
  // Excel/CSV export is unrelated to this list and always includes everything (Stage 8 work, not
  // built yet) - this is just the selection bookkeeping the PDF step will read from later.
  const exportSelections = deployment.exportSelections || [];
  const hourlyExportKey = `hourly-activity:${hourlyFilterType}:${hourlyFilterValue || 'all'}`;
  const hourlyExportLabel = `Hourly activity - ${hourlyFilterType === 'all' ? 'All bats' : hourlyFilterType === 'species' ? hourlyFilterValue : `${hourlyFilterValue} (genus)`}`;
  const isHourlySelected = exportSelections.some((s) => s.key === hourlyExportKey);
  function toggleExportSelection(key, label) {
    const exists = exportSelections.some((s) => s.key === key);
    const next = exists ? exportSelections.filter((s) => s.key !== key) : [...exportSelections, { key, label, addedAt: new Date().toISOString() }];
    onPatch({ exportSelections: next });
  }

  if (totalDetectionEvents === 0) {
    return h('div', { className: 'content' },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No detections to analyse yet'),
        h('div', { className: 'empty-text' }, 'Import a BTO CSV on the Detections tab first.')
      )
    );
  }

  return h('div', { className: 'content' },
    h('div', { className: 'section-title' }, 'Nightly variation (within this deployment)'),
    nightly.highContributionNights.length > 0 && h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      `${nightly.highContributionNights.length} night(s) contributed at least double the deployment's median night's activity (marked below) - not a statistical test, just worth a look against weather, detector faults, or a genuine peak night.`),
    nightly.perNight.length > 0 && h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
      h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            ['Night', 'Total detections', 'Bat detections', 'Richness', 'Dominant species', '% of total activity', 'Rank'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
            }, c))
          )),
          h('tbody', null, nightly.perNight.map((n) => h('tr', {
            key: n.surveyDate,
            style: n.isHighContribution ? { background: 'rgba(230,120,50,0.08)' } : null,
          },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, n.surveyDate, n.isHighContribution ? ' ⚠' : ''),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, n.totalDetections),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, n.batDetections),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, n.richness),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, n.dominantSpecies || '-'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(n.contributionPct, 1) + '%'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, n.rank)
          )))
        )
      )
    ),

    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Hourly activity pattern (within this deployment)'),
      h('div', { style: { display: 'flex', gap: 4 } },
        h('button', {
          className: 'btn btn-small ' + (hourlyView === 'raw' ? 'btn-primary' : 'btn-secondary'),
          onClick: () => setHourlyView('raw'),
        }, 'Resolved observed'),
        h('button', {
          className: 'btn btn-small ' + (hourlyView === 'qa-adjusted' ? 'btn-primary' : 'btn-secondary'),
          onClick: () => setHourlyView('qa-adjusted'),
        }, 'QA-adjusted estimate')
      )
    ),
    hourlyView === 'qa-adjusted' && h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      "Still-unreviewed calls are redistributed using the confusion pattern from reviewed calls of the same BTO primary, same as the Species section's QA-adjusted view - a filtered species/genus only shows the share of activity that actually stayed that species/genus after redistribution."),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      hourly.sunsetRelative
        ? "Bins are hours relative to sunset (negative = before sunset), one row per survey night, so nights can be compared directly - does the peak stay at the same time each night, or does it shift? Uses this Location's coordinates."
        : "Bins are raw clock hours, one row per survey night - set this Location's Latitude/Longitude (on its Details tab) to switch to sunset-relative bins."),
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' } },
      h('select', {
        value: hourlyFilterType,
        onChange: (e) => { setHourlyFilterType(e.target.value); setHourlyFilterValue(null); },
      },
        h('option', { value: 'all' }, 'All bats'),
        h('option', { value: 'species' }, 'Single species'),
        h('option', { value: 'group' }, 'Genus (group of species)')
      ),
      hourlyFilterType === 'species' && h('select', { value: hourlyFilterValue || '', onChange: (e) => setHourlyFilterValue(e.target.value || null) },
        h('option', { value: '' }, '- choose a species -'),
        speciesNames.map((s) => h('option', { key: s, value: s }, s))
      ),
      hourlyFilterType === 'group' && h('select', { value: hourlyFilterValue || '', onChange: (e) => setHourlyFilterValue(e.target.value || null) },
        h('option', { value: '' }, '- choose a genus -'),
        groupNames.map((g) => h('option', { key: g, value: g }, g))
      )
    ),
    hourly.peakConsistency && hourly.peakConsistency.nightsWithActivity > 0 && h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      `Peak consistency: ${hourly.peakConsistency.nightsMatchingOverallPeak} of ${hourly.peakConsistency.nightsWithActivity} night(s) with activity had their own busiest bin at the same point as the deployment's overall busiest bin (${fmtNum(hourly.peakConsistency.matchingSharePct, 0)}%) - a high share means the peak reliably lands at the same time each night, a low share means it moves around.`),
    hourly.rows.length === 0
      ? h('div', { className: 'card-sub' }, 'No detections match this filter yet.')
      : h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
          h('div', { className: 'card-sub', style: { padding: '8px 12px 0' } }, 'Cell shading is a heatmap of activity intensity within this table - darker means busier, same numbers either way.'),
          h('div', { style: { overflowX: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
              h('thead', null, h('tr', null,
                [h('th', { key: 'night', style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' } }, 'Night')]
                  .concat(hourly.bins.map((b) => h('th', {
                    key: b, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)' },
                  }, hourly.sunsetRelative ? `${b >= 0 ? '+' : ''}${b}h` : `${String(((b % 24) + 24) % 24).padStart(2, '0')}:00`)))
              )),
              h('tbody', null,
                (() => {
                  const maxCount = Math.max(1, ...hourly.rows.flatMap((r) => r.counts));
                  return hourly.rows.map((r) => h('tr', { key: r.surveyDate },
                    [h('td', { key: 'night', style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, r.surveyDate)]
                      .concat(r.counts.map((c, i) => h('td', {
                        key: i,
                        style: {
                          padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)',
                          color: c === 0 ? 'var(--text-faint)' : 'inherit',
                          background: c > 0 ? `rgba(232,131,58,${0.08 + 0.62 * (c / maxCount)})` : 'transparent',
                        },
                      }, Number.isInteger(c) ? c : fmtNum(c, 1))))
                  ));
                })()
              ),
              h('tbody', null,
                [
                  h('tr', { key: '__mean', style: { fontWeight: 600, background: 'rgba(255,255,255,0.03)' } },
                    [h('td', { key: 'night', style: { padding: '5px 10px' } }, 'Mean')]
                      .concat(hourly.binMeans.map((m, i) => h('td', { key: i, style: { padding: '5px 10px', fontFamily: 'var(--font-mono)' } }, fmtNum(m, 1))))
                  ),
                  h('tr', { key: '__median', style: { fontWeight: 600, background: 'rgba(255,255,255,0.03)' } },
                    [h('td', { key: 'night', style: { padding: '5px 10px' } }, 'Median')]
                      .concat(hourly.binMedians.map((m, i) => h('td', { key: i, style: { padding: '5px 10px', fontFamily: 'var(--font-mono)' } }, fmtNum(m, 1))))
                  ),
                  h('tr', { key: '__pooled', style: { fontWeight: 600, background: 'rgba(255,255,255,0.03)' } },
                    [h('td', { key: 'night', style: { padding: '5px 10px' } }, 'Pooled (sum)')]
                      .concat(hourly.binTotals.map((t, i) => h('td', { key: i, style: { padding: '5px 10px', fontFamily: 'var(--font-mono)' } }, t)))
                  ),
                ]
              )
            )
          )
        ),
    hourly.rows.length > 0 && h(ActivityLineChart, { hourly: hourlyChart, filter: { type: hourlyFilterType, value: hourlyFilterValue }, location, selectedNights: selectedNights || allNightDates, onToggleNight: toggleNight }),
    hourly.rows.length > 0 && h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: isHourlySelected, onChange: () => toggleExportSelection(hourlyExportKey, hourlyExportLabel) }),
      'Include this view in the PDF export'
    )
  );
}

// Recovers the filter a "hourly-activity:<type>:<value>" export-selection key was ticked under
// (see NightActivityStatisticsTab's hourlyExportKey), so the Figure Workspace can re-render the
// actual chart rather than just showing its saved label. Returns null for any other key shape
// (nothing else is wired to export-selection yet - see FigureWorkspaceTab).
function parseHourlyActivityExportKey(key) {
  const match = /^hourly-activity:(all|species|group):(.*)$/.exec(key);
  if (!match) return null;
  const [, type, value] = match;
  return { type, value: value === 'all' ? null : value };
}

// Re-renders a selected figure live from the SAME stats the rest of the app uses (Stats.
// computeHourlyActivity), so a preview here can never silently drift from what Night Activity
// Statistics itself shows - never a separate/parallel calculation.
function FigurePreview({ stats, location, parsed }) {
  const hourlyChart = useMemo(
    () => Stats.computeHourlyActivity(stats.dataset, location, parsed, 0.25, stats.surveyNights),
    [stats.dataset, stats.surveyNights, location, parsed.type, parsed.value]
  );
  if (!hourlyChart.rows.length) return h('div', { className: 'card-sub' }, 'No detections match this filter.');
  return h(ActivityLineChart, { hourly: hourlyChart, filter: parsed, location });
}

// One figure-workspace entry: title/caption fields, reorder/remove, live preview, and PNG/SVG
// export (brief section 21.3) - reads the actual rendered <svg> node via its own ref, so the
// exported image is pixel-for-pixel what's on screen, not a second render pass.
function FigureCard({ sel, index, total, stats, location, updateSelection, removeSelection, moveSelection }) {
  const containerRef = useRef(null);
  const parsed = parseHourlyActivityExportKey(sel.key);
  const fileStem = (sel.title || sel.label || 'figure').replace(/[^A-Za-z0-9_-]+/g, '_');

  function findSvg() {
    return containerRef.current ? containerRef.current.querySelector('svg') : null;
  }
  function exportPng() {
    const svg = findSvg();
    if (svg) Exports.downloadSvgAsPng(svg, `${fileStem}.png`);
  }
  function exportSvg() {
    const svg = findSvg();
    if (svg) Exports.downloadSvgAsSvgFile(svg, `${fileStem}.svg`);
  }

  return h('div', { className: 'card' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 } },
      h('div', { style: { flex: 1 } },
        h(Field, { label: 'Title' }, h('input', { value: sel.title ?? sel.label, onChange: (e) => updateSelection(sel.key, { title: e.target.value }) })),
        h(Field, { label: 'Caption (optional)' }, h('textarea', { rows: 2, value: sel.caption || '', onChange: (e) => updateSelection(sel.key, { caption: e.target.value }), placeholder: 'e.g. survey context, what to notice' }))
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('button', { className: 'btn btn-secondary btn-small', disabled: index === 0, onClick: () => moveSelection(sel.key, -1) }, '↑'),
        h('button', { className: 'btn btn-secondary btn-small', disabled: index === total - 1, onClick: () => moveSelection(sel.key, 1) }, '↓'),
        h('button', { className: 'btn btn-danger btn-small', onClick: () => removeSelection(sel.key) }, 'Remove')
      )
    ),
    parsed
      ? h(React.Fragment, null,
          h('div', { ref: containerRef }, h(FigurePreview, { stats, location, parsed })),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            h('button', { className: 'btn btn-secondary btn-small', onClick: exportPng }, 'Export PNG'),
            h('button', { className: 'btn btn-secondary btn-small', onClick: exportSvg }, 'Export SVG')
          )
        )
      : h('div', { className: 'card-sub' }, `${sel.label} (no live preview available for this figure type yet)`)
  );
}

// Corrective brief section 19 / Phase 4 item 9: a real Figure Workspace rather than a placeholder
// - lets the analyst curate which already-built views feed the eventual report/export (Stage 8/
// Phase 5 work still builds the actual PDF/PNG export itself), with an editable title/caption and
// manual reordering. Only the hourly activity chart is wired to export-selection so far (see
// NightActivityStatisticsTab) - other figure types become selectable here as they're built, rather
// than this page inventing its own separate list.
function FigureWorkspaceTab({ deployment, location, onPatch }) {
  const stats = useMemo(() => Stats.computeAllStats(deployment, location, ALL_SPECIES_NAMES), [deployment, location]);
  const selections = deployment.exportSelections || [];

  function updateSelection(key, patch) {
    onPatch({ exportSelections: selections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  }
  function removeSelection(key) {
    onPatch({ exportSelections: selections.filter((s) => s.key !== key) });
  }
  function moveSelection(key, direction) {
    const idx = selections.findIndex((s) => s.key === key);
    const swapWith = idx + direction;
    if (idx < 0 || swapWith < 0 || swapWith >= selections.length) return;
    const next = selections.slice();
    const tmp = next[idx]; next[idx] = next[swapWith]; next[swapWith] = tmp;
    onPatch({ exportSelections: next });
  }

  if (selections.length === 0) {
    return h('div', { className: 'content' },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No figures selected yet'),
        h('div', { className: 'empty-text' }, 'On Night Activity Statistics, tick "Include this view in the PDF export" under the hourly activity chart to add it here. More figure types will become selectable as they\'re built.')
      )
    );
  }

  return h('div', { className: 'content' },
    h('div', { className: 'section-title' }, 'Figure workspace'),
    h('div', { className: 'card-sub', style: { marginBottom: 12 } },
      "Figures selected for the eventual report/export, in this order. Add a title/caption for each and reorder with the arrows - the preview below always comes straight from the same statistics the rest of the app shows, so it can never disagree with its source tab."),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      selections.map((sel, i) => h(FigureCard, {
        key: sel.key, sel, index: i, total: selections.length, stats, location,
        updateSelection, removeSelection, moveSelection,
      }))
    )
  );
}

// Corrective brief section 20: a structured report builder covering the specified sections,
// reading exclusively from Stats.computeAllStats (never a separate calculation) so a number here
// can never disagree with its source tab. PDF: no bundled library - the "Print / Save as PDF"
// button uses the browser's own native print-to-PDF against the .report-printable print
// stylesheet in index.html, which is a complete, real PDF path without vendoring anything.
function ReportsTab({ project, deployment, location }) {
  const stats = useMemo(() => Stats.computeAllStats(deployment, location, ALL_SPECIES_NAMES), [deployment, location]);
  const { effort, activity, species, speciesQaAdjusted, timing, reliability, nightly, reviewStateSummary, qaCoverage } = stats;
  const profile = deployment.qaProfile || DEFAULT_QA_PROFILE;
  const hasEstimates = species.composition.length !== speciesQaAdjusted.composition.length
    || species.composition.some((s) => {
      const est = speciesQaAdjusted.composition.find((e) => e.species === s.species);
      return est && Math.abs(est.weight - s.count) > 0.01;
    });

  function exportCsv(name, csv) {
    ns_downloadTextFile(`${deploymentFileStem(deployment)}_${name}.csv`, csv, 'text/csv');
  }
  function ns_downloadTextFile(filename, text, mime) { Exports.downloadTextFile(filename, text, mime); }
  function deploymentFileStem(dep) { return (dep.name || 'deployment').replace(/[^A-Za-z0-9_-]+/g, '_'); }

  function exportWorkbook() {
    const sheets = Exports.deploymentWorkbookSheets(deployment, stats);
    Exports.downloadWorkbook(`${deploymentFileStem(deployment)}_BatAStat.xls`, sheets);
  }

  if (stats.totalDetectionEvents === 0) {
    return h('div', { className: 'content' },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No detections to report yet'),
        h('div', { className: 'empty-text' }, 'Import a BTO CSV on the Detections tab first.')
      )
    );
  }

  return h('div', { className: 'content' },
    h('div', { className: 'no-print', style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' } },
      h('button', { className: 'btn btn-primary btn-small', onClick: () => window.print() }, '🖨 Print / Save as PDF'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: exportWorkbook }, 'Download Excel workbook (all tables)'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('survey_nights', Exports.surveyNightsToCsv(deployment)) }, 'CSV: Survey Nights'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('species_records', Exports.speciesDetectionRecordsToCsv(stats)) }, 'CSV: Species Records'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('review_history', Exports.reviewHistoryToCsv(deployment)) }, 'CSV: Review History'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('observed_activity', Exports.resolvedObservedStatsToCsv(stats)) }, 'CSV: Observed Activity'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('estimated_activity', Exports.qaAdjustedEstimatesToCsv(stats)) }, 'CSV: Estimated Activity'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('nightly_activity', Exports.nightlyActivityToCsv(stats)) }, 'CSV: Nightly Activity'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => exportCsv('qa_calibration', Exports.qaCalibrationToCsv(stats)) }, 'CSV: QA Calibration')
    ),

    h('div', { className: 'report-printable' },
      h('div', { className: 'section-title' }, 'Project information'),
      h('div', { className: 'card-sub' },
        `Client: ${project.client || '-'} · Project: ${project.projectName || '-'} · Site: ${project.siteName || '-'}`),

      h('div', { className: 'section-title' }, 'Survey design'),
      h('div', { className: 'card-sub' },
        `Location: ${location.name || '(untitled)'}${location.latitude != null ? ` (${location.latitude}, ${location.longitude})` : ' (no coordinates set - clock-time only)'}. Deployment: ${deployment.name || '(untitled)'}, ${deployment.startDate || '?'} → ${deployment.endDate || '?'}. Detector: ${deployment.detectorInfo || 'not recorded'}. Weather: ${deployment.weather || 'not recorded'}.`),

      h('div', { className: 'section-title' }, 'Effort'),
      h('div', { className: 'stat-grid' },
        h(StatBox, { label: 'Valid Survey Nights', value: effort.nightsInData }),
        h(StatBox, { label: 'Zero-activity nights', value: activity.nightlyBreakdown.filter((n) => n.count === 0).length }),
        h(StatBox, { label: 'Valid recording hours', value: effort.validRecordingHours ?? 'Not recorded' }),
        h(StatBox, { label: 'QA completion %', value: fmtNum(effort.qaCompletionPct) + '%' })
      ),

      h('div', { className: 'section-title' }, 'Recording conditions'),
      (() => {
        const mic = deployment.microphonePlacement || {};
        const ac = deployment.acousticConditions || {};
        const highNoiseFlags = Object.entries(ac).filter(([k, v]) => k !== 'notes' && v === 'high').map(([k]) => k);
        return h('div', { className: 'card-sub' },
          `Placement: ${mic.placementQuality ? PLACEMENT_QUALITY_LABELS[mic.placementQuality] : 'Not yet assessed'}.`,
          highNoiseFlags.length > 0 ? ` High noise flagged: ${highNoiseFlags.join(', ')}.` : '');
      })(),

      h('div', { className: 'section-title' }, 'Observed activity'),
      h('div', { className: 'card-sub', style: { marginBottom: 8 } },
        `Original BTO activity (automated IDs alone, ≥${stats.originalBto.threshold}% confidence, no manual review applied): ${stats.originalBto.totalActivity}. Resolved observed activity (this report's working figure - manual review applied where it exists, otherwise BTO's primary regardless of confidence): ${activity.totalDetections}.`),
      h('div', { className: 'stat-grid' },
        h(StatBox, { label: 'Resolved observed activity', value: activity.totalDetections }),
        h(StatBox, { label: `Original BTO activity (≥${stats.originalBto.threshold}%)`, value: stats.originalBto.totalActivity })
      ),

      h('div', { className: 'section-title' }, 'Effort-standardised activity'),
      h('div', { className: 'stat-grid' },
        h(StatBox, { label: 'Per night', value: fmtNum(activity.detectionsPerNight) }),
        h(StatBox, { label: 'Per hour', value: effort.validRecordingHours ? fmtNum(activity.detectionsPerHour) : 'Effort unavailable' }),
        h(StatBox, { label: 'Nightly mean', value: fmtNum(activity.nightlyMean) }),
        h(StatBox, { label: 'Nightly median', value: fmtNum(activity.nightlyMedian) }),
        h(StatBox, { label: 'Nightly CV', value: activity.nightlyCv != null ? fmtNum(activity.nightlyCv, 2) : 'N/A' })
      ),

      h('div', { className: 'section-title' }, 'Observed species composition'),
      h('div', { className: 'stat-grid' },
        h(StatBox, { label: 'Observed richness', value: species.richnessMinimumTaxa }),
        h(StatBox, { label: 'Dominant species', value: species.dominantSpecies ? `${species.dominantSpecies.species} (${fmtNum(species.dominantSpecies.pct)}%)` : '-' })
      ),
      h('div', { className: 'card', style: { marginTop: 10, padding: 0, overflow: 'hidden' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null, ['Species', 'Count', '% of total', 'Detection freq.'].map((c) => h('th', {
            key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
          }, c)))),
          h('tbody', null, species.composition.map((s) => h('tr', { key: s.species },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, s.species),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.count),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.pct) + '%'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.detectionFrequencyPct != null ? fmtNum(s.detectionFrequencyPct) + '%' : '-')
          )))
        )
      ),

      h('div', { className: 'section-title' }, 'Temporal activity'),
      h('div', { className: 'card-sub' },
        timing.sunsetRelative
          ? `First detection ${fmtDateTime(timing.firstDetection)}, last ${fmtDateTime(timing.lastDetection)}. Median activity time ${fmtHour(timing.medianHour)} relative to sunset. Peak 30-minute window ${fmtHour(timing.peakHalfHour ? timing.peakHalfHour.startHour : null)} (${timing.peakHalfHour ? timing.peakHalfHour.count : 0} detections).`
          : `First detection ${fmtDateTime(timing.firstDetection)}, last ${fmtDateTime(timing.lastDetection)}. Set this Location's coordinates for sunset-relative timing.`),

      h('div', { className: 'section-title' }, 'QA methods'),
      h('div', { className: 'card-sub' },
        `Random sample: ${profile.samplePercent}%. Probability threshold reviewed in full: below ${profile.probabilityThreshold}%. Always-review-No-ID: ${profile.alwaysReviewNoId ? 'yes' : 'no'}. QA-adjustment precision bar: ±${(profile.maxMarginPct != null ? profile.maxMarginPct : Stats.MAX_RELIABLE_MARGIN_PCT ?? 10)} percentage points (95% Wilson interval).`),

      h('div', { className: 'section-title' }, 'QA results'),
      reliability.reviewedSampleSize === 0
        ? h('div', { className: 'card-sub' }, 'No reviewed calls with a BTO primary result yet.')
        : h('div', { className: 'stat-grid' },
            h(StatBox, { label: 'Primary-ID reliability', value: fmtNum(reliability.primaryIdReliabilityPct) + '%', sub: fmtCi(reliability.primaryIdReliabilityCiLowerPct, reliability.primaryIdReliabilityCiUpperPct) }),
            h(StatBox, { label: 'Accepted / Modified / Rejected', value: `${reviewStateSummary.accepted} / ${reviewStateSummary.modified} / ${reviewStateSummary.rejected}` }),
            h(StatBox, { label: 'QA coverage (overall)', value: fmtNum(qaCoverage.overall.reviewedPct) + '%' }),
            h(StatBox, { label: 'Reviewed sample (n)', value: reliability.reviewedSampleSize })
          ),

      hasEstimates && h(React.Fragment, null,
        h('div', { className: 'section-title' }, 'QA-adjusted estimates'),
        h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null, h('tr', null, ['Species', 'Estimated count', '% of total (estimated)'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
            }, c)))),
            h('tbody', null, speciesQaAdjusted.composition.map((s) => h('tr', { key: s.species },
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, s.species),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.weight, 1)),
              h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.pct) + '%')
            )))
          )
        )
      ),

      h('div', { className: 'section-title' }, 'Caveats'),
      h('div', { className: 'card', style: { fontSize: 12, lineHeight: 1.6 } },
        h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'Acoustic activity does not represent bat abundance or population size.'),
        hasEstimates && h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'QA-adjusted outputs are estimates based on reviewed records and associated calibration uncertainty.'),
        h('div', null, 'Detection Frequency and richness reflect what this detector recorded at this Location under its own recording conditions, not a general survey of the wider area. Reliability and QA-adjusted figures are based on manually reviewed calls only and carry the sample sizes and confidence intervals shown above - treat a figure without enough reviewed evidence as insufficient data, not as a fallback average.')
      ),

      h('div', { className: 'section-title' }, 'Appendices'),
      h('div', { className: 'card-sub' },
        // "Species Detection Records" means retained bat taxa specifically (brief section 1.2) -
        // stats.totalSpeciesRecords counts every resolved row regardless of category (noise/
        // other-taxon/unidentified included), which is a different, broader figure.
        `${deployment.detectionEvents.length} Detection Events, ${stats.dataset.filter((d) => d.category === 'bat').length} Species Detection Records. Additional-species yield: ${fmtNum(reliability.additionalSpeciesRatePct)}% (${reliability.additionalSpeciesRecordCount} extra record(s)). Genus-level downgrade rate: ${fmtNum(reliability.genusLevelRatePct)}%.`),

      h('div', { className: 'section-title' }, 'Report metadata'),
      h('div', { className: 'card-sub' },
        `Schema v${M.SCHEMA_VERSION} · Bat-A-Stat ${M.APP_VERSION} · Generated ${new Date().toLocaleString('en-GB')}.`)
    )
  );
}

// Stage 6 (Level 1B): how this Location's deployments compare through the year - one row per
// deployment, in chronological order. Lives on the Location page (not a per-deployment tab) since
// "how does activity vary across the year at this site" is a question about the Location as a
// whole, not about any one deployment - per Clara's own framing of the three-tier navigation
// (deployment: what happened; location: how it varies through the year; site: how locations
// compare to each other). `currentDeploymentId` is optional - when given (opened from within a
// deployment, if ever wired up that way again) that row is highlighted; the Location-page usage
// below doesn't pass one, so no row is highlighted there.
function LocationTimeComparison({ location, currentDeploymentId }) {
  const comparison = useMemo(() => Stats.computeLocationComparison(location), [location]);
  const rows = comparison.deployments;

  if (rows.length < 2) {
    return h('div', { className: 'empty-state' },
      h('div', { className: 'empty-title' }, 'Need at least two deployments to compare'),
      h('div', { className: 'empty-text' }, `${location.name} has ${rows.length} deployment${rows.length === 1 ? '' : 's'} so far - add another to see activity, richness and species turnover through the year.`)
    );
  }

  return h('div', null,
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      "Gained/Lost are against the immediately preceding deployment only (a simple presence/absence difference). Jaccard/Sørensen/Bray-Curtis (also vs the preceding deployment) give that same comparison as an actual similarity/dissimilarity score - Bray-Curtis additionally weighs how dominant each species is, not just whether it's present."),
    h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
      h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            ['Deployment', 'Dates', 'Nights', 'Detections/night', 'Observed richness', 'Dominant species', 'Gained', 'Lost', 'Jaccard', 'Sørensen', 'Bray-Curtis dissim.'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
            }, c))
          )),
          h('tbody', null, rows.map((r) => h('tr', {
            key: r.deploymentId,
            style: r.deploymentId === currentDeploymentId ? { background: 'rgba(255,150,50,0.08)' } : null,
          },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
              r.deploymentName || '(untitled)',
              h(ComparisonWarnings, { warnings: r.comparisonWarnings })),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, `${r.startDate || '?'} → ${r.endDate || '?'}`),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, r.nights),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(r.detectionsPerNight)),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, r.richness),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, r.dominantSpecies ? `${r.dominantSpecies} (${fmtNum(r.dominantPct)}%)` : '-'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' } }, r.speciesGained.length ? r.speciesGained.join(', ') : '-'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' } }, r.speciesLost.length ? r.speciesLost.join(', ') : '-'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(r.jaccardIndex)),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(r.sorensenIndex)),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(r.brayCurtisDissimilarity))
          )))
        )
      )
    )
  );
}

// Stage 7 (Level 2): the Project/Site-level page - how do this site's Locations compare to each
// other, with each Location's own deployments merged into one combined profile first. Raw/QA-
// adjusted toggle matches every other stats view in the app.
function SiteComparisonPage({ project }) {
  const [view, setView] = useState('raw'); // 'raw' | 'qa-adjusted'
  const comparison = useMemo(() => Stats.computeSiteComparison(project), [project]);
  const rows = comparison.locations;

  return h('div', { className: 'content' },
    h('div', { className: 'main-header', style: { padding: 0, border: 'none', marginBottom: 16 } },
      h('div', null,
        h('div', { className: 'main-title' }, 'Compare Locations'),
        h('div', { className: 'main-subtitle' }, `${project.projectName || 'Project'} · ${rows.length} location(s)`)
      ),
      h('div', { style: { display: 'flex', gap: 4 } },
        h('button', { className: 'btn btn-small ' + (view === 'raw' ? 'btn-primary' : 'btn-secondary'), onClick: () => setView('raw') }, 'Resolved observed'),
        h('button', { className: 'btn btn-small ' + (view === 'qa-adjusted' ? 'btn-primary' : 'btn-secondary'), onClick: () => setView('qa-adjusted') }, 'QA-adjusted estimate')
      )
    ),
    rows.length < 2
      ? h('div', { className: 'empty-state' },
          h('div', { className: 'empty-title' }, 'Need at least two locations to compare'),
          h('div', { className: 'empty-text' }, `${project.projectName || 'This project'} has ${rows.length} location(s) so far - add another to see how activity/richness compares across the site.`)
        )
      : h(React.Fragment, null,
          view === 'qa-adjusted' && h('div', { className: 'card-sub', style: { marginBottom: 8 } },
            "Each Location's still-unreviewed calls are redistributed using that Location's own confusion breakdown (built from whatever's been reviewed across all its deployments combined), same as every other QA-adjusted view in the app."),
          h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
            h('div', { style: { overflowX: 'auto' } },
              h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                h('thead', null, h('tr', null,
                  ['Location', 'Deployments', 'Nights', 'Detections/night', 'Observed richness', 'Dominant species'].map((c) => h('th', {
                    key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                  }, c))
                )),
                h('tbody', null, rows.map((r) => {
                  const richness = view === 'qa-adjusted' ? r.richnessQaAdjusted : r.richness;
                  const dominantSpecies = view === 'qa-adjusted' ? r.dominantSpeciesQaAdjusted : r.dominantSpecies;
                  const dominantPct = view === 'qa-adjusted' ? r.dominantPctQaAdjusted : r.dominantPct;
                  return h('tr', { key: r.locationId },
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, r.locationName || '(untitled)'),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, r.deploymentCount),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, r.nights),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(r.detectionsPerNight)),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, richness),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, dominantSpecies ? `${dominantSpecies} (${fmtNum(dominantPct)}%)` : '-')
                  );
                }))
              )
            )
          ),

          comparison.pairwiseSimilarity.length > 0 && h(React.Fragment, null,
            h('div', { className: 'section-title' }, 'Pairwise similarity between locations'),
            h('div', { className: 'card-sub', style: { marginBottom: 8 } },
              'Jaccard/Sørensen compare which species are present regardless of how common each is; Bray-Curtis dissimilarity also weighs how dominant each species is (0 = identical composition, 1 = completely disjoint) - the more ecologically informative figure when two locations share every species but at very different proportions. Always uses resolved observed composition.'),
            h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
              h('div', { style: { overflowX: 'auto' } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                  h('thead', null, h('tr', null,
                    ['Locations', 'Jaccard', 'Sørensen', 'Bray-Curtis dissimilarity'].map((c) => h('th', {
                      key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                    }, c))
                  )),
                  h('tbody', null, comparison.pairwiseSimilarity.map((p) => h('tr', { key: `${p.locationAId}-${p.locationBId}` },
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                      `${p.locationAName || '(untitled)'} vs ${p.locationBName || '(untitled)'}`,
                      h(ComparisonWarnings, { warnings: p.comparisonWarnings })),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(p.jaccardIndex)),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(p.sorensenIndex)),
                    h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtIndex(p.brayCurtisDissimilarity))
                  )))
                )
              )
            )
          )
        )
  );
}

const SURVEY_NIGHT_STATUS_LABELS = {
  valid: 'Valid',
  partial: 'Partial',
  failed: 'Failed',
  excluded: 'Excluded',
  'unknown-effort': 'Unknown effort',
};

function DeploymentOverviewTab({ deployment, onPatch, wavFileMap, location }) {
  const effort = deployment.surveyEffort || {};
  function patchEffort(patch) {
    onPatch({ surveyEffort: { ...effort, ...patch } });
  }

  // Survey Nights are the canonical per-night record (one per calendar date in Start/End range,
  // including nights with truly zero bat activity) - generated/kept in sync with the date range
  // here, on every load, so a deployment saved before this entity existed gets backfilled the same
  // way a date-range edit regenerates it. Existing nights are preserved by date (see
  // Models.ensureSurveyNights) so a status an analyst already set (failed/excluded/etc) never gets
  // silently reset just because this ran again.
  useEffect(() => {
    if (!deployment.startDate || !deployment.endDate) return;
    const ensured = M.ensureSurveyNights(deployment, location);
    if (ensured !== deployment.surveyNights) onPatch({ surveyNights: ensured });
  }, [deployment.startDate, deployment.endDate, location && location.latitude, location && location.longitude]);

  function patchSurveyNight(nightId, patch) {
    onPatch({ surveyNights: (deployment.surveyNights || []).map((n) => (n.id === nightId ? { ...n, ...patch } : n)) });
  }

  // Suggests total Valid Recording Hours from the deployment's own date range and the Location's
  // coordinates (sunset-30min to sunrise+30min, summed across every night) - the same "suggestion,
  // always editable" pattern as nights/dates, since detector failures/exclusions are real reasons
  // the true figure can come in lower than this theoretical maximum.
  const suggestedHours = useMemo(() => Stats.suggestValidRecordingHours(deployment, location), [deployment.startDate, deployment.endDate, location && location.latitude, location && location.longitude]);
  const hoursRounded = suggestedHours ? Math.round(suggestedHours.totalHours * 10) / 10 : null;

  const events = deployment.detectionEvents || [];
  const distinctSurveyDates = useMemo(
    () => new Set(events.map((e) => e.surveyDate).filter(Boolean)),
    [events]
  );
  const suggestedNights = distinctSurveyDates.size;

  // Suggests Start/End date from whichever data is already available - WAV filename timestamps
  // if a folder's been loaded (most exact), otherwise the date range BTO already reported across
  // the imported detection events. Recomputes live as CSVs are imported or a WAV folder is loaded.
  const suggestedRange = useMemo(() => {
    if (wavFileMap && wavFileMap.size > 0) {
      let min = null, max = null;
      for (const name of wavFileMap.keys()) {
        const dt = Wav.parseTimestampFromFilename(name);
        if (!dt) continue;
        if (!min || dt < min) min = dt;
        if (!max || dt > max) max = dt;
      }
      if (min && max) return { start: toDateInputValue(min), end: toDateInputValue(max), source: 'WAV filenames' };
    }
    const dates = events.map((e) => parseActualDateOnly(e.actualDate)).filter(Boolean);
    if (dates.length) {
      const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
      return { start: toDateInputValue(min), end: toDateInputValue(max), source: 'BTO data' };
    }
    return null;
  }, [wavFileMap, events]);
  const rangeMatches = suggestedRange && suggestedRange.start === deployment.startDate && suggestedRange.end === deployment.endDate;

  return h('div', { className: 'content' },
    h('div', { className: 'section-title' }, 'Details'),
    h(Field, { label: 'Name' }, h('input', { value: deployment.name, onChange: (e) => onPatch({ name: e.target.value }) })),
    suggestedRange && !rangeMatches && h('div', { className: 'card', style: { marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
      h('div', { className: 'card-sub' }, `${suggestedRange.source} suggest${suggestedRange.source === 'BTO data' ? 's' : ''} ${suggestedRange.start} → ${suggestedRange.end}. This is a suggestion only - always editable below.`),
      h('button', { className: 'btn btn-secondary btn-small', style: { flexShrink: 0 }, onClick: () => onPatch({ startDate: suggestedRange.start, endDate: suggestedRange.end }) }, 'Use suggested dates')
    ),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Start date' }, h('input', { type: 'date', value: deployment.startDate, onChange: (e) => onPatch({ startDate: e.target.value }) })),
      h(Field, { label: 'End date' }, h('input', { type: 'date', value: deployment.endDate, onChange: (e) => onPatch({ endDate: e.target.value }) }))
    ),
    h(Field, { label: 'Detector info' }, h('input', { value: deployment.detectorInfo, onChange: (e) => onPatch({ detectorInfo: e.target.value }), placeholder: 'e.g. Song Meter SM4BAT, serial S4U00485' })),
    h(Field, { label: 'Weather' }, h('input', { value: deployment.weather, onChange: (e) => onPatch({ weather: e.target.value }), placeholder: 'e.g. Dry, 14-18C, light wind' })),
    h(Field, { label: 'Notes' }, h('textarea', { rows: 3, value: deployment.notes, onChange: (e) => onPatch({ notes: e.target.value }) })),

    h('div', { className: 'section-title' }, 'Survey effort'),
    suggestedNights > 0 && suggestedNights !== effort.nights && h('div', { className: 'card', style: { marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
      h('div', { className: 'card-sub' }, `BTO data suggests ${suggestedNights} night${suggestedNights === 1 ? '' : 's'} (${distinctSurveyDates.size} distinct survey date${distinctSurveyDates.size === 1 ? '' : 's'} across ${events.length} detection events). This is a suggestion only - always editable below.`),
      h('button', { className: 'btn btn-secondary btn-small', style: { flexShrink: 0 }, onClick: () => patchEffort({ nights: suggestedNights }) }, `Use ${suggestedNights}`)
    ),
    hoursRounded != null && hoursRounded !== effort.validRecordingHours && h('div', { className: 'card', style: { marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
      h('div', { className: 'card-sub' }, `This Location's coordinates suggest ${hoursRounded} total valid recording hours (sunset−30min to sunrise+30min, across ${suggestedHours.nights} night(s) from Start to End date). A suggestion only - lower it to account for detector failures or excluded periods.`),
      h('button', { className: 'btn btn-secondary btn-small', style: { flexShrink: 0 }, onClick: () => patchEffort({ validRecordingHours: hoursRounded }) }, `Use ${hoursRounded}`)
    ),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Nights' }, h('input', { type: 'number', value: effort.nights ?? '', onChange: (e) => patchEffort({ nights: e.target.value === '' ? null : Number(e.target.value) }) })),
      h(Field, { label: 'Valid recording hours' }, h('input', { type: 'number', value: effort.validRecordingHours ?? '', onChange: (e) => patchEffort({ validRecordingHours: e.target.value === '' ? null : Number(e.target.value) }) }))
    ),
    h('div', { className: 'card-sub', style: { marginTop: -8, marginBottom: 14 } }, 'QA completion % is no longer entered here - see the Statistics tab, where it\'s computed directly from the QA queue.'),
    h(Field, { label: 'Detector failures' }, h('textarea', { rows: 2, value: effort.detectorFailures, onChange: (e) => patchEffort({ detectorFailures: e.target.value }), placeholder: 'e.g. flat battery night 3, no recordings 19-20 June' })),
    h(Field, { label: 'Excluded periods' }, h('textarea', { rows: 2, value: effort.excludedPeriods, onChange: (e) => patchEffort({ excludedPeriods: e.target.value }), placeholder: 'e.g. 21 June excluded - detector knocked down' })),

    h('div', { className: 'section-title' }, 'Survey Nights'),
    !deployment.startDate || !deployment.endDate
      ? h('div', { className: 'card-sub' }, 'Set Start and End date above to generate one row per calendar night.')
      : h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
          h('div', { className: 'card-sub', style: { padding: '8px 12px 0' } },
            'One row per calendar night in the deployment\'s date range, including nights with no detections at all - this is the denominator every nightly statistic uses, not just the nights that happen to appear in imported data. Mark a night Partial/Failed/Excluded if the detector didn\'t run cleanly all night.'),
          h('div', { style: { overflowX: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
              h('thead', null, h('tr', null,
                ['Night', 'Status', 'Valid hours', 'Notes'].map((c) => h('th', {
                  key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                }, c))
              )),
              h('tbody', null,
                (deployment.surveyNights || []).map((n) => h('tr', { key: n.id },
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, n.surveyDate),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                    h('select', { value: n.status, onChange: (e) => patchSurveyNight(n.id, { status: e.target.value }) },
                      Object.entries(SURVEY_NIGHT_STATUS_LABELS).map(([v, label]) => h('option', { key: v, value: v }, label)))),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                    h('input', {
                      type: 'number', style: { width: 80 }, value: n.validHours ?? '',
                      onChange: (e) => patchSurveyNight(n.id, { validHours: e.target.value === '' ? null : Number(e.target.value) }),
                    })),
                  h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
                    h('input', { style: { width: '100%' }, value: n.notes || '', onChange: (e) => patchSurveyNight(n.id, { notes: e.target.value }) }))
                ))
              )
            )
          )
        ),

    h('div', { className: 'section-title' }, 'Detection Events'),
    h('div', { className: 'stat-grid' },
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Total'), h('div', { className: 'stat-box-value' }, String((deployment.detectionEvents || []).length))),
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'BTO imports'), h('div', { className: 'stat-box-value' }, String((deployment.btoImports || []).length)))
    ),
    (deployment.detectionEvents || []).length === 0 && h('div', { className: 'card-sub', style: { marginTop: 10 } }, 'Import a BTO CSV on the Detections tab to get started.'),

    h(RecordingConditionsSection, { deployment, onPatch })
  );
}

const PLACEMENT_QUALITY_LABELS = {
  recommended: 'Recommended placement',
  'partially-constrained': 'Partially constrained',
  'strongly-constrained': 'Strongly constrained',
};

// Real-world detector placement isn't always acoustically ideal (theft/vandalism risk, low
// mounting, concealment). Recording this alongside results means QA reliability reads as
// "observed under THIS deployment's conditions", not a universal BTO accuracy claim - and lets
// later comparisons flag "these differ partly because recording conditions differed" rather than
// silently attributing a richness/completeness gap to biology. Every field optional; collapsed by
// default so it doesn't get in the way when there's nothing unusual to record.
function RecordingConditionsSection({ deployment, onPatch }) {
  const [expanded, setExpanded] = useState(false);
  const mic = deployment.microphonePlacement || {};
  const acoustic = deployment.acousticConditions || {};
  function patchMic(patch) { onPatch({ microphonePlacement: { ...mic, ...patch } }); }
  function patchAcoustic(patch) { onPatch({ acousticConditions: { ...acoustic, ...patch } }); }

  const issues = [];
  if (mic.theftRiskConstraint) issues.push('positioned to reduce theft risk');
  if (mic.vandalismRiskConstraint) issues.push('positioned to reduce vandalism risk');
  if (mic.leavesWithinImmediateField) issues.push('leaves within the immediate microphone field');
  else if (mic.nearbyVegetation) issues.push('close to vegetation');
  if (mic.nearbyRoad) issues.push('near a road');
  if (mic.nearbyPath) issues.push('near a path');
  if (acoustic.vegetationNoise === 'high') issues.push('high vegetation noise observed');
  if (acoustic.windNoise === 'high') issues.push('high wind noise observed');
  if (acoustic.anthropogenicNoise === 'high') issues.push('high anthropogenic noise observed');

  const boolField = (label, key, patchFn, obj) => h('label', { key, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 } },
    h('input', { type: 'checkbox', checked: !!obj[key], onChange: (e) => patchFn({ [key]: e.target.checked }) }), label);
  const selectField = (label, key, options) => h(Field, { key, label },
    h('select', {
      value: acoustic[key] || '', onChange: (e) => patchAcoustic({ [key]: e.target.value || null }),
      style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px' },
    }, h('option', { value: '' }, 'Unknown'), options.map((o) => h('option', { key: o, value: o }, o))));

  return h('div', { style: { marginTop: 24 } },
    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0 } },
      h('span', null, 'Recording conditions'),
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => setExpanded(!expanded) }, expanded ? 'Hide' : (mic.placementQuality ? 'Edit' : '+ Record conditions'))
    ),
    h('div', { className: 'card-sub', style: { marginTop: 6, marginBottom: 10 } },
      `Recording conditions: ${mic.placementQuality ? PLACEMENT_QUALITY_LABELS[mic.placementQuality] : 'Not yet assessed'}.`,
      issues.length > 0 && ` Primary issue: ${issues[0]}.`
    ),
    expanded && h('div', { className: 'card' },
      h(Field, { label: 'Overall placement quality' },
        h('select', {
          value: mic.placementQuality || '', onChange: (e) => patchMic({ placementQuality: e.target.value || null }),
          style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px' },
        },
          h('option', { value: '' }, 'Not yet assessed'),
          Object.entries(PLACEMENT_QUALITY_LABELS).map(([v, label]) => h('option', { key: v, value: v }, label))
        )
      ),
      h('div', { className: 'field-row' },
        h(Field, { label: 'Microphone height (m)' }, h('input', { type: 'number', step: 'any', value: mic.heightMetres ?? '', onChange: (e) => patchMic({ heightMetres: e.target.value === '' ? null : Number(e.target.value) }) })),
        h(Field, { label: 'Mounting type' }, h('input', { value: mic.mountingType || '', placeholder: 'e.g. tree-mounted', onChange: (e) => patchMic({ mountingType: e.target.value }) })),
        h(Field, { label: 'Orientation' }, h('input', { value: mic.orientation || '', placeholder: 'e.g. horizontal', onChange: (e) => patchMic({ orientation: e.target.value }) }))
      ),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginBottom: 14 } },
        boolField('Enclosure used', 'enclosureUsed', patchMic, mic),
        boolField('Nearby vegetation', 'nearbyVegetation', patchMic, mic),
        boolField('Leaves within immediate field', 'leavesWithinImmediateField', patchMic, mic),
        boolField('Nearby path', 'nearbyPath', patchMic, mic),
        boolField('Nearby road', 'nearbyRoad', patchMic, mic),
        boolField('Nearby water', 'nearbyWater', patchMic, mic),
        boolField('Nearby lighting', 'nearbyLighting', patchMic, mic),
        boolField('Theft-risk constraint', 'theftRiskConstraint', patchMic, mic),
        boolField('Vandalism-risk constraint', 'vandalismRiskConstraint', patchMic, mic)
      ),
      mic.nearbyVegetation && h(Field, { label: 'Vegetation distance (m)' }, h('input', { type: 'number', step: 'any', value: mic.vegetationDistanceMetres ?? '', onChange: (e) => patchMic({ vegetationDistanceMetres: e.target.value === '' ? null : Number(e.target.value) }) })),
      h(Field, { label: 'Placement notes' }, h('textarea', { rows: 2, value: mic.notes || '', onChange: (e) => patchMic({ notes: e.target.value }) })),

      h('div', { className: 'section-title', style: { fontSize: 14 } }, 'Acoustic conditions'),
      h('div', { className: 'field-row' },
        selectField('Vegetation noise', 'vegetationNoise', ['low', 'moderate', 'high']),
        selectField('Wind noise', 'windNoise', ['low', 'moderate', 'high']),
        selectField('Rain noise', 'rainNoise', ['low', 'moderate', 'high'])
      ),
      h('div', { className: 'field-row' },
        selectField('Anthropogenic noise', 'anthropogenicNoise', ['low', 'moderate', 'high']),
        selectField('Weak-signal prevalence', 'weakSignalPrevalence', ['low', 'moderate', 'high'])
      ),
      boolField('Clipping / overload observed', 'clippingOrOverloadObserved', patchAcoustic, acoustic),
      h(Field, { label: 'Acoustic condition notes' }, h('textarea', { rows: 2, value: acoustic.notes || '', onChange: (e) => patchAcoustic({ notes: e.target.value }) }))
    )
  );
}

// ---------------- QA (review-queue rules, drives Manual Review) ----------------

function StatBox({ label, value, sub }) {
  return h('div', { className: 'stat-box' },
    h('div', { className: 'stat-box-label' }, label),
    h('div', { className: 'stat-box-value' }, String(value)),
    sub ? h('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 } }, sub) : null
  );
}

// "68.3%" reads as far more precise than a small sample actually supports - pairing every
// reliability percentage with its 95% Wilson interval keeps that visible at a glance rather than
// needing a separate table. Renders nothing when there's no sample to compute an interval from.
function fmtCi(lowerPct, upperPct) {
  if (lowerPct == null || upperPct == null) return null;
  return `95% CI ${fmtNum(lowerPct)}-${fmtNum(upperPct)}%`;
}

// Corrective brief sections 13.4/13.5: a raw comparison between two periods/effort levels can be
// more about WHEN or HOW MUCH was surveyed than a real ecological difference - render whatever
// Stats.computeComparisonWarnings flagged so that context travels with the number, not just in a
// tooltip somewhere else.
const COMPARISON_WARNING_LABELS = {
  'unmatched-period': 'Unmatched survey period',
  'effort-mismatch-nights': 'Effort differs substantially (nights)',
};
function ComparisonWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 } },
    warnings.map((w) => h('span', {
      key: w, className: 'pill', style: { color: 'var(--accent)', borderColor: 'var(--accent-dim)' },
      title: 'Raw differences between these two may partly reflect this, not just ecology',
    }, `⚠ ${COMPARISON_WARNING_LABELS[w] || w}`))
  );
}

function fmtIndex(v) {
  return v == null ? '-' : v.toFixed(2);
}

function QaTab({ deployment, onPatch, wavFileMap, setWavFileMap, onGoToReview }) {
  const events = deployment.detectionEvents || [];
  const profile = deployment.qaProfile || DEFAULT_QA_PROFILE;
  function patchProfile(patch) {
    onPatch({ qaProfile: { ...profile, ...patch } });
  }

  const summary = useMemo(() => QaProfiles.computeQaSummary(events, profile), [events, profile]);
  const reviewStateSummary = useMemo(() => Stats.computeReviewStateSummary(events), [events]);
  const qaCoverage = useMemo(() => Stats.computeQaCoverage(events), [events]);
  const speciesList = useMemo(() => {
    const counts = computeSpeciesCounts(events);
    return Object.keys(counts).filter((s) => s !== 'Noise / No ID').sort();
  }, [events]);

  const [newSpecies, setNewSpecies] = useState('');
  function addRequiredSpecies() {
    const trimmed = newSpecies.trim();
    if (!trimmed || profile.speciesRequiring100Percent.includes(trimmed)) return;
    patchProfile({ speciesRequiring100Percent: [...profile.speciesRequiring100Percent, trimmed] });
    setNewSpecies('');
  }
  function removeRequiredSpecies(name) {
    patchProfile({ speciesRequiring100Percent: profile.speciesRequiring100Percent.filter((s) => s !== name) });
  }

  const speciesThresholds = profile.speciesThresholds || [];
  const [newThresholdSpecies, setNewThresholdSpecies] = useState('');
  const [newThresholdValue, setNewThresholdValue] = useState(60);
  function addSpeciesThreshold() {
    const trimmed = newThresholdSpecies.trim();
    if (!trimmed || speciesThresholds.some((s) => s.species === trimmed)) return;
    patchProfile({ speciesThresholds: [...speciesThresholds, { species: trimmed, threshold: newThresholdValue }] });
    setNewThresholdSpecies('');
  }
  function updateSpeciesThreshold(species, value) {
    patchProfile({ speciesThresholds: speciesThresholds.map((s) => (s.species === species ? { ...s, threshold: value } : s)) });
  }
  function removeSpeciesThreshold(species) {
    patchProfile({ speciesThresholds: speciesThresholds.filter((s) => s.species !== species) });
  }

  const inputStyle = {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--text)', padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-body)',
  };

  return h('div', { className: 'content' },
    h('div', { className: 'section-title' }, 'WAV files'),
    h(WavFolderPicker, { wavFileMap, setWavFileMap }),
    h('div', { className: 'card-sub', style: { marginTop: 6 } },
      "Selecting a folder includes every WAV file in its subfolders automatically - handy since some detectors split each survey night into its own folder and others dump everything in one. Loaded once here, it's available in Manual Review too."),

    h('div', { className: 'section-title' }, 'Review queue rules'),
    h('div', { className: 'card', style: { marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' } },
      h('div', { style: { fontWeight: 600, marginBottom: 6, color: 'var(--text)' } }, "What does BTO itself recommend?"),
      h('div', null,
        "BTO's Acoustic Pipeline groups its own results by confidence: identifications below 50% probability are recommended to be discarded or checked (this app's ",
        h('strong', null, '50% default threshold'),
        ' matches that exactly); below 10% ("Folder 2") BTO recommends discarding outright unless you specifically want peace of mind that nothing usable is being missed; and for very large single-species volumes (tens of thousands of calls), BTO suggests auditing a random sample of up to ',
        h('strong', null, '1,000 recordings'),
        ' is enough for a robust error-rate estimate, rather than a fixed percentage. None of that is enforced automatically here - this app never silently drops a detection - but it\'s worth keeping in mind when you set the sample % and threshold below.'
      )
    ),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Random sample % (everything else)' },
        h('input', { type: 'number', min: 0, max: 100, value: profile.samplePercent, onChange: (e) => patchProfile({ samplePercent: Number(e.target.value) }) })),
      h(Field, { label: 'Probability threshold % (review anything below this)' },
        h('input', { type: 'number', min: 0, max: 100, value: profile.probabilityThreshold, onChange: (e) => patchProfile({ probabilityThreshold: Number(e.target.value) }) }))
    ),
    h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 18, color: 'var(--text-muted)' } },
      h('input', { type: 'checkbox', checked: profile.alwaysReviewNoId, onChange: (e) => patchProfile({ alwaysReviewNoId: e.target.checked }) }),
      'Always review calls BTO could not identify at all (No ID)'
    ),

    h('div', { className: 'section-title' }, 'Per-species confidence thresholds'),
    h('div', { className: 'card-sub', style: { marginBottom: 10 } },
      'Overrides the global probability threshold above for species the model is known to handle well - e.g. accept Common/Soprano Pipistrelle above 60% instead of the usual 50%.'),
    speciesThresholds.length === 0 && h('div', { className: 'card-sub', style: { marginBottom: 10 } }, 'None set.'),
    speciesThresholds.length > 0 && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 } },
      speciesThresholds.map((s) => h('div', { key: s.species, style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', { style: { minWidth: 160 } }, s.species),
        h('input', {
          type: 'number', min: 0, max: 100, value: s.threshold, style: { width: 70 },
          onChange: (e) => updateSpeciesThreshold(s.species, Number(e.target.value)),
        }),
        h('span', { className: 'card-sub' }, '%'),
        h('button', {
          onClick: () => removeSpeciesThreshold(s.species),
          style: { background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 },
        }, 'Remove')
      ))
    ),
    h('div', { style: { display: 'flex', gap: 8, marginBottom: 24 } },
      h('input', {
        value: newThresholdSpecies, list: 'qa-species-list', placeholder: 'Species (e.g. Common Pipistrelle)...', style: { ...inputStyle, flex: 1, maxWidth: 220 },
        onChange: (e) => setNewThresholdSpecies(e.target.value),
      }),
      h('input', { type: 'number', min: 0, max: 100, value: newThresholdValue, style: { ...inputStyle, width: 70 }, onChange: (e) => setNewThresholdValue(Number(e.target.value)) }),
      h('span', { className: 'card-sub', style: { alignSelf: 'center' } }, '%'),
      h('button', { className: 'btn btn-secondary btn-small', disabled: !newThresholdSpecies.trim(), onClick: addSpeciesThreshold }, 'Add')
    ),

    h('div', { className: 'section-title' }, 'Full QA species (always 100% reviewed)'),
    h('div', { className: 'card-sub', style: { marginBottom: 10 } },
      'Tick any species BTO reported for this deployment that should always be fully reviewed, regardless of probability or the random sample - typically rare, protected, or easily-confused species. Everything else falls back to the threshold and sample rules above.'),
    speciesList.length === 0
      ? h('div', { className: 'card-sub', style: { marginBottom: 10 } }, "Import a BTO CSV first to see this deployment's own species list here.")
      : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginBottom: 10 } },
          speciesList.map((s) => h('label', { key: s, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 } },
            h('input', {
              type: 'checkbox', checked: profile.speciesRequiring100Percent.includes(s),
              onChange: (e) => patchProfile({
                speciesRequiring100Percent: e.target.checked
                  ? [...profile.speciesRequiring100Percent, s]
                  : profile.speciesRequiring100Percent.filter((x) => x !== s),
              }),
            }),
            s
          ))
        ),
    profile.speciesRequiring100Percent.some((s) => !speciesList.includes(s)) && h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 } },
      h('span', { className: 'card-sub', style: { width: '100%' } }, "Also set, but not (yet) in this deployment's own results:"),
      profile.speciesRequiring100Percent.filter((s) => !speciesList.includes(s)).map((s) => h('span', {
        key: s, className: 'pill', style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px' },
      }, s, h('button', {
        onClick: () => removeRequiredSpecies(s),
        style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 },
      }, '×')))
    ),
    h('div', { className: 'card-sub', style: { marginBottom: 6 } }, "Add a species not yet in this deployment's results (e.g. before importing):"),
    h('div', { style: { display: 'flex', gap: 8, marginBottom: 24 } },
      h('input', {
        value: newSpecies, list: 'qa-species-list', placeholder: 'Add species (e.g. Barbastelle)...', style: { ...inputStyle, flex: 1, maxWidth: 260 },
        onChange: (e) => setNewSpecies(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') addRequiredSpecies(); },
      }),
      h('datalist', { id: 'qa-species-list' }, ALL_SPECIES_NAMES.map((s) => h('option', { key: s, value: s }))),
      h('button', { className: 'btn btn-secondary btn-small', disabled: !newSpecies.trim(), onClick: addRequiredSpecies }, 'Add')
    ),

    h('div', { className: 'section-title' }, 'Queue summary'),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Total detections', value: summary.totalEvents }),
      h(StatBox, { label: 'In review queue', value: summary.queued }),
      h(StatBox, { label: 'Reviewed', value: summary.queuedReviewed }),
      h(StatBox, { label: 'Remaining', value: summary.queuedRemaining })
    ),
    h('div', { className: 'card-sub', style: { marginTop: 10 } },
      `No ID: ${summary.byReason['no-id']} · Below threshold: ${summary.byReason['below-threshold']} · 100%-species: ${summary.byReason['100pct-species']} · Sampled: ${summary.byReason.sampled} · Not selected: ${summary.byReason['not-selected']}`),

    summary.queued > 0 && (
      summary.queuedRemaining > 0
        ? h('div', { className: 'card', style: { marginTop: 16, borderColor: 'var(--danger)' } },
            h('div', { style: { color: 'var(--danger)', fontWeight: 600 } },
              `⚠ ${summary.queuedRemaining} of ${summary.queued} queued calls still need review - statistics won't reflect a complete QA pass until this reaches zero.`))
        : h('div', { className: 'card', style: { marginTop: 16, borderColor: 'var(--teal)' } },
            h('div', { style: { color: 'var(--teal)', fontWeight: 600 } }, `✓ QA complete - all ${summary.queued} queued calls have been reviewed.`))
    ),

    h('div', { className: 'section-title' }, 'Review outcomes'),
    reviewStateSummary.reviewedCount === 0
      ? h('div', { className: 'card-sub' }, 'No calls reviewed yet - accept/modify/reject rates will appear here once some QA has been done.')
      : h(React.Fragment, null,
          h('div', { className: 'card-sub', style: { marginBottom: 8 } },
            'Computed separately per corrective-brief guidance - a single reliability figure hides whether a reviewer mostly confirmed BTO, corrected it to a different species, or rejected the call outright.'),
          h('div', { className: 'stat-grid' },
            h(StatBox, { label: 'Accepted', value: `${fmtNum(reviewStateSummary.acceptanceRatePct)}%`, sub: fmtCi(reviewStateSummary.acceptanceRateCiLowerPct, reviewStateSummary.acceptanceRateCiUpperPct) }),
            h(StatBox, { label: 'Modified', value: `${fmtNum(reviewStateSummary.modificationRatePct)}%`, sub: fmtCi(reviewStateSummary.modificationRateCiLowerPct, reviewStateSummary.modificationRateCiUpperPct) }),
            h(StatBox, { label: 'Rejected', value: `${fmtNum(reviewStateSummary.rejectionRatePct)}%`, sub: fmtCi(reviewStateSummary.rejectionRateCiLowerPct, reviewStateSummary.rejectionRateCiUpperPct) }),
            h(StatBox, { label: 'Reviewed (n)', value: reviewStateSummary.reviewedCount })
          )
        ),

    h('div', { className: 'section-title' }, 'QA coverage by species'),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      "A single overall \"% reviewed\" hides where review effort actually went - this breaks it down so a gap (e.g. no reviewed calls yet for a rare species) is visible."),
    qaCoverage.bySpecies.length === 0
      ? h('div', { className: 'card-sub' }, 'Import a BTO CSV first to see species coverage here.')
      : h('div', { className: 'card', style: { padding: 0, overflow: 'hidden', marginBottom: 16 } },
          h('div', { style: { overflowX: 'auto', maxHeight: 280, overflowY: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
              h('thead', null, h('tr', null,
                ['Species', 'Total', 'Reviewed', '% reviewed'].map((c) => h('th', {
                  key: c, style: { position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
                }, c))
              )),
              h('tbody', null, qaCoverage.bySpecies.map((s) => h('tr', { key: s.species },
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, s.species),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.total),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.reviewed),
                h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.reviewedPct) + '%')
              )))
            )
          )
        ),

    h('div', { className: 'section-title' }, 'QA coverage by BTO confidence band'),
    h('div', { className: 'card', style: { padding: 0, overflow: 'hidden' } },
      h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            ['Band', 'Total', 'Reviewed', '% reviewed'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
            }, c))
          )),
          h('tbody', null, qaCoverage.byConfidenceBand.map((b) => h('tr', { key: b.label },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, b.label),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, b.total),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, b.reviewed),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(b.reviewedPct) + '%')
          )))
        )
      )
    ),

    h('div', { style: { display: 'flex', gap: 10, marginTop: 16 } },
      h('button', { className: 'btn btn-primary', onClick: onGoToReview }, 'Go to Manual Review →'),
      h('button', {
        className: 'btn btn-secondary',
        onClick: () => downloadTextFile(`${(deployment.name || 'deployment').replace(/[^A-Za-z0-9_-]+/g, '_')}_detections.csv`, detectionEventsToCsv(deployment), 'text/csv'),
      }, 'Export CSV (old ID vs new ID)')
    )
  );
}

// ---------------- Manual review (sonogram, measurement, shape, decision tree, QA) ----------------

// De-duplicated species display names (species-data.js has separate rows per call-type
// variant, e.g. "Noctule (qCF)" / "Noctule (FM/qCF)" - strip that suffix for labelling).
const ALL_SPECIES_NAMES = Array.from(new Set(
  SpeciesData.SPECIES.map((sp) => sp.name.replace(/\s*\([^)]*\)\s*$/, '').trim())
)).sort();

function CustomLabelInput({ onSubmit }) {
  const [value, setValue] = useState('');
  function submit() {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setValue('');
  }
  return h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
    h('input', {
      value, list: 'all-species-names', placeholder: 'Other species BTO missed...',
      style: {
        flex: 1, maxWidth: 260, background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, color: 'var(--text)', padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-body)',
      },
      onChange: (e) => setValue(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
    }),
    h('datalist', { id: 'all-species-names' }, ALL_SPECIES_NAMES.map((n) => h('option', { key: n, value: n }))),
    h('button', { className: 'btn btn-secondary btn-small', disabled: !value.trim(), onClick: submit }, 'Set label')
  );
}

// For a species BTO's classifier never gave a candidate row at all (as opposed to a low-probability
// one). Shares the existing species datalist (#all-species-names) rendered by CustomLabelInput.
function AddMissedSpeciesInput({ onAdd, buttonLabel, placeholder }) {
  const [value, setValue] = useState('');
  function submit() {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  }
  return h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
    h('input', {
      value, list: 'all-species-names', placeholder: placeholder || 'Species BTO missed entirely...',
      style: {
        flex: 1, maxWidth: 260, background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, color: 'var(--text)', padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-body)',
      },
      onChange: (e) => setValue(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
    }),
    h('button', { className: 'btn btn-secondary btn-small', disabled: !value.trim(), onClick: submit }, buttonLabel || '+ Add')
  );
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// One row per Detection Event, with the automated (BTO) ID and Clara's manual review outcome
// as clearly separate columns, so it's obvious from the file alone which calls were checked.
function detectionEventsToCsv(deployment) {
  const profile = deployment.qaProfile || DEFAULT_QA_PROFILE;
  const header = [
    'Original WAV', 'Part', 'Survey Date', 'Time', 'Latitude', 'Longitude',
    'Old ID (BTO)', 'Old ID Probability', 'Old ID Warnings', 'All BTO Candidates',
    'Manually Reviewed', 'Reviewed At', 'New ID (Final)', 'QA Queue Reason',
  ];
  const rows = (deployment.detectionEvents || []).map((ev) => {
    const reason = QaProfiles ? QaProfiles.computeQaInclusion(ev, profile).reason : '';
    const resolved = M.resolveFinalId(ev);
    const oldId = ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID';
    const oldProb = ev.primaryBtoId && ev.primaryBtoId.probability != null ? ev.primaryBtoId.probability : '';
    const oldWarnings = ev.primaryBtoId ? ev.primaryBtoId.warnings : '';
    const allCandidates = ev.candidateSpecies
      .map((c) => `${c.englishName || c.species} (${c.probability != null ? (c.probability * 100).toFixed(0) + '%' : '?'})`)
      .join('; ');
    return [
      ev.originalWav, ev.partNumber, ev.surveyDate, ev.time, ev.latitude, ev.longitude,
      oldId, oldProb, oldWarnings, allCandidates,
      ev.manualReview.reviewed ? 'Yes' : 'No', ev.manualReview.reviewedAt || '', resolved.finalId, QA_REASON_LABELS[reason] || '',
    ];
  });
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}

function computeSpeciesCounts(events) {
  const counts = {};
  for (const ev of events) {
    const label = ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'Noise / No ID';
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function sortEventsChronologically(events) {
  return [...events].sort((a, b) => {
    if (a.surveyDate !== b.surveyDate) return (a.surveyDate || '').localeCompare(b.surveyDate || '');
    if (a.time !== b.time) return (a.time || '').localeCompare(b.time || '');
    if (a.originalWav !== b.originalWav) return (a.originalWav || '').localeCompare(b.originalWav || '');
    return (parseInt(a.partNumber, 10) || 0) - (parseInt(b.partNumber, 10) || 0);
  });
}

// Parses "DD/MM/YYYY" + "HH:MM:SS" (the BTO CSV's own format) into a Date.
function parseEventTimestamp(ev) {
  if (!ev.actualDate || !ev.time) return null;
  const [d, m, y] = ev.actualDate.split('/').map(Number);
  const [hh, mm, ss] = ev.time.split(':').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  return isNaN(dt.getTime()) ? null : dt;
}

// Best-effort offset (seconds) of a Detection Event within its original WAV file, using the
// file-start timestamp commonly embedded in detector filenames (e.g. "..._20260617_221514.wav")
// against the event's own BTO timestamp. Null if either can't be parsed - never guessed silently.
function estimateOffsetSec(ev) {
  const fileStart = Wav.parseTimestampFromFilename(ev.originalWav);
  const eventTime = parseEventTimestamp(ev);
  if (!fileStart || !eventTime) return null;
  return (eventTime.getTime() - fileStart.getTime()) / 1000;
}

// BTO's "actual date" column, DD/MM/YYYY, date only (no time - unlike parseEventTimestamp above).
function parseActualDateOnly(actualDate) {
  if (!actualDate) return null;
  const [d, m, y] = actualDate.split('/').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function toDateInputValue(date) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function primaryIdLabel(ev) {
  return ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID';
}

// Resolved label for display: just the primary species for a single-species event, or every
// species joined together when manual review found more than one in the same Detection Event.
function formatResolvedLabel(ev) {
  const records = M.resolveSpeciesRecords(ev);
  return records.map((r) => r.finalId).join(' + ');
}

// Groups every call by BTO's Primary ID (chronological within each species) - much faster to
// review in batches when the same species' calls repeat back-to-back.
function sortEventsByPrimaryId(events) {
  return [...events].sort((a, b) => {
    const la = primaryIdLabel(a), lb = primaryIdLabel(b);
    if (la !== lb) return la.localeCompare(lb);
    if (a.surveyDate !== b.surveyDate) return (a.surveyDate || '').localeCompare(b.surveyDate || '');
    return (a.time || '').localeCompare(b.time || '');
  });
}

// By resolved Final ID (manual review wins over BTO's primary candidate) rather than the raw BTO
// guess - lets calls be grouped/browsed by what they've actually been identified as, e.g. to
// review every call currently labelled "Myotis sp" together regardless of what BTO first thought.
function sortEventsByFinalId(events) {
  return [...events].sort((a, b) => {
    const la = M.resolveFinalId(a).finalId, lb = M.resolveFinalId(b).finalId;
    if (la !== lb) return la.localeCompare(lb);
    if (a.surveyDate !== b.surveyDate) return (a.surveyDate || '').localeCompare(b.surveyDate || '');
    return (a.time || '').localeCompare(b.time || '');
  });
}

function freqToPixelY(f, sampleRate, height) {
  const nyquist = sampleRate / 2;
  return height * (1 - f / nyquist);
}

function BoxOverlay({ box, view, sampleRate, width, specHeight }) {
  const x0 = timeToPixel(box.t0, view, width);
  const x1 = timeToPixel(box.t1, view, width);
  const y0 = freqToPixelY(box.f1, sampleRate, specHeight);
  const y1 = freqToPixelY(box.f0, sampleRate, specHeight);
  return h('div', {
    style: {
      position: 'absolute', left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0),
      border: '2px solid var(--teal)', background: 'rgba(79,184,168,0.12)', pointerEvents: 'none',
    },
  });
}

// Draws the measured Start/End frequency directly on the sonogram, so the stat-card numbers can
// be checked at a glance against the call itself. (Previously drew Max/Min frequency - removed
// along with the measurement itself; see measureBox's comment in dsp.js for why.)
function MeasurementOverlay({ measurement, box, view, sampleRate, width, specHeight }) {
  const x0 = timeToPixel(box.t0, view, width);
  const x1 = timeToPixel(box.t1, view, width);
  const parts = [];

  if (measurement.startFreqHz != null) {
    const y = freqToPixelY(measurement.startFreqHz, sampleRate, specHeight);
    if (y >= 0 && y <= specHeight) {
      parts.push(h('div', {
        key: 'start', style: { position: 'absolute', left: x0, top: y, width: Math.max(1, x1 - x0), borderTop: '1px dashed #ffb454', pointerEvents: 'none' },
      }, h('span', { style: { position: 'absolute', left: 2, top: -13, fontSize: 9, color: '#ffb454', fontFamily: 'var(--font-mono)', background: 'rgba(10,12,14,0.75)', padding: '0 3px', borderRadius: 3, whiteSpace: 'nowrap' } }, `start ${(measurement.startFreqHz / 1000).toFixed(1)}k`)));
    }
  }
  if (measurement.endFreqHz != null) {
    const y = freqToPixelY(measurement.endFreqHz, sampleRate, specHeight);
    if (y >= 0 && y <= specHeight) {
      parts.push(h('div', {
        key: 'end', style: { position: 'absolute', left: x0, top: y, width: Math.max(1, x1 - x0), borderTop: '1px dashed #7ec8e3', pointerEvents: 'none' },
      }, h('span', { style: { position: 'absolute', left: 2, top: 3, fontSize: 9, color: '#7ec8e3', fontFamily: 'var(--font-mono)', background: 'rgba(10,12,14,0.75)', padding: '0 3px', borderRadius: 3, whiteSpace: 'nowrap' } }, `end ${(measurement.endFreqHz / 1000).toFixed(1)}k`)));
    }
  }

  return h(React.Fragment, null, ...parts);
}

const SONOGRAM_WIDTH = 860, SPEC_HEIGHT = 260, OSC_HEIGHT = 70;
const AXIS_LEFT_WIDTH = 46, AXIS_BOTTOM_HEIGHT = 20;
const MIN_ZOOM_WINDOW_SEC = 0.003;

// Picks a "nice" round tick spacing (1/2/5 x10^n) that gives roughly targetTicks divisions.
function niceStep(range, targetTicks) {
  if (!(range > 0)) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function timeToPixel(t, view, width) {
  const range = view.t1 - view.t0;
  return range > 0 ? ((t - view.t0) / range) * width : 0;
}

function Sonogram({ spec, samples, sampleRate, floorDb, rangeDb, saturation, box, onBoxChange, guidelines, partMarkers, measurement, onSelectPart, captureMode, onCapture }) {
  const specCanvasRef = useRef(null);
  const oscCanvasRef = useRef(null);
  const dragRef = useRef(null);
  const [dragRect, setDragRect] = useState(null);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ t0: 0, t1: spec ? spec.durationSec : 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // A new call (or FFT-size change) means a fresh spec object - reset zoom to the full view.
  useEffect(() => { if (spec) setView({ t0: 0, t1: spec.durationSec }); }, [spec]);

  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas || !spec) return;
    canvas.width = SONOGRAM_WIDTH; canvas.height = SPEC_HEIGHT;
    const ctx = canvas.getContext('2d');
    const frameFrom = Dsp.frameIndexForTime(spec, view.t0);
    const frameTo = Math.max(frameFrom, Dsp.frameIndexForTime(spec, view.t1));
    const img = Dsp.renderSpectrogramImageData(spec, {
      frameFrom, frameTo, binFrom: 0, binTo: spec.numBins - 1,
      floorDb, rangeDb, saturation,
    });
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.clearRect(0, 0, SONOGRAM_WIDTH, SPEC_HEIGHT);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, SONOGRAM_WIDTH, SPEC_HEIGHT);
  }, [spec, floorDb, rangeDb, saturation, view]);

  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas || !samples) return;
    canvas.width = SONOGRAM_WIDTH; canvas.height = OSC_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14171a';
    ctx.fillRect(0, 0, SONOGRAM_WIDTH, OSC_HEIGHT);
    const { mins, maxs } = Dsp.computeOscillogramColumns(samples, sampleRate, view.t0, view.t1, SONOGRAM_WIDTH);
    ctx.strokeStyle = '#4fb8a8';
    ctx.beginPath();
    for (let x = 0; x < SONOGRAM_WIDTH; x++) {
      const yMin = OSC_HEIGHT / 2 - maxs[x] * (OSC_HEIGHT / 2 - 2);
      const yMax = OSC_HEIGHT / 2 - mins[x] * (OSC_HEIGHT / 2 - 2);
      ctx.moveTo(x + 0.5, yMin);
      ctx.lineTo(x + 0.5, yMax);
    }
    ctx.stroke();
  }, [samples, sampleRate, view]);

  // Native (non-passive) wheel listener so preventDefault reliably stops the page scrolling
  // while zooming the sonogram - React's synthetic onWheel can't guarantee that.
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas || !spec) return;
    function onWheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = SONOGRAM_WIDTH / rect.width;
      const x = Math.max(0, Math.min(SONOGRAM_WIDTH, (e.clientX - rect.left) * scaleX));
      const v = viewRef.current;
      const range = v.t1 - v.t0;
      const cursorTime = v.t0 + (x / SONOGRAM_WIDTH) * range;
      const factor = e.deltaY < 0 ? 0.8 : 1.25;
      const fullRange = spec.durationSec;
      let newRange = Math.min(fullRange, Math.max(MIN_ZOOM_WINDOW_SEC, range * factor));
      const ratio = range > 0 ? (cursorTime - v.t0) / range : 0.5;
      let newT0 = cursorTime - ratio * newRange;
      let newT1 = newT0 + newRange;
      if (newT0 < 0) { newT1 -= newT0; newT0 = 0; }
      if (newT1 > fullRange) { newT0 -= (newT1 - fullRange); newT1 = fullRange; }
      setView({ t0: Math.max(0, newT0), t1: Math.min(fullRange, newT1) });
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [spec]);

  function pixelToTime(x) {
    const range = view.t1 - view.t0;
    return Math.max(0, view.t0 + (x / SONOGRAM_WIDTH) * range);
  }
  function pixelToFreq(y) {
    const nyquist = sampleRate / 2;
    return Math.max(0, Math.min(nyquist, nyquist * (1 - y / SPEC_HEIGHT)));
  }
  function localXY(e) {
    const rect = specCanvasRef.current.getBoundingClientRect();
    const scaleX = SONOGRAM_WIDTH / rect.width, scaleY = SPEC_HEIGHT / rect.height;
    return {
      x: Math.max(0, Math.min(SONOGRAM_WIDTH, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(SPEC_HEIGHT, (e.clientY - rect.top) * scaleY)),
    };
  }

  function handleMouseDown(e) {
    const p = localXY(e);
    dragRef.current = p;
    setDragRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function handleMouseMove(e) {
    const p = localXY(e);
    setHover({ x: p.x, y: p.y, timeMs: pixelToTime(p.x) * 1000, freqKHz: pixelToFreq(p.y) / 1000 });
    if (dragRef.current) setDragRect({ x0: dragRef.current.x, y0: dragRef.current.y, x1: p.x, y1: p.y });
  }
  function handleMouseUp(e) {
    if (!dragRef.current) return;
    const p = localXY(e);
    const start = dragRef.current;
    dragRef.current = null;
    setDragRect(null);

    // Manual-measurement tools take over the same drag gesture when armed: a line drag reads a
    // time span (Duration/IPI, ignoring Y - only the time delta matters), a point "click" (any
    // drag, however small) reads the frequency at that Y. Neither touches the measurement box.
    if (captureMode === 'duration-line' || captureMode === 'ipi-line') {
      const ms = Math.abs(pixelToTime(p.x) - pixelToTime(start.x)) * 1000;
      if (ms > 0 && onCapture) onCapture(captureMode, ms);
      return;
    }
    if (captureMode === 'start-point' || captureMode === 'end-point') {
      const freqHz = pixelToFreq((start.y + p.y) / 2);
      if (onCapture) onCapture(captureMode, freqHz);
      return;
    }

    const x0 = Math.min(start.x, p.x), x1 = Math.max(start.x, p.x);
    const y0 = Math.min(start.y, p.y), y1 = Math.max(start.y, p.y);
    if (x1 - x0 < 3) return;
    const t0 = pixelToTime(x0), t1 = pixelToTime(x1);
    const f1 = pixelToFreq(y0), f0 = pixelToFreq(y1);
    onBoxChange({ t0, t1, f0, f1 });
  }

  const nyquist = sampleRate / 2;
  const freqStep = niceStep(nyquist / 1000, 6);
  const freqTicks = [];
  for (let v = 0; v <= nyquist / 1000 + 0.001; v += freqStep) freqTicks.push(Math.round(v));

  const timeRangeMs = (view.t1 - view.t0) * 1000;
  const timeStep = niceStep(timeRangeMs, 6);
  const timeTicks = [];
  const firstTimeTick = Math.ceil((view.t0 * 1000) / timeStep) * timeStep;
  for (let v = firstTimeTick; v <= view.t1 * 1000 + 0.001; v += timeStep) timeTicks.push(Math.round(v));

  const isZoomed = view.t1 - view.t0 < (spec ? spec.durationSec : 0) - 1e-6;

  return h('div', { style: { display: 'flex', flexDirection: 'column', width: SONOGRAM_WIDTH + AXIS_LEFT_WIDTH, maxWidth: '100%' } },
    h('div', { style: { display: 'flex' } },
      // Frequency (kHz) axis, aligned to the spectrogram only.
      h('div', { style: { width: AXIS_LEFT_WIDTH, position: 'relative', height: SPEC_HEIGHT, flexShrink: 0 } },
        freqTicks.map((kHz) => h('div', {
          key: kHz, style: { position: 'absolute', right: 6, top: freqToPixelY(kHz * 1000, sampleRate, SPEC_HEIGHT) - 6, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' },
        }, kHz))
      ),
      h('div', { style: { position: 'relative', width: SONOGRAM_WIDTH, flexShrink: 0, outline: captureMode ? '2px solid var(--accent)' : 'none', outlineOffset: -2 } },
        h('canvas', {
          ref: specCanvasRef, style: { width: SONOGRAM_WIDTH, height: SPEC_HEIGHT, display: 'block', cursor: captureMode ? 'copy' : 'crosshair', borderRadius: '8px 8px 0 0', background: '#0a0c0e' },
          onMouseDown: handleMouseDown, onMouseMove: handleMouseMove, onMouseUp: handleMouseUp,
          onMouseLeave: () => { dragRef.current = null; setDragRect(null); setHover(null); },
        }),
        h('canvas', { ref: oscCanvasRef, style: { width: SONOGRAM_WIDTH, height: OSC_HEIGHT, display: 'block', borderRadius: '0 0 8px 8px' } }),
        (guidelines || []).map((kHz) => {
          const y = freqToPixelY(kHz * 1000, sampleRate, SPEC_HEIGHT);
          if (y < 0 || y > SPEC_HEIGHT) return null;
          return h('div', { key: kHz, style: { position: 'absolute', left: 0, top: y, width: SONOGRAM_WIDTH, borderTop: '1px dashed var(--accent)', pointerEvents: 'none' } },
            h('span', { style: { position: 'absolute', right: 2, top: -14, fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)' } }, `${kHz}k`));
        }),
        // BTO "part" boundaries within this same physical file (see estimateOffsetSec) - makes it
        // obvious when what looks like one call bout is actually several BTO segments/species.
        (partMarkers || []).map((m) => {
          const x = timeToPixel(m.offsetSec, view, SONOGRAM_WIDTH);
          if (x < 0 || x > SONOGRAM_WIDTH) return null;
          const color = m.isCurrent ? 'var(--teal)' : 'rgba(255,255,255,0.4)';
          const text = `part ${m.partNumber}: ${m.label}`;
          const clickable = !m.isCurrent && !!onSelectPart;
          return h('div', { key: m.eventId, style: { position: 'absolute', left: x, top: 0, height: SPEC_HEIGHT, borderLeft: `1px ${m.isCurrent ? 'solid' : 'dashed'} ${color}`, pointerEvents: 'none' } },
            h('span', {
              title: text, // full label on hover - the visible text truncates when a part's own window is too narrow to fit it
              onClick: clickable ? () => onSelectPart(m.eventId) : undefined,
              style: {
                position: 'absolute', left: 3, top: 2 + m.stackIndex * 12, fontSize: 9, color, fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130,
                background: m.isCurrent ? 'rgba(79,184,168,0.15)' : 'rgba(10,12,14,0.65)', padding: '1px 3px', borderRadius: 3,
                pointerEvents: 'auto', cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline' : 'none', textDecorationStyle: 'dotted',
              },
            }, text));
        }),
        dragRect && h('div', {
          style: {
            position: 'absolute', left: Math.min(dragRect.x0, dragRect.x1), top: Math.min(dragRect.y0, dragRect.y1),
            width: Math.abs(dragRect.x1 - dragRect.x0), height: Math.abs(dragRect.y1 - dragRect.y0),
            border: '1px solid var(--accent)', background: 'rgba(232,131,58,0.15)', pointerEvents: 'none',
          },
        }),
        box && spec && h(BoxOverlay, { box, view, sampleRate, width: SONOGRAM_WIDTH, specHeight: SPEC_HEIGHT }),
        box && spec && measurement && h(MeasurementOverlay, { measurement, box, view, sampleRate, width: SONOGRAM_WIDTH, specHeight: SPEC_HEIGHT }),
        hover && h(React.Fragment, null,
          h('div', { style: { position: 'absolute', left: hover.x, top: 0, height: SPEC_HEIGHT, borderLeft: '1px dashed rgba(255,255,255,0.35)', pointerEvents: 'none' } }),
          hover.y <= SPEC_HEIGHT && h('div', { style: { position: 'absolute', left: 0, top: hover.y, width: SONOGRAM_WIDTH, borderTop: '1px dashed rgba(255,255,255,0.35)', pointerEvents: 'none' } }),
          h('div', {
            style: {
              position: 'absolute', left: Math.min(hover.x + 8, SONOGRAM_WIDTH - 110), top: Math.max(0, hover.y - 22),
              background: 'rgba(10,12,14,0.9)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px',
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', pointerEvents: 'none', whiteSpace: 'nowrap',
            },
          }, `${hover.freqKHz.toFixed(1)} kHz, ${hover.timeMs.toFixed(1)} ms`)
        )
      )
    ),
    h('div', { style: { display: 'flex' } },
      h('div', { style: { width: AXIS_LEFT_WIDTH, flexShrink: 0 } }),
      h('div', { style: { position: 'relative', width: SONOGRAM_WIDTH, height: AXIS_BOTTOM_HEIGHT, flexShrink: 0 } },
        timeTicks.map((ms) => h('div', {
          key: ms, style: { position: 'absolute', left: timeToPixel(ms / 1000, view, SONOGRAM_WIDTH) - 14, top: 2, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', width: 30, textAlign: 'center' },
        }, ms))
      )
    ),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
      h('span', { className: 'card-sub' }, 'Scroll to zoom (time axis)'),
      isZoomed && h('button', { className: 'btn btn-secondary btn-small', onClick: () => setView({ t0: 0, t1: spec.durationSec }) }, 'Reset zoom')
    )
  );
}

const POWER_SPEC_WIDTH = 860, POWER_SPEC_HEIGHT = 130;

// Power spectrum (dB vs frequency) for the boxed region - what BatSound/Kaleidoscope call the
// "Power Spectrum", read by eye to confirm Peak Frequency. Click anywhere on the curve to set the
// Peak Frequency override to that point - since this is the only reliable way to work out peak
// energy by hand when the sonogram alone doesn't make it obvious.
function PowerSpectrumChart({ powerSpectrum, onPickFreq }) {
  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null);
  const bounds = useMemo(() => {
    if (!powerSpectrum || !powerSpectrum.length) return null;
    let minF = Infinity, maxF = -Infinity, minDb = Infinity, maxDb = -Infinity;
    for (const p of powerSpectrum) {
      if (p.freqHz < minF) minF = p.freqHz;
      if (p.freqHz > maxF) maxF = p.freqHz;
      if (p.db < minDb) minDb = p.db;
      if (p.db > maxDb) maxDb = p.db;
    }
    return { minF, maxF, minDb, maxDb: maxDb + (maxDb - minDb) * 0.08 };
  }, [powerSpectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !powerSpectrum || !bounds) return;
    canvas.width = POWER_SPEC_WIDTH; canvas.height = POWER_SPEC_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(0, 0, POWER_SPEC_WIDTH, POWER_SPEC_HEIGHT);
    const { minF, maxF, minDb, maxDb } = bounds;
    const xFor = (f) => ((f - minF) / Math.max(1, maxF - minF)) * POWER_SPEC_WIDTH;
    const yFor = (db) => POWER_SPEC_HEIGHT - ((db - minDb) / Math.max(1e-6, maxDb - minDb)) * POWER_SPEC_HEIGHT;
    ctx.strokeStyle = '#4fb8a8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    powerSpectrum.forEach((p, i) => {
      const x = xFor(p.freqHz), y = yFor(p.db);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Mark the curve's own peak for reference.
    let peak = powerSpectrum[0];
    for (const p of powerSpectrum) if (p.db > peak.db) peak = p;
    ctx.fillStyle = '#e8833a';
    ctx.beginPath();
    ctx.arc(xFor(peak.freqHz), yFor(peak.db), 3, 0, Math.PI * 2);
    ctx.fill();
  }, [powerSpectrum, bounds]);

  if (!powerSpectrum || !powerSpectrum.length || !bounds) return null;
  const { minF, maxF, minDb, maxDb } = bounds;

  function xyToFreq(x) {
    return minF + (x / POWER_SPEC_WIDTH) * (maxF - minF);
  }
  function localX(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(POWER_SPEC_WIDTH, (e.clientX - rect.left) * (POWER_SPEC_WIDTH / rect.width)));
  }

  return h('div', { style: { marginTop: 10 } },
    h('div', { className: 'card-sub', style: { marginBottom: 4 } }, 'Power spectrum (dB vs frequency) - click the curve to set Peak Frequency:'),
    h('div', { style: { position: 'relative', width: POWER_SPEC_WIDTH, maxWidth: '100%' } },
      h('canvas', {
        ref: canvasRef,
        style: { width: '100%', height: POWER_SPEC_HEIGHT, display: 'block', cursor: 'crosshair', borderRadius: 8, background: '#0a0c0e' },
        onMouseMove: (e) => { const x = localX(e); setHover({ x, freqHz: xyToFreq(x) }); },
        onMouseLeave: () => setHover(null),
        onClick: (e) => { const x = localX(e); if (onPickFreq) onPickFreq(xyToFreq(x)); },
      }),
      hover && h('div', {
        style: {
          position: 'absolute', left: Math.min(hover.x + 8, POWER_SPEC_WIDTH - 90), top: 6,
          background: 'rgba(10,12,14,0.9)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px',
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', pointerEvents: 'none', whiteSpace: 'nowrap',
        },
      }, `${(hover.freqHz / 1000).toFixed(1)} kHz`)
    ),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' } },
      h('span', null, `${(minF / 1000).toFixed(0)} kHz`), h('span', null, `${(maxF / 1000).toFixed(0)} kHz`))
  );
}

const TE_FACTORS = [5, 10, 20];

function normalizeToPeak(x, targetPeak) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (peak <= 0) return x;
  const g = targetPeak / peak;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

// Plays the currently boxed region (or the whole visible recording if nothing's boxed) either as
// a simulated heterodyne detector (mix + lowpass, tunable) or time-expanded (slowed + pitched
// down by a fixed factor) - both audible ways of listening to an otherwise ultrasonic call.
// Real detector recordings are often recorded with a lot of headroom (quiet relative to full
// scale), so both modes are peak-normalized before playback and there's an extra gain control -
// otherwise "silence" can just mean "too quiet to notice", not that nothing is happening.
function AudioPlayback({ samples, sampleRate, box }) {
  const [mode, setMode] = useState('heterodyne');
  const [tuneKHz, setTuneKHz] = useState(45);
  const [teFactor, setTeFactor] = useState(10);
  const [gain, setGain] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const ctxRef = useRef(null);
  const sourceRef = useRef(null);
  const gainNodeRef = useRef(null);

  function stop() {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch (e) { /* already stopped */ }
      sourceRef.current = null;
    }
    setPlaying(false);
  }

  // Stop if the underlying recording changes (e.g. moved to the next call) or on unmount.
  useEffect(() => stop, [samples]);

  // Live volume changes while something is already playing.
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain;
  }, [gain]);

  function play() {
    stop();
    setError(null);
    try {
      const duration = samples.length / sampleRate;
      let t0 = 0, t1 = duration;
      if (box) {
        const pad = Math.min(0.02, (box.t1 - box.t0) * 0.2);
        t0 = Math.max(0, box.t0 - pad);
        t1 = Math.min(duration, box.t1 + pad);
      }
      const i0 = Math.floor(t0 * sampleRate), i1 = Math.min(samples.length, Math.ceil(t1 * sampleRate));
      const slice = samples.subarray(i0, i1);
      if (slice.length < 8) { setError('Selection too short to play.'); return; }

      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ctxRef.current;

      let data, outRate;
      if (mode === 'heterodyne') {
        const mixed = Dsp.heterodyneMix(slice, sampleRate, tuneKHz * 1000, 8000);
        outRate = Math.min(48000, sampleRate);
        data = normalizeToPeak(Dsp.resampleLinear(mixed, sampleRate, outRate), 0.85);
      } else {
        outRate = Math.max(8000, Math.min(192000, Math.round(sampleRate / teFactor)));
        data = normalizeToPeak(slice, 0.85);
      }
      const buffer = ctx.createBuffer(1, data.length, outRate);
      buffer.copyToChannel(data, 0);

      const startPlayback = () => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = gain;
        src.connect(gainNode);
        gainNode.connect(ctx.destination);
        src.onended = () => { setPlaying(false); sourceRef.current = null; gainNodeRef.current = null; };
        src.start();
        sourceRef.current = src;
        gainNodeRef.current = gainNode;
        setPlaying(true);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(startPlayback).catch((e) => setError('Could not start audio: ' + e.message));
      } else {
        startPlayback();
      }
    } catch (e) {
      setError('Could not play audio: ' + (e && e.message ? e.message : e));
    }
  }

  const selectStyle = { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 12 };

  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 8 } },
    h('span', { style: { color: 'var(--text-faint)', textTransform: 'uppercase', fontSize: 11 } }, 'Listen:'),
    h('select', { value: mode, onChange: (e) => setMode(e.target.value), style: selectStyle },
      h('option', { value: 'heterodyne' }, 'Heterodyne'),
      h('option', { value: 'timeExpansion' }, 'Time expansion')
    ),
    mode === 'heterodyne' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, 'Tune (kHz)',
      h('input', { type: 'number', value: tuneKHz, min: 10, max: 150, onChange: (e) => setTuneKHz(Number(e.target.value)), style: { ...selectStyle, width: 55 } })),
    mode === 'timeExpansion' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, 'Factor',
      h('select', { value: teFactor, onChange: (e) => setTeFactor(Number(e.target.value)), style: selectStyle },
        TE_FACTORS.map((f) => h('option', { key: f, value: f }, `${f}x`)))),
    h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, 'Volume',
      h('input', { type: 'range', min: 0.5, max: 5, step: 0.5, value: gain, onChange: (e) => setGain(Number(e.target.value)), style: { width: 70 } }),
      h('span', { style: { fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' } }, `${gain}x`)),
    h('button', { className: 'btn btn-secondary btn-small', onClick: playing ? stop : play }, playing ? '■ Stop' : '▶ Play'),
    box && h('span', { className: 'card-sub' }, '(boxed region)'),
    error && h('span', { style: { color: 'var(--danger)' } }, error)
  );
}

function WavFolderPicker({ wavFileMap, setWavFileMap }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  function handleChange(e) {
    try {
      const files = e.target.files || [];
      const map = new Map();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f && /\.wav$/i.test(f.name)) map.set(f.name, f);
      }
      setWavFileMap(map);
      setError(null);
    } catch (err) {
      setError('Could not read that folder: ' + (err && err.message ? err.message : err));
    }
  }
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('button', { className: 'btn btn-secondary btn-small', onClick: () => { if (inputRef.current) inputRef.current.click(); } },
        wavFileMap.size ? `WAV folder loaded (${wavFileMap.size} files) - change` : '+ Load WAV folder'),
      h('input', {
        ref: (el) => { inputRef.current = el; if (el) { el.webkitdirectory = true; el.directory = true; } },
        type: 'file', multiple: true, style: { display: 'none' }, onChange: handleChange,
      })
    ),
    error && h('div', { className: 'card-sub', style: { color: 'var(--danger)', marginTop: 6 } }, error)
  );
}

// The one canonical default QA profile (qa-profiles.js) - kept as a locally-named alias since it's
// referenced all over this file, but no longer its own independent literal (that's what let this
// drift out of sync with stats.js's own fallback - see qa-profiles.js's comment).
const DEFAULT_QA_PROFILE = QaProfiles.DEFAULT_PROFILE;
const QA_REASON_LABELS = {
  'no-id': 'Queued - No ID (always reviewed)',
  'below-threshold': 'Queued - below probability threshold',
  '100pct-species': 'Queued - 100%-review species',
  sampled: 'Queued - random sample',
  'not-selected': 'Not in queue',
};

// One hand-editable measurement field, optionally with a capture-tool toggle button (🎯 click a
// point on the sonogram, 📏 drag a line across it) that arms Sonogram's capture mode for this
// field. Compact by design - Clara's own request after the previous read-only stat-box grid ate
// too much space for what's now a hands-on measuring workflow.
function MeasureField({ label, value, unit, onChange, tool, active, onToggleTool }) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    h('label', { style: { fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 } },
      h('span', null, label),
      tool && h('button', {
        onClick: onToggleTool, title: tool.title, type: 'button',
        style: {
          background: active ? 'var(--accent)' : 'none', border: '1px solid var(--border)', borderRadius: 4,
          cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '2px 4px', color: active ? 'var(--accent-text)' : 'var(--text-faint)',
        },
      }, tool.icon)
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
      h('input', {
        type: 'number', step: 'any', value: value == null ? '' : value,
        onChange: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)),
        style: { width: 68, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '5px 6px', fontSize: 13, fontFamily: 'var(--font-mono)' },
      }),
      h('span', { style: { fontSize: 11, color: 'var(--text-faint)' } }, unit)
    )
  );
}

function ReviewTab({ deployment, onPatchEvent, wavFileMap, setWavFileMap, customLabels, onAddCustomLabel }) {
  const allEvents = deployment.detectionEvents || [];
  const profile = deployment.qaProfile || DEFAULT_QA_PROFILE;
  const [sortMode, setSortMode] = useState('primaryId'); // 'primaryId' | 'finalId' | 'chronological'
  const sorted = useMemo(() => {
    if (sortMode === 'finalId') return sortEventsByFinalId(allEvents);
    if (sortMode === 'chronological') return sortEventsChronologically(allEvents);
    return sortEventsByPrimaryId(allEvents);
  }, [allEvents, sortMode]);
  const [queueOnly, setQueueOnly] = useState(true);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  // Lets the whole list be narrowed to just one resolved Final ID - e.g. to check every call
  // currently labelled "Myotis sp" together, independent of QA queue/unreviewed status.
  const [finalIdFilter, setFinalIdFilter] = useState('');
  // Every resolved species across every event, not just each event's primary - so filtering by
  // "Myotis sp" also finds it when it was only added as a second Species Detection Record.
  const finalIdOptions = useMemo(
    () => Array.from(new Set(allEvents.flatMap((e) => M.resolveSpeciesRecords(e).map((r) => r.finalId)))).sort(),
    [allEvents]
  );

  const queueFiltered = queueOnly ? sorted.filter((e) => QaProfiles.computeQaInclusion(e, profile).included) : sorted;
  const idFiltered = finalIdFilter
    ? queueFiltered.filter((e) => M.resolveSpeciesRecords(e).some((r) => r.finalId === finalIdFilter))
    : queueFiltered;
  const list = unreviewedOnly ? idFiltered.filter((e) => !e.manualReview.reviewed) : idFiltered;

  const [currentId, setCurrentId] = useState(list[0] ? list[0].id : null);
  useEffect(() => {
    if (!list.find((e) => e.id === currentId) && list.length) setCurrentId(list[0].id);
  }, [list.length, unreviewedOnly, queueOnly, finalIdFilter]);

  const currentIndex = list.findIndex((e) => e.id === currentId);
  // Falls back to allEvents when currentId points at something outside the filtered list (e.g.
  // jumping to a sibling part via a sonogram marker while "QA queue only"/"Unreviewed only" would
  // otherwise have excluded it) - currentIndex stays -1 in that case, so Prev/Next below correctly
  // treat it as "not positioned in this list" rather than silently showing nothing.
  const currentEvent = currentIndex >= 0 ? list[currentIndex] : (allEvents.find((e) => e.id === currentId) || null);

  // BTO often splits one physical recording into several parts (e.g. a call bout that changes
  // species partway through) - all sharing the same original WAV. Since the sonogram always shows
  // the whole file, mark where each sibling part actually sits so it's clear which segment is
  // which, instead of silently displaying several species' calls with no indication of the split.
  // Markers are clickable so a species BTO missed in part 2/3 can be added without first having to
  // satisfy whatever QA filters are currently active for this list.
  const partMarkers = useMemo(() => {
    if (!currentEvent) return [];
    const siblings = allEvents
      .filter((e) => e.originalWav === currentEvent.originalWav)
      .map((e) => ({
        eventId: e.id, partNumber: e.partNumber, offsetSec: estimateOffsetSec(e),
        // Resolved label(s), not the raw BTO guess - a multi-species event should show every
        // species, not just the primary.
        label: formatResolvedLabel(e), isCurrent: e.id === currentEvent.id,
      }))
      .filter((m) => m.offsetSec != null)
      .sort((a, b) => a.offsetSec - b.offsetSec);
    // Stack labels that land at (almost) the same offset so they don't render on top of each
    // other illegibly.
    let stackIndex = 0, lastOffset = null;
    for (const m of siblings) {
      stackIndex = lastOffset != null && Math.abs(m.offsetSec - lastOffset) < 0.05 ? stackIndex + 1 : 0;
      m.stackIndex = stackIndex;
      lastOffset = m.offsetSec;
    }
    return siblings;
  }, [currentEvent, allEvents]);

  const wavCacheRef = useRef(new Map());
  const [decodedWav, setDecodedWav] = useState(null);
  const [wavStatus, setWavStatus] = useState('none'); // none | loading | ready | error | missing
  const [wavErrorMsg, setWavErrorMsg] = useState(null);

  useEffect(() => {
    if (!currentEvent) { setDecodedWav(null); setWavStatus('none'); return; }
    const file = wavFileMap.get(currentEvent.originalWav);
    if (!file) { setDecodedWav(null); setWavStatus('missing'); return; }
    const cache = wavCacheRef.current;
    // Keyed by name+size+lastModified, not just name - loading a *different* file that happens to
    // share a name (e.g. re-picking a corrected WAV folder mid-session) must not silently reuse a
    // stale decode cached under the old file of the same name.
    const cacheKey = `${currentEvent.originalWav}::${file.size}::${file.lastModified}`;
    if (cache.has(cacheKey)) {
      setDecodedWav(cache.get(cacheKey));
      setWavStatus('ready');
      return;
    }
    setWavStatus('loading');
    setDecodedWav(null);
    let cancelled = false;
    file.arrayBuffer()
      .then((buf) => {
        if (cancelled) return;
        const parsed = Wav.parseWav(buf); // throws on bad/unsupported WAV data - caught below
        cache.set(cacheKey, parsed);
        setDecodedWav(parsed);
        setWavStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        // Reading can fail (not just parsing) - e.g. a OneDrive "online-only" placeholder file
        // that hasn't actually been downloaded yet, or a permissions/IO error.
        setWavErrorMsg(e && e.message ? e.message : String(e));
        setWavStatus('error');
      });
    return () => { cancelled = true; };
  }, [currentEvent && currentEvent.id, wavFileMap]);

  const [fftSize, setFftSize] = useState(512);
  const spec = useMemo(() => (decodedWav ? Dsp.computeSpectrogram(decodedWav.samples, decodedWav.sampleRate, fftSize) : null), [decodedWav, fftSize]);

  const [floorDb, setFloorDb] = useState(-70);
  const [rangeDb, setRangeDb] = useState(50);
  const [saturation, setSaturation] = useState(0.85);
  const [guidelines, setGuidelines] = useState([40, 53]); // kHz reference lines, e.g. pipistrelle spp. split
  const [newGuideline, setNewGuideline] = useState('');

  const [box, setBox] = useState(null);
  const [shapeOverride, setShapeOverride] = useState(null);
  // Hand-entered measurements always win over the automated suggestion below - the automated
  // reading turned out too unreliable on real recordings to trust blindly (see dsp.js), so the
  // workflow is now "measure by hand, using the auto reading only as a rough starting point".
  // Stored in the same units as the automated fields (Hz/ms) and persisted onto the event's own
  // manualReview.sonogramAnalysis once a Final ID is set, so returning to a reviewed call restores
  // exactly what was measured rather than starting blank.
  const [overrides, setOverrides] = useState({});
  const [captureMode, setCaptureMode] = useState(null); // null | 'start-point' | 'end-point' | 'duration-line' | 'ipi-line'
  useEffect(() => {
    setBox(null);
    setCaptureMode(null);
    const saved = currentEvent && currentEvent.manualReview && currentEvent.manualReview.sonogramAnalysis;
    setOverrides(saved && saved.measurements ? { ...saved.measurements } : {});
    setShapeOverride(saved ? saved.shape : null);
  }, [currentEvent && currentEvent.id]);

  const measurement = useMemo(
    // floorDb (the "Brightness" slider) drives what counts as part of the call for start/end
    // frequency too, so raising Brightness to reveal a faint high-frequency onset also raises
    // what gets measured - no separate hidden threshold to fight against.
    () => (box && spec && decodedWav ? Dsp.measureBox(spec, decodedWav.samples, decodedWav.sampleRate, box, floorDb) : null),
    [box, spec, decodedWav, floorDb]
  );
  const shapeAuto = useMemo(() => (measurement ? Dsp.classifyShape(measurement.ridge) : null), [measurement]);
  const finalShape = shapeOverride || (shapeAuto && shapeAuto.shape) || null;

  // Effective value for each field: hand-entered override first, automated suggestion otherwise.
  const effective = {
    peakFreqHz: overrides.peakFreqHz != null ? overrides.peakFreqHz : (measurement ? measurement.peakFreqHz : null),
    startFreqHz: overrides.startFreqHz != null ? overrides.startFreqHz : (measurement ? measurement.startFreqHz : null),
    endFreqHz: overrides.endFreqHz != null ? overrides.endFreqHz : (measurement ? measurement.endFreqHz : null),
    durationMs: overrides.durationMs != null ? overrides.durationMs : (measurement ? measurement.durationMs : null),
    ipiMs: overrides.ipiMs != null ? overrides.ipiMs : null, // never automated - hand-measured only
  };
  function setOverrideKHz(field, kHz) {
    setOverrides((o) => ({ ...o, [field]: kHz == null ? null : kHz * 1000 }));
  }
  function setOverrideMs(field, ms) {
    setOverrides((o) => ({ ...o, [field]: ms }));
  }
  // Draw-line (Duration/IPI) and click-point (Start/End) capture from the sonogram - one-shot,
  // arming the tool again is a deliberate re-click so a stray drag afterwards can't overwrite it.
  function handleCapture(mode, value) {
    if (mode === 'duration-line') setOverrideMs('durationMs', +value.toFixed(2));
    else if (mode === 'ipi-line') setOverrideMs('ipiMs', +value.toFixed(2));
    else if (mode === 'start-point') setOverrideKHz('startFreqHz', +(value / 1000).toFixed(2));
    else if (mode === 'end-point') setOverrideKHz('endFreqHz', +(value / 1000).toFixed(2));
    setCaptureMode(null);
  }
  function toggleCapture(mode) {
    setCaptureMode((m) => (m === mode ? null : mode));
  }

  const speciesResults = useMemo(() => {
    if (effective.peakFreqHz == null && effective.startFreqHz == null && effective.endFreqHz == null && effective.durationMs == null) return [];
    return SpeciesData.scoreSpecies({
      peak: effective.peakFreqHz != null ? effective.peakFreqHz / 1000 : null,
      start: effective.startFreqHz != null ? effective.startFreqHz / 1000 : null,
      end: effective.endFreqHz != null ? effective.endFreqHz / 1000 : null,
      duration: effective.durationMs,
      ipi: effective.ipiMs,
    }, finalShape);
  }, [effective.peakFreqHz, effective.startFreqHz, effective.endFreqHz, effective.durationMs, effective.ipiMs, finalShape]);

  const speciesCounts = useMemo(() => computeSpeciesCounts(allEvents), [allEvents]);
  const btoQuickSpecies = Object.entries(speciesCounts).filter(([label]) => label !== 'Noise / No ID')
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label]) => label);
  // Custom labels (species BTO never flagged at all, e.g. "Myotis sp") persist project-wide and
  // always show up alongside the BTO-derived quick buttons, not just as a one-off text entry.
  const quickSpecies = Array.from(new Set([...btoQuickSpecies, ...(customLabels || [])]));

  function setFinalIdWithCustomTracking(label, isCustom) {
    if (isCustom) onAddCustomLabel(label);
    setFinalId(label);
  }

  function goTo(index) {
    if (index < 0 || index >= list.length) return;
    setCurrentId(list[index].id);
  }

  function setFinalId(label) {
    if (!currentEvent) return;
    const primaryLabel = currentEvent.primaryBtoId ? (currentEvent.primaryBtoId.englishName || currentEvent.primaryBtoId.species) : null;
    const previousFinalId = currentEvent.manualReview.finalId;
    const action = label === 'Noise / No ID' ? 'reject' : (label === primaryLabel ? 'accept' : 'modify');
    onPatchEvent(currentEvent.id, {
      manualReview: {
        ...currentEvent.manualReview, reviewed: true, finalId: label, reviewedAt: new Date().toISOString(),
        sonogramAnalysis: { measurements: effective, shape: finalShape },
        history: M.appendReviewHistory(currentEvent.manualReview, { action, previousFinalId, newFinalId: label }),
      },
    });
    goTo(currentIndex + 1);
  }

  // A second (or third...) species confirmed present in this SAME Detection Event - stays on the
  // one event as an extra Species Detection Record, rather than spawning a whole separate event.
  // Does not advance to the next call, since the analyst is still working on this one.
  function addAdditionalSpecies(label) {
    if (!currentEvent) return;
    const existing = currentEvent.manualReview.additionalTaxa || [];
    if (existing.includes(label) || label === currentEvent.manualReview.finalId) return;
    const next = [...existing, label];
    onPatchEvent(currentEvent.id, {
      manualReview: {
        ...currentEvent.manualReview, additionalTaxa: next,
        history: M.appendReviewHistory(currentEvent.manualReview, { action: 'add-additional', previousAdditionalTaxa: existing, newAdditionalTaxa: next }),
      },
    });
  }
  function removeAdditionalTaxon(label) {
    if (!currentEvent) return;
    const existing = currentEvent.manualReview.additionalTaxa || [];
    const next = existing.filter((t) => t !== label);
    onPatchEvent(currentEvent.id, {
      manualReview: {
        ...currentEvent.manualReview, additionalTaxa: next,
        history: M.appendReviewHistory(currentEvent.manualReview, { action: 'remove-additional', previousAdditionalTaxa: existing, newAdditionalTaxa: next }),
      },
    });
  }

  const toolbar = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 } },
    h(WavFolderPicker, { wavFileMap, setWavFileMap }),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('label', { style: { fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
        'Sort',
        h('select', {
          value: sortMode, onChange: (e) => setSortMode(e.target.value),
          style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 12 },
        },
          h('option', { value: 'primaryId' }, 'Primary ID'),
          h('option', { value: 'finalId' }, 'Final ID'),
          h('option', { value: 'chronological' }, 'Chronological')
        )
      ),
      h('label', { style: { fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }, title: 'Narrow the list to just one resolved Final ID - e.g. to review every call currently labelled the same species together.' },
        'Final ID',
        h('select', {
          value: finalIdFilter, onChange: (e) => setFinalIdFilter(e.target.value),
          style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', fontSize: 12, maxWidth: 160 },
        },
          h('option', { value: '' }, 'All'),
          finalIdOptions.map((id) => h('option', { key: id, value: id }, id))
        )
      ),
      h('label', { style: { fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
        h('input', { type: 'checkbox', checked: queueOnly, onChange: (e) => setQueueOnly(e.target.checked) }),
        'QA queue only'
      ),
      h('label', { style: { fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
        h('input', { type: 'checkbox', checked: unreviewedOnly, onChange: (e) => setUnreviewedOnly(e.target.checked) }),
        'Unreviewed only'
      ),
      list.length > 0 && h(React.Fragment, null,
        h('button', { className: 'btn btn-secondary btn-small', onClick: () => goTo(currentIndex - 1), disabled: currentIndex <= 0 }, '← Prev'),
        h('span', { className: 'card-sub', style: { fontFamily: 'var(--font-mono)' }, title: currentIndex < 0 ? "Viewing a call outside the current filters (e.g. a sibling part) - Prev/Next are disabled until you pick one from this list." : undefined },
          currentIndex >= 0 ? `${currentIndex + 1} / ${list.length}` : `- / ${list.length}`),
        h('button', { className: 'btn btn-secondary btn-small', onClick: () => goTo(currentIndex + 1), disabled: currentIndex < 0 || currentIndex >= list.length - 1 }, 'Next →')
      )
    )
  );

  if (list.length === 0) {
    return h('div', { className: 'content', style: { maxWidth: 'none' } },
      toolbar,
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No detection events to review'),
        h('div', { className: 'empty-text' },
          allEvents.length === 0
            ? 'Import a BTO CSV on the Detections tab first.'
            : queueOnly
              ? "Nothing matches the current QA rules (or everything's already reviewed). Adjust the sample %/threshold on the QA tab, or untick \"QA queue only\" to browse every call."
              : 'Nothing matches the current filters.')
      )
    );
  }

  return h('div', { className: 'content', style: { maxWidth: 'none' } },
    toolbar,

    currentEvent && h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: 16 } },
      // Left: sonogram + controls (the primary evidence)
      h('div', null,
        h('div', { className: 'card-sub', style: { marginBottom: 8 } },
          `${currentEvent.originalWav} · part ${currentEvent.partNumber} · ${currentEvent.surveyDate || '?'} ${currentEvent.time || ''}`
        ),
        wavStatus === 'missing' && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--text-muted)' } },
          `No matching WAV loaded for "${currentEvent.originalWav}". Load the WAV folder above to view its sonogram - you can still label from the BTO data alone.`),
        wavStatus === 'error' && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--danger)' } },
          `Could not read this WAV file: ${wavErrorMsg || 'unknown error'}. If it's stored in OneDrive with "Files On-Demand", it may need to be downloaded to your device first (right-click the file/folder → "Always keep on this device").`),
        wavStatus === 'loading' && h('div', { className: 'card-sub', style: { marginBottom: 12 } }, 'Loading audio...'),
        wavStatus === 'ready' && spec && h(React.Fragment, null,
          h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 12 } },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, 'FFT size',
              h('select', { value: fftSize, onChange: (e) => setFftSize(Number(e.target.value)), style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px' } },
                Dsp.FFT_SIZES.map((s) => h('option', { key: s, value: s }, s)))),
            h('label', {
              style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 },
              title: 'Also sets what counts as part of the call for Max/Min/Start/End frequency - raise this until the quietest parts of the call are visible before measuring.',
            }, 'Brightness',
              h('input', { type: 'range', min: -100, max: -20, value: floorDb, onChange: (e) => setFloorDb(Number(e.target.value)), style: { flex: 1 } })),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 } }, 'Contrast',
              h('input', { type: 'range', min: 10, max: 100, value: rangeDb, onChange: (e) => setRangeDb(Number(e.target.value)), style: { flex: 1 } })),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 } }, 'Saturation',
              h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: saturation, onChange: (e) => setSaturation(Number(e.target.value)), style: { flex: 1 } }))
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
            h('span', { style: { fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' } }, 'Guidelines (kHz):'),
            guidelines.map((kHz) => h('span', {
              key: kHz, className: 'pill', style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px' },
            }, `${kHz}k`, h('button', {
              onClick: () => setGuidelines(guidelines.filter((g) => g !== kHz)),
              style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 },
            }, '×'))),
            h('input', {
              value: newGuideline, placeholder: 'e.g. 45', style: { width: 60, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '3px 6px', fontSize: 12 },
              onChange: (e) => setNewGuideline(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') {
                  const v = Number(newGuideline);
                  if (v > 0 && !guidelines.includes(v)) setGuidelines([...guidelines, v].sort((a, b) => a - b));
                  setNewGuideline('');
                }
              },
            })
          ),
          h(Sonogram, {
            spec, samples: decodedWav.samples, sampleRate: decodedWav.sampleRate, floorDb, rangeDb, saturation, box, onBoxChange: setBox,
            guidelines, partMarkers, onSelectPart: (eventId) => setCurrentId(eventId), captureMode, onCapture: handleCapture,
            // Decorations reflect the effective (possibly hand-overridden) Start/End, not the raw
            // automated reading - what's drawn on the sonogram should always match the input fields.
            measurement: measurement && { ...measurement, startFreqHz: effective.startFreqHz, endFreqHz: effective.endFreqHz },
          }),
          h('div', { className: 'card-sub', style: { marginTop: 6 } },
            captureMode
              ? ({
                  'duration-line': '📏 Drag across the call to measure Duration.',
                  'ipi-line': '📏 Drag from one pulse to the next to measure the interpulse interval.',
                  'start-point': '🎯 Click the top/start of the call to read Start Freq.',
                  'end-point': '🎯 Click the bottom/end of the call to read End Freq.',
                }[captureMode])
              : 'Drag to box a call (for the automated suggestion below) - scroll to zoom the time axis.'),
          spec.truncated && h('div', { className: 'card-sub', style: { marginTop: 4, color: 'var(--accent)' } },
            `This recording is longer than ${Dsp.MAX_ANALYSIS_DURATION_SEC || 30}s - showing the first ${Math.round(spec.durationSec)}s only.`),
          h(AudioPlayback, { samples: decodedWav.samples, sampleRate: decodedWav.sampleRate, box }),
          measurement && h(PowerSpectrumChart, { powerSpectrum: measurement.powerSpectrum, onPickFreq: (hz) => setOverrideKHz('peakFreqHz', +(hz / 1000).toFixed(2)) })
        ),

        h('div', { className: 'card', style: { marginTop: 14, padding: 12 } },
          h('div', { className: 'card-sub', style: { marginBottom: 8 } },
            'Hand-measured values always win over the automated suggestion (shown until you enter your own). Use the 🎯/📏 tools to read straight off the sonogram.'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' } },
            h(MeasureField, {
              label: 'Peak freq', unit: 'kHz', value: effective.peakFreqHz != null ? +(effective.peakFreqHz / 1000).toFixed(2) : null,
              onChange: (v) => setOverrideKHz('peakFreqHz', v),
            }),
            h(MeasureField, {
              label: 'Start freq', unit: 'kHz', value: effective.startFreqHz != null ? +(effective.startFreqHz / 1000).toFixed(2) : null,
              onChange: (v) => setOverrideKHz('startFreqHz', v),
              tool: { icon: '🎯', title: 'Click point: click the sonogram at the start of the call' }, active: captureMode === 'start-point', onToggleTool: () => toggleCapture('start-point'),
            }),
            h(MeasureField, {
              label: 'End freq', unit: 'kHz', value: effective.endFreqHz != null ? +(effective.endFreqHz / 1000).toFixed(2) : null,
              onChange: (v) => setOverrideKHz('endFreqHz', v),
              tool: { icon: '🎯', title: 'Click point: click the sonogram at the end of the call' }, active: captureMode === 'end-point', onToggleTool: () => toggleCapture('end-point'),
            }),
            h(MeasureField, {
              label: 'Duration', unit: 'ms', value: effective.durationMs != null ? +effective.durationMs.toFixed(2) : null,
              onChange: (v) => setOverrideMs('durationMs', v),
              tool: { icon: '📏', title: 'Draw line: drag across the call on the sonogram' }, active: captureMode === 'duration-line', onToggleTool: () => toggleCapture('duration-line'),
            }),
            h(MeasureField, {
              label: 'IPI', unit: 'ms', value: effective.ipiMs != null ? +effective.ipiMs.toFixed(2) : null,
              onChange: (v) => setOverrideMs('ipiMs', v),
              tool: { icon: '📏', title: 'Draw line: drag from one pulse to the next' }, active: captureMode === 'ipi-line', onToggleTool: () => toggleCapture('ipi-line'),
            }),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h('label', { style: { fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase' } }, 'Shape'),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('select', {
                  value: finalShape || '', onChange: (e) => setShapeOverride(e.target.value),
                  style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 6px', fontSize: 13 },
                }, SpeciesData.SHAPE_LABELS.map((s) => h('option', { key: s, value: s }, s))),
                shapeAuto && !shapeOverride && h('span', { className: 'pill' }, `auto (${Math.round(shapeAuto.confidence * 100)}%)`)
              )
            )
          )
        )
      ),

      // Right: identification panel, next to the sonogram - old ID, decision tree, quick labels,
      // custom label. Kept here (not the left column) so it's visible without scrolling.
      h('div', null,
        h('div', { className: 'card' },
          h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } }, 'Old ID (BTO)'),
          currentEvent.primaryBtoId
            ? h('div', null,
                h('div', null, `${currentEvent.primaryBtoId.englishName || currentEvent.primaryBtoId.species} - ${currentEvent.primaryBtoId.probability != null ? (currentEvent.primaryBtoId.probability * 100).toFixed(0) + '%' : ''}`),
                currentEvent.primaryBtoId.warnings && h('div', { className: 'card-sub' }, currentEvent.primaryBtoId.warnings),
                currentEvent.candidateSpecies.length > 1 && h('div', { className: 'card-sub', style: { marginTop: 6 } },
                  'Other candidates: ' + currentEvent.candidateSpecies.filter((c) => c !== currentEvent.primaryBtoId)
                    .map((c) => `${c.englishName || c.species} (${c.probability != null ? (c.probability * 100).toFixed(0) + '%' : '?'})`).join(', '))
              )
            : h('div', { className: 'card-sub' }, 'No ID (BTO could not classify this segment)'),
          currentEvent.manualReview.reviewed && h('div', { style: { marginTop: 8, color: 'var(--teal)', fontSize: 13 } }, `New ID: ${currentEvent.manualReview.finalId} (reviewed)`),
          (currentEvent.manualReview.additionalTaxa || []).length > 0 && h('div', { style: { marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 } },
            currentEvent.manualReview.additionalTaxa.map((taxon) => h('span', {
              key: taxon, className: 'pill', style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', color: 'var(--teal)' },
            }, `+ ${taxon}`, h('button', {
              onClick: () => removeAdditionalTaxon(taxon),
              style: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 },
            }, '×')))
          ),
          h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' } },
            h('div', { className: 'card-sub', style: { marginBottom: 4 } },
              'This same call also contains another species (a mixed recording BTO only gave one result for)? Add it here - it stays part of this same Detection Event, not a separate one:'),
            h(AddMissedSpeciesInput, {
              onAdd: addAdditionalSpecies, buttonLabel: '+ Add to this event',
              placeholder: 'Other species in this same call...',
            })
          )
        ),

        speciesResults.length > 0 && h('div', { className: 'card', style: { marginTop: 14, padding: 0, overflow: 'hidden' } },
          h('div', { style: { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 12 } }, 'Decision-tree candidates (weighted: shape & peak > duration > start/end)'),
          h('div', { style: { overflowX: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
              h('thead', null, h('tr', null,
                ['Species', 'Score', 'Shape', 'Peak', 'Dur.', 'IPI', 'Start', 'End'].map((c) => h('th', { key: c, style: { textAlign: 'left', padding: '4px 8px', color: 'var(--text-faint)', fontSize: 9, textTransform: 'uppercase', whiteSpace: 'nowrap' } }, c))
              )),
              h('tbody', null, speciesResults.slice(0, 6).map((res) => h('tr', { key: res.species.name },
                h('td', { style: { padding: '4px 8px', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' } }, res.species.name),
                h('td', { style: { padding: '4px 8px', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, `${Math.round(res.score * 100)}%`),
                ...['shape', 'peak', 'duration', 'ipi', 'start', 'end'].map((k) => h('td', {
                  key: k, style: { padding: '4px 8px', borderTop: '1px solid var(--border)', color: res.checks[k] === true ? 'var(--teal)' : res.checks[k] === false ? 'var(--danger)' : 'var(--text-faint)' },
                }, res.checks[k] === true ? '✓' : res.checks[k] === false ? '✗' : '-'))
              )))
            )
          )
        ),

        h('div', { style: { marginTop: 14 } },
          h('div', { className: 'card-sub', style: { marginBottom: 8 } }, 'Quick label (sets Final ID and moves to the next call):'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            quickSpecies.map((label) => h('button', { key: label, className: 'btn btn-secondary btn-small', onClick: () => setFinalId(label) }, label)),
            h('button', { className: 'btn btn-secondary btn-small', onClick: () => setFinalId('Bat (unidentified)') }, 'Bat (unidentified)'),
            h('button', { className: 'btn btn-danger btn-small', onClick: () => setFinalId('Noise / No ID') }, 'Noise / No ID')
          ),
          h(CustomLabelInput, { onSubmit: (label) => setFinalIdWithCustomTracking(label, true) })
        )
      )
    ),

    // Detection attributes - metadata, de-prioritized below the evidence/ID panels.
    currentEvent && h('div', { className: 'card', style: { marginTop: 16 } },
      h('div', { style: { fontWeight: 600, marginBottom: 10 } }, 'Detection attributes'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 24px' } },
        h(AttrRow, { label: 'Original WAV', value: currentEvent.originalWav }),
        h(AttrRow, { label: 'Part', value: currentEvent.partNumber }),
        h(AttrRow, { label: 'Survey date', value: currentEvent.surveyDate }),
        h(AttrRow, { label: 'Time', value: currentEvent.time }),
        h(AttrRow, { label: 'Location', value: currentEvent.latitude != null ? `${currentEvent.latitude}, ${currentEvent.longitude}` : '-' }),
        h(AttrRow, { label: 'Candidates', value: String(currentEvent.candidateSpecies.length) }),
        h(AttrRow, { label: 'QA status', value: QA_REASON_LABELS[QaProfiles.computeQaInclusion(currentEvent, profile).reason] })
      )
    ),

    h(EventsTable, { list, currentId, onSelect: setCurrentId })
  );
}

function AttrRow({ label, value }) {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 } },
    h('span', { style: { color: 'var(--text-faint)' } }, label),
    h('span', { style: { fontFamily: 'var(--font-mono)', textAlign: 'right' } }, value)
  );
}

const TABLE_WINDOW_RADIUS = 60;

function EventsTable({ list, currentId, onSelect }) {
  const rowRef = useRef(null);
  const containerRef = useRef(null);
  const currentIndex = list.findIndex((e) => e.id === currentId);
  const from = Math.max(0, currentIndex - TABLE_WINDOW_RADIUS);
  const to = Math.min(list.length, currentIndex + TABLE_WINDOW_RADIUS + 1);
  const windowRows = list.slice(from, to);

  // Scroll only the table's own scroll container to reveal the current row - never the page.
  // (Element.scrollIntoView() walks every scrollable ancestor, including the page itself, which
  // was yanking the sonogram out of view every time the selection changed.)
  useEffect(() => {
    const row = rowRef.current, container = containerRef.current;
    if (!row || !container) return;
    const rowRect = row.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const rowTop = rowRect.top - containerRect.top + container.scrollTop;
    const rowBottom = rowTop + rowRect.height;
    if (rowTop < container.scrollTop) container.scrollTop = rowTop;
    else if (rowBottom > container.scrollTop + container.clientHeight) container.scrollTop = rowBottom - container.clientHeight;
  }, [currentId]);

  return h('div', { style: { marginTop: 18 } },
    h('div', { className: 'section-title' }, `Calls list (showing ${from + 1}-${to} of ${list.length})`),
    h('div', { ref: containerRef, className: 'card', style: { padding: 0, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
        h('thead', null, h('tr', null,
          ['WAV', 'Part', 'Time', 'Primary ID', 'Prob.', 'Final ID', 'Reviewed'].map((c) => h('th', {
            key: c, style: { position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
          }, c))
        )),
        h('tbody', null, windowRows.map((ev) => {
          const isCurrent = ev.id === currentId;
          return h('tr', {
            key: ev.id, ref: isCurrent ? rowRef : null, onClick: () => onSelect(ev.id),
            style: { cursor: 'pointer', background: isCurrent ? 'var(--accent-dim)' : 'transparent' },
          },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.originalWav),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.partNumber),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.time),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } },
              ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.primaryBtoId && ev.primaryBtoId.probability != null ? ev.primaryBtoId.probability.toFixed(2) : ''),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--teal)' } }, ev.manualReview.finalId ? formatResolvedLabel(ev) : ''),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.manualReview.reviewed ? '✓' : '')
          );
        }))
      )
    )
  );
}

// ---------------- Root ----------------

function App() {
  const [projects, setProjects] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [openProject, setOpenProject] = useState(null);
  const saveTimer = useRef(null);

  function loadProjectList() {
    setLoadError(null);
    S.migrateFromOldDbOnce().then(() => S.listProjects()).then((list) => {
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      setProjects(list);
    }).catch((e) => {
      setLoadError(e && e.message ? e.message : String(e));
    });
  }

  useEffect(() => { loadProjectList(); }, []);

  function openProjectById(id) {
    S.loadProject(id).then((p) => { setOpenProject(p); });
  }

  function backToProjects() {
    setOpenProject(null);
    loadProjectList();
  }

  function createProject(fields) {
    const project = M.createProject(fields);
    S.saveProject(project).then(() => openProjectById(project.id));
  }

  function importProjectFromJson(jsonString) {
    const project = S.importProjectJson(jsonString, { asCopy: false }); // throws on bad JSON - caller displays it
    S.saveProject(project).then(() => openProjectById(project.id));
  }

  // Opens a project that lives as project.json in a folder someone shared with Clara (or that she
  // linked earlier on another machine) - reads it in, links the folder so future edits keep
  // writing back to it, and adds it to this browser's project list.
  async function openProjectFromFolder() {
    const handle = await S.pickProjectFolder(); // throws AbortError if cancelled - caller displays it
    const project = await S.readProjectJsonFromFolder(handle); // throws if no project.json in there
    await S.saveFolderHandle(project.id, handle);
    await S.saveProject(project);
    openProjectById(project.id);
  }

  function deleteProject(id) {
    S.deleteProject(id).then(() => {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    });
  }

  function onChangeProject(next) {
    setOpenProject(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { S.saveProject(next); }, 400);
  }

  if (loadError) {
    return h('div', { className: 'content', style: { maxWidth: 560, margin: '60px auto' } },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'Could not open the local database'),
        h('div', { className: 'empty-text' }, loadError),
        h('button', { className: 'btn btn-primary', style: { marginTop: 16 }, onClick: loadProjectList }, 'Try again')
      )
    );
  }

  if (projects === null) {
    return h('div', { className: 'content' }, 'Loading…');
  }

  if (!openProject) {
    return h(ProjectsListView, {
      projects,
      onOpen: openProjectById,
      onCreate: createProject,
      onImport: importProjectFromJson,
      onOpenFromFolder: S.supportsFolderStorage ? openProjectFromFolder : null,
      onDelete: deleteProject,
    });
  }

  return h(Workspace, {
    project: openProject,
    onChange: onChangeProject,
    onBackToProjects: backToProjects,
    onExport: () => S.downloadProjectJson(openProject),
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
