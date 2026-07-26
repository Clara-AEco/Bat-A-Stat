const { useState, useEffect, useRef, useMemo } = React;
const h = React.createElement;
const M = window.BatID.Models;
const S = window.BatID.Storage;
const Bto = window.BatID.Bto;
const Wav = window.BatID.Wav;
const Dsp = window.BatID.Dsp;
const SpeciesData = window.BatID.SpeciesData;
const QaProfiles = window.BatID.QaProfiles;
const Sun = window.BatID.Sun;
const Stats = window.BatID.Stats;

const DEPLOYMENT_TABS = [
  { id: 'overview', label: 'Overview', phase: 1 },
  { id: 'detections', label: 'Detections', phase: 2 },
  { id: 'qa', label: 'QA', phase: 4 },
  { id: 'review', label: 'Manual Review', phase: 3 },
  { id: 'stats', label: 'Statistics', phase: 5 },
  { id: 'figures', label: 'Figures', phase: 6 },
  { id: 'comparisons', label: 'Comparisons', phase: 7 },
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
      className: 'tree-node tree-node-location' + (selection.locationId === loc.id && !selection.deploymentId ? ' tree-node-active' : ''),
      onClick: () => { setSelection({ locationId: loc.id, deploymentId: null }); setActiveTab('overview'); },
    },
      h('span', { style: { flex: 1 } }, loc.name || '(untitled location)'),
      h('span', { className: 'badge-count' }, String((loc.deployments || []).length))
    ));
    (loc.deployments || []).forEach((dep) => {
      treeChildren.push(h('div', {
        key: dep.id,
        className: 'tree-node tree-indent' + (selection.deploymentId === dep.id ? ' tree-node-active' : ''),
        onClick: () => { setSelection({ locationId: loc.id, deploymentId: dep.id }); setActiveTab('overview'); },
      }, dep.name || '(untitled deployment)'));
    });
    treeChildren.push(h('button', {
      key: loc.id + '-add', className: 'tree-add-btn tree-indent',
      onClick: () => setModal({ kind: 'newDeployment', locationId: loc.id }),
    }, '+ Add deployment'));
  });

  let mainContent;
  if (!selectedLocation) {
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
      )
    )
  );
}

function DeploymentPanel({ location, deployment, activeTab, setActiveTab, onPatch, onDelete, onImportBto, onPatchEvent, customLabels, onAddCustomLabel }) {
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
  } else if (activeTab === 'stats') {
    tabContent = h(StatisticsTab, { deployment, location });
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
      else setImportMsg({ ok: true, text: `Imported ${file.name}: ${result.rowCount} rows -> ${result.eventCount} detection events.` });
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
            h('div', { className: 'card-sub' }, `${imp.rowCount} rows -> ${imp.eventCount} detection events · imported ${new Date(imp.importedAt).toLocaleString()}`)
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

function StatisticsTab({ deployment, location }) {
  const stats = useMemo(() => Stats.computeAllStats(deployment, location), [deployment, location]);
  const { effort, activity, species, timing, reliability, totalDetectionEvents, totalSpeciesRecords } = stats;

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
      "Based on manually reviewed calls that had a BTO primary result to check against. Describes what was observed under this deployment's own recording conditions, not a general BTO accuracy figure - and does not yet include confidence intervals or a small-sample fallback (that's follow-on work)."),
    reliability.reviewedSampleSize === 0
      ? h('div', { className: 'card-sub' }, 'No reviewed calls with a BTO primary result yet - reliability will appear here once some QA has been done.')
      : h('div', { className: 'stat-grid' },
          h(StatBox, { label: 'Primary-ID reliability', value: fmtNum(reliability.primaryIdReliabilityPct) + '%' }),
          h(StatBox, { label: 'Complete-event reliability', value: fmtNum(reliability.completeEventReliabilityPct) + '%' }),
          h(StatBox, { label: 'Additional-species rate', value: fmtNum(reliability.additionalSpeciesRatePct) + '%' }),
          h(StatBox, { label: 'Reviewed sample (n)', value: reliability.reviewedSampleSize })
        ),

    h('div', { className: 'section-title' }, 'Survey effort'),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Nights (entered)', value: effort.nights ?? '-' }),
      h(StatBox, { label: 'Nights in data', value: effort.nightsInData }),
      h(StatBox, { label: 'Valid recording hours', value: effort.validRecordingHours ?? '-' }),
      h(StatBox, { label: 'QA completion % (computed)', value: fmtNum(effort.qaCompletionPct) + '%' })
    ),
    effort.nights != null && effort.nights !== effort.nightsInData && h('div', { className: 'card-sub', style: { marginTop: 8 } },
      `Note: ${effort.nightsInData} distinct survey night(s) appear in the data, vs ${effort.nights} entered on the Overview tab - detections-per-night below uses the entered figure.`),

    h('div', { className: 'section-title' }, 'Activity'),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Total detections', value: activity.totalDetections }),
      h(StatBox, { label: 'Per night', value: fmtNum(activity.detectionsPerNight) }),
      h(StatBox, { label: 'Per hour', value: fmtNum(activity.detectionsPerHour) }),
      h(StatBox, { label: 'Nightly mean', value: fmtNum(activity.nightlyMean) }),
      h(StatBox, { label: 'Nightly median', value: fmtNum(activity.nightlyMedian) }),
      h(StatBox, { label: 'Nightly min/max', value: activity.nightlyMin != null ? `${activity.nightlyMin} / ${activity.nightlyMax}` : '-' }),
      h(StatBox, { label: 'Nightly SD', value: fmtNum(activity.nightlySd) }),
      h(StatBox, { label: 'Nightly CV', value: fmtNum(activity.nightlyCv, 2) })
    ),

    h('div', { className: 'section-title' }, 'Species'),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'Richness', value: species.richness }),
      h(StatBox, { label: 'Dominant species', value: species.dominantSpecies ? species.dominantSpecies.species : '-' }),
      h(StatBox, { label: 'Dominant %', value: species.dominantSpecies ? fmtNum(species.dominantSpecies.pct) + '%' : '-' })
    ),
    species.composition.length > 0 && h('div', { className: 'card', style: { marginTop: 12, padding: 0, overflow: 'hidden' } },
      h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            ['Species', 'Count', '% of total', 'Active nights', 'Detection freq.'].map((c) => h('th', {
              key: c, style: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' },
            }, c))
          )),
          h('tbody', null, species.composition.map((s) => h('tr', { key: s.species },
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, s.species),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.count),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, fmtNum(s.pct) + '%'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.activeNights),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, s.detectionFrequencyPct != null ? fmtNum(s.detectionFrequencyPct) + '%' : '-')
          )))
        )
      )
    ),

    h('div', { className: 'section-title' }, 'Timing'),
    h('div', { className: 'card-sub', style: { marginBottom: 8 } },
      timing.sunsetRelative
        ? "Times below are hours relative to sunset (negative = before sunset) - uses this Location's coordinates."
        : "Times below are raw clock time - set this Location's Latitude/Longitude (on its Details tab) to switch to sunset-relative timing."),
    h('div', { className: 'stat-grid' },
      h(StatBox, { label: 'First detection', value: fmtDateTime(timing.firstDetection) }),
      h(StatBox, { label: 'Last detection', value: fmtDateTime(timing.lastDetection) }),
      h(StatBox, { label: timing.sunsetRelative ? 'Median (rel. sunset)' : 'Median hour', value: timing.sunsetRelative ? fmtHour(timing.medianHour) : fmtNum(timing.medianHour) }),
      h(StatBox, {
        label: 'Peak 30-min window',
        value: timing.peakHalfHour ? `${timing.sunsetRelative ? fmtHour(timing.peakHalfHour.startHour) : fmtNum(timing.peakHalfHour.startHour)} (${timing.peakHalfHour.count})` : '-',
      }),
      h(StatBox, {
        label: 'Peak rolling hour',
        value: timing.peakRollingHour ? `${timing.sunsetRelative ? fmtHour(timing.peakRollingHour.startHour) : fmtNum(timing.peakRollingHour.startHour)} (${timing.peakRollingHour.count})` : '-',
      })
    ),
    Object.keys(timing.percentiles || {}).length > 0 && h('div', { style: { marginTop: 12 } },
      h('div', { className: 'card-sub', style: { marginBottom: 6 } }, 'Cumulative activity percentiles:'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 12, fontFamily: 'var(--font-mono)' } },
        [10, 25, 50, 75, 90].map((p) => h('span', { key: p }, `${p}%: ${timing.sunsetRelative ? fmtHour(timing.percentiles[p]) : fmtNum(timing.percentiles[p])}`))
      )
    )
  );
}

function DeploymentOverviewTab({ deployment, onPatch, wavFileMap, location }) {
  const effort = deployment.surveyEffort || {};
  function patchEffort(patch) {
    onPatch({ surveyEffort: { ...effort, ...patch } });
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

    h('div', { className: 'section-title' }, 'Detection Events'),
    h('div', { className: 'stat-grid' },
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Total'), h('div', { className: 'stat-box-value' }, String((deployment.detectionEvents || []).length))),
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'BTO imports'), h('div', { className: 'stat-box-value' }, String((deployment.btoImports || []).length))),
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Manually added'), h('div', { className: 'stat-box-value' }, String(events.filter((e) => e.addedManually).length)))
    ),
    (deployment.detectionEvents || []).length === 0 && h('div', { className: 'card-sub', style: { marginTop: 10 } }, 'Import a BTO CSV on the Detections tab to get started.')
  );
}

// ---------------- QA (review-queue rules, drives Manual Review) ----------------

function StatBox({ label, value }) {
  return h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, label), h('div', { className: 'stat-box-value' }, String(value)));
}

function QaTab({ deployment, onPatch, wavFileMap, setWavFileMap, onGoToReview }) {
  const events = deployment.detectionEvents || [];
  const profile = deployment.qaProfile || DEFAULT_QA_PROFILE;
  function patchProfile(patch) {
    onPatch({ qaProfile: { ...profile, ...patch } });
  }

  const summary = useMemo(() => QaProfiles.computeQaSummary(events, profile), [events, profile]);
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
          const color = m.addedManually ? 'var(--accent)' : m.isCurrent ? 'var(--teal)' : 'rgba(255,255,255,0.4)';
          const text = `${m.addedManually ? '+ added: ' : `part ${m.partNumber}: `}${m.label}`;
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

const DEFAULT_QA_PROFILE = {
  samplePercent: 10, probabilityThreshold: 50,
  speciesThresholds: [{ species: 'Common Pipistrelle', threshold: 60 }, { species: 'Soprano Pipistrelle', threshold: 60 }],
  speciesRequiring100Percent: [], alwaysReviewNoId: true,
};
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
        // Resolved label(s), not the raw BTO guess - a manually-added event has no BTO candidate
        // at all, so primaryIdLabel would always show "No ID" for it even once labelled, and a
        // multi-species event should show every species, not just the primary.
        label: formatResolvedLabel(e), isCurrent: e.id === currentEvent.id, addedManually: !!e.addedManually,
      }))
      .filter((m) => m.offsetSec != null)
      .sort((a, b) => a.offsetSec - b.offsetSec);
    // Stack labels that land at (almost) the same offset - typically a manually-added event
    // sharing its source event's time - so they don't render on top of each other illegibly.
    let stackIndex = 0, lastOffset = null;
    for (const m of siblings) {
      stackIndex = lastOffset != null && Math.abs(m.offsetSec - lastOffset) < 0.05 ? stackIndex + 1 : 0;
      m.stackIndex = stackIndex;
      lastOffset = m.offsetSec;
    }
    return siblings;
  }, [currentEvent, allEvents]);

  const deploymentAddedCount = useMemo(() => allEvents.filter((e) => e.addedManually).length, [allEvents]);
  const fileAddedCount = currentEvent
    ? allEvents.filter((e) => e.addedManually && e.originalWav === currentEvent.originalWav).length
    : 0;

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
    onPatchEvent(currentEvent.id, {
      manualReview: {
        ...currentEvent.manualReview, reviewed: true, finalId: label, reviewedAt: new Date().toISOString(),
        sonogramAnalysis: { measurements: effective, shape: finalShape },
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
    onPatchEvent(currentEvent.id, {
      manualReview: { ...currentEvent.manualReview, additionalTaxa: [...existing, label] },
    });
  }
  function removeAdditionalTaxon(label) {
    if (!currentEvent) return;
    onPatchEvent(currentEvent.id, {
      manualReview: { ...currentEvent.manualReview, additionalTaxa: (currentEvent.manualReview.additionalTaxa || []).filter((t) => t !== label) },
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
            }),
            fileAddedCount > 0 && h('div', { className: 'card-sub', style: { marginTop: 6, color: 'var(--text-faint)' } },
              `Also: ${fileAddedCount} species added as separate Detection Events in this file under the older pattern (${deploymentAddedCount} total in this deployment) - still counted, but no longer how new ones are added.`)
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
              ev.addedManually
                ? h('span', { style: { color: 'var(--accent)' }, title: 'Added manually - BTO never gave this call a candidate row at all' }, '+ manually added')
                : (ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID')),
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
