const { useState, useEffect, useRef, useMemo } = React;
const h = React.createElement;
const M = window.BatID.Models;
const S = window.BatID.Storage;
const Bto = window.BatID.Bto;
const Wav = window.BatID.Wav;
const Dsp = window.BatID.Dsp;
const SpeciesData = window.BatID.SpeciesData;

const DEPLOYMENT_TABS = [
  { id: 'overview', label: 'Overview', phase: 1 },
  { id: 'detections', label: 'Detections', phase: 2 },
  { id: 'review', label: 'Manual Review', phase: 3 },
  { id: 'qa', label: 'QA', phase: 4 },
  { id: 'stats', label: 'Statistics', phase: 5 },
  { id: 'figures', label: 'Figures', phase: 6 },
  { id: 'comparisons', label: 'Comparisons', phase: 7 },
  { id: 'reports', label: 'Reports', phase: 8 },
];

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

function ProjectsListView({ projects, onOpen, onCreate, onImport, onDelete }) {
  const [showNew, setShowNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // project id awaiting confirmation
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  return h('div', { className: 'content', style: { maxWidth: 720, margin: '0 auto' } },
    h('div', { className: 'section-title', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Projects'),
      h('div', { style: { display: 'flex', gap: 8 } },
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
    importError && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--danger)' } }, `Could not import that file: ${importError}`),
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

function Workspace({ project, onChange, onBackToProjects, onExport }) {
  const [selection, setSelection] = useState({ locationId: null, deploymentId: null });
  const [activeTab, setActiveTab] = useState('overview');
  const [modal, setModal] = useState(null);

  const selectedLocation = selection.locationId ? M.findLocation(project, selection.locationId) : null;
  const selectedDeployment = selection.deploymentId
    ? (M.findDeployment(project, selection.deploymentId) || {}).deployment
    : null;

  function updateProject(mutator) {
    const next = structuredClone(project);
    mutator(next);
    onChange(next);
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

function DeploymentPanel({ location, deployment, activeTab, setActiveTab, onPatch, onDelete, onImportBto, onPatchEvent }) {
  const [wavFileMap, setWavFileMap] = useState(new Map());
  let tabContent;
  if (activeTab === 'overview') {
    tabContent = h(DeploymentOverviewTab, { deployment, onPatch });
  } else if (activeTab === 'detections') {
    tabContent = h(DetectionsTab, { deployment, onImportBto });
  } else if (activeTab === 'review') {
    tabContent = h(ReviewTab, { deployment, onPatchEvent, wavFileMap, setWavFileMap });
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
    tabContent
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

function DeploymentOverviewTab({ deployment, onPatch }) {
  const effort = deployment.surveyEffort || {};
  function patchEffort(patch) {
    onPatch({ surveyEffort: { ...effort, ...patch } });
  }
  return h('div', { className: 'content' },
    h('div', { className: 'section-title' }, 'Details'),
    h(Field, { label: 'Name' }, h('input', { value: deployment.name, onChange: (e) => onPatch({ name: e.target.value }) })),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Start date' }, h('input', { type: 'date', value: deployment.startDate, onChange: (e) => onPatch({ startDate: e.target.value }) })),
      h(Field, { label: 'End date' }, h('input', { type: 'date', value: deployment.endDate, onChange: (e) => onPatch({ endDate: e.target.value }) }))
    ),
    h(Field, { label: 'Detector info' }, h('input', { value: deployment.detectorInfo, onChange: (e) => onPatch({ detectorInfo: e.target.value }), placeholder: 'e.g. Song Meter SM4BAT, serial S4U00485' })),
    h(Field, { label: 'Weather' }, h('input', { value: deployment.weather, onChange: (e) => onPatch({ weather: e.target.value }), placeholder: 'e.g. Dry, 14-18C, light wind' })),
    h(Field, { label: 'Notes' }, h('textarea', { rows: 3, value: deployment.notes, onChange: (e) => onPatch({ notes: e.target.value }) })),

    h('div', { className: 'section-title' }, 'Survey effort'),
    h('div', { className: 'field-row' },
      h(Field, { label: 'Nights' }, h('input', { type: 'number', value: effort.nights ?? '', onChange: (e) => patchEffort({ nights: e.target.value === '' ? null : Number(e.target.value) }) })),
      h(Field, { label: 'Valid recording hours' }, h('input', { type: 'number', value: effort.validRecordingHours ?? '', onChange: (e) => patchEffort({ validRecordingHours: e.target.value === '' ? null : Number(e.target.value) }) })),
      h(Field, { label: 'QA completion %' }, h('input', { type: 'number', value: effort.qaCompletionPct ?? '', onChange: (e) => patchEffort({ qaCompletionPct: e.target.value === '' ? null : Number(e.target.value) }) }))
    ),
    h(Field, { label: 'Detector failures' }, h('textarea', { rows: 2, value: effort.detectorFailures, onChange: (e) => patchEffort({ detectorFailures: e.target.value }), placeholder: 'e.g. flat battery night 3, no recordings 19-20 June' })),
    h(Field, { label: 'Excluded periods' }, h('textarea', { rows: 2, value: effort.excludedPeriods, onChange: (e) => patchEffort({ excludedPeriods: e.target.value }), placeholder: 'e.g. 21 June excluded - detector knocked down' })),

    h('div', { className: 'section-title' }, 'Detection Events'),
    h('div', { className: 'stat-grid' },
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Total'), h('div', { className: 'stat-box-value' }, String((deployment.detectionEvents || []).length))),
      h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'BTO imports'), h('div', { className: 'stat-box-value' }, String((deployment.btoImports || []).length)))
    ),
    h('div', { className: 'card-sub', style: { marginTop: 10 } }, 'BTO import lands in Phase 2 — this deployment is ready to receive it.')
  );
}

// ---------------- Manual review (sonogram, measurement, shape, decision tree, QA) ----------------

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

function timeToPixel(t, durationSec, width) {
  return durationSec > 0 ? (t / durationSec) * width : 0;
}
function freqToPixelY(f, sampleRate, height) {
  const nyquist = sampleRate / 2;
  return height * (1 - f / nyquist);
}

function BoxOverlay({ box, durationSec, sampleRate, width, specHeight }) {
  const x0 = timeToPixel(box.t0, durationSec, width);
  const x1 = timeToPixel(box.t1, durationSec, width);
  const y0 = freqToPixelY(box.f1, sampleRate, specHeight);
  const y1 = freqToPixelY(box.f0, sampleRate, specHeight);
  return h('div', {
    style: {
      position: 'absolute', left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0),
      border: '2px solid var(--teal)', background: 'rgba(79,184,168,0.12)', pointerEvents: 'none',
    },
  });
}

const SONOGRAM_WIDTH = 860, SPEC_HEIGHT = 260, OSC_HEIGHT = 70;

function Sonogram({ spec, samples, sampleRate, floorDb, rangeDb, saturation, box, onBoxChange }) {
  const specCanvasRef = useRef(null);
  const oscCanvasRef = useRef(null);
  const dragRef = useRef(null);
  const [dragRect, setDragRect] = useState(null);

  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas || !spec) return;
    canvas.width = SONOGRAM_WIDTH; canvas.height = SPEC_HEIGHT;
    const ctx = canvas.getContext('2d');
    const img = Dsp.renderSpectrogramImageData(spec, {
      frameFrom: 0, frameTo: spec.numFrames - 1, binFrom: 0, binTo: spec.numBins - 1,
      floorDb, rangeDb, saturation,
    });
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.clearRect(0, 0, SONOGRAM_WIDTH, SPEC_HEIGHT);
    ctx.drawImage(off, 0, 0, SONOGRAM_WIDTH, SPEC_HEIGHT);
  }, [spec, floorDb, rangeDb, saturation]);

  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas || !samples) return;
    canvas.width = SONOGRAM_WIDTH; canvas.height = OSC_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14171a';
    ctx.fillRect(0, 0, SONOGRAM_WIDTH, OSC_HEIGHT);
    const duration = samples.length / sampleRate;
    const { mins, maxs } = Dsp.computeOscillogramColumns(samples, sampleRate, 0, duration, SONOGRAM_WIDTH);
    ctx.strokeStyle = '#4fb8a8';
    ctx.beginPath();
    for (let x = 0; x < SONOGRAM_WIDTH; x++) {
      const yMin = OSC_HEIGHT / 2 - maxs[x] * (OSC_HEIGHT / 2 - 2);
      const yMax = OSC_HEIGHT / 2 - mins[x] * (OSC_HEIGHT / 2 - 2);
      ctx.moveTo(x + 0.5, yMin);
      ctx.lineTo(x + 0.5, yMax);
    }
    ctx.stroke();
  }, [samples, sampleRate]);

  function pixelToTime(x) {
    const duration = spec ? spec.durationSec : (samples.length / sampleRate);
    return Math.max(0, Math.min(duration, (x / SONOGRAM_WIDTH) * duration));
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
    if (!dragRef.current) return;
    const p = localXY(e);
    setDragRect({ x0: dragRef.current.x, y0: dragRef.current.y, x1: p.x, y1: p.y });
  }
  function handleMouseUp(e) {
    if (!dragRef.current) return;
    const p = localXY(e);
    const x0 = Math.min(dragRef.current.x, p.x), x1 = Math.max(dragRef.current.x, p.x);
    const y0 = Math.min(dragRef.current.y, p.y), y1 = Math.max(dragRef.current.y, p.y);
    dragRef.current = null;
    setDragRect(null);
    if (x1 - x0 < 3) return;
    const t0 = pixelToTime(x0), t1 = pixelToTime(x1);
    const f1 = pixelToFreq(y0), f0 = pixelToFreq(y1);
    onBoxChange({ t0, t1, f0, f1 });
  }

  return h('div', { style: { position: 'relative', width: SONOGRAM_WIDTH, maxWidth: '100%' } },
    h('canvas', {
      ref: specCanvasRef, style: { width: '100%', height: SPEC_HEIGHT, display: 'block', cursor: 'crosshair', borderRadius: '8px 8px 0 0', background: '#0a0c0e' },
      onMouseDown: handleMouseDown, onMouseMove: handleMouseMove, onMouseUp: handleMouseUp,
      onMouseLeave: () => { dragRef.current = null; setDragRect(null); },
    }),
    h('canvas', { ref: oscCanvasRef, style: { width: '100%', height: OSC_HEIGHT, display: 'block', borderRadius: '0 0 8px 8px' } }),
    dragRect && h('div', {
      style: {
        position: 'absolute', left: (Math.min(dragRect.x0, dragRect.x1) / SONOGRAM_WIDTH) * 100 + '%',
        top: Math.min(dragRect.y0, dragRect.y1), width: (Math.abs(dragRect.x1 - dragRect.x0) / SONOGRAM_WIDTH) * 100 + '%',
        height: Math.abs(dragRect.y1 - dragRect.y0), border: '1px solid var(--accent)', background: 'rgba(232,131,58,0.15)', pointerEvents: 'none',
      },
    }),
    box && spec && h(BoxOverlay, { box, durationSec: spec.durationSec, sampleRate, width: SONOGRAM_WIDTH, specHeight: SPEC_HEIGHT })
  );
}

function WavFolderPicker({ wavFileMap, setWavFileMap }) {
  const inputRef = useRef(null);
  function handleChange(e) {
    const files = e.target.files;
    const map = new Map();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (/\.wav$/i.test(f.name)) map.set(f.name, f);
    }
    setWavFileMap(map);
  }
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
    h('button', { className: 'btn btn-secondary btn-small', onClick: () => inputRef.current.click() },
      wavFileMap.size ? `WAV folder loaded (${wavFileMap.size} files) - change` : '+ Load WAV folder'),
    h('input', {
      ref: (el) => { if (el) { el.webkitdirectory = true; el.directory = true; } },
      type: 'file', multiple: true, style: { display: 'none' }, onChange: handleChange,
    })
  );
}

function ReviewTab({ deployment, onPatchEvent, wavFileMap, setWavFileMap }) {
  const allEvents = deployment.detectionEvents || [];
  const sorted = useMemo(() => sortEventsChronologically(allEvents), [allEvents]);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const list = unreviewedOnly ? sorted.filter((e) => !e.manualReview.reviewed) : sorted;

  const [currentId, setCurrentId] = useState(list[0] ? list[0].id : null);
  useEffect(() => {
    if (!list.find((e) => e.id === currentId) && list.length) setCurrentId(list[0].id);
  }, [list.length, unreviewedOnly]);

  const currentIndex = list.findIndex((e) => e.id === currentId);
  const currentEvent = currentIndex >= 0 ? list[currentIndex] : null;

  const wavCacheRef = useRef(new Map());
  const [decodedWav, setDecodedWav] = useState(null);
  const [wavStatus, setWavStatus] = useState('none'); // none | loading | ready | error | missing

  useEffect(() => {
    if (!currentEvent) { setDecodedWav(null); setWavStatus('none'); return; }
    const file = wavFileMap.get(currentEvent.originalWav);
    if (!file) { setDecodedWav(null); setWavStatus('missing'); return; }
    const cache = wavCacheRef.current;
    if (cache.has(currentEvent.originalWav)) {
      setDecodedWav(cache.get(currentEvent.originalWav));
      setWavStatus('ready');
      return;
    }
    setWavStatus('loading');
    setDecodedWav(null);
    file.arrayBuffer().then((buf) => {
      try {
        const parsed = Wav.parseWav(buf);
        cache.set(currentEvent.originalWav, parsed);
        setDecodedWav(parsed);
        setWavStatus('ready');
      } catch (e) {
        setWavStatus('error');
      }
    });
  }, [currentEvent && currentEvent.id, wavFileMap]);

  const [fftSize, setFftSize] = useState(512);
  const spec = useMemo(() => (decodedWav ? Dsp.computeSpectrogram(decodedWav.samples, decodedWav.sampleRate, fftSize) : null), [decodedWav, fftSize]);

  const [floorDb, setFloorDb] = useState(-70);
  const [rangeDb, setRangeDb] = useState(50);
  const [saturation, setSaturation] = useState(0.85);

  const [box, setBox] = useState(null);
  const [shapeOverride, setShapeOverride] = useState(null);
  useEffect(() => { setBox(null); setShapeOverride(null); }, [currentEvent && currentEvent.id]);

  const measurement = useMemo(
    () => (box && spec && decodedWav ? Dsp.measureBox(spec, decodedWav.samples, decodedWav.sampleRate, box) : null),
    [box, spec, decodedWav]
  );
  const shapeAuto = useMemo(() => (measurement ? Dsp.classifyShape(measurement.ridge) : null), [measurement]);
  const finalShape = shapeOverride || (shapeAuto && shapeAuto.shape) || null;

  const speciesResults = useMemo(() => {
    if (!measurement) return [];
    return SpeciesData.scoreSpecies({
      peak: measurement.peakFreqHz != null ? measurement.peakFreqHz / 1000 : null,
      start: measurement.startFreqHz != null ? measurement.startFreqHz / 1000 : null,
      end: measurement.endFreqHz != null ? measurement.endFreqHz / 1000 : null,
      duration: measurement.durationMs,
      ipi: null,
    }, finalShape);
  }, [measurement, finalShape]);

  const speciesCounts = useMemo(() => computeSpeciesCounts(allEvents), [allEvents]);
  const quickSpecies = Object.entries(speciesCounts).filter(([label]) => label !== 'Noise / No ID')
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label]) => label);

  function goTo(index) {
    if (index < 0 || index >= list.length) return;
    setCurrentId(list[index].id);
  }

  function setFinalId(label) {
    if (!currentEvent) return;
    onPatchEvent(currentEvent.id, {
      manualReview: { ...currentEvent.manualReview, reviewed: true, finalId: label, reviewedAt: new Date().toISOString() },
    });
    goTo(currentIndex + 1);
  }

  if (list.length === 0) {
    return h('div', { className: 'content' },
      h('div', { className: 'empty-state' },
        h('div', { className: 'empty-title' }, 'No detection events to review'),
        h('div', { className: 'empty-text' }, 'Import a BTO CSV on the Detections tab first.')
      )
    );
  }

  return h('div', { className: 'content', style: { maxWidth: 'none' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 } },
      h(WavFolderPicker, { wavFileMap, setWavFileMap }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('label', { style: { fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', { type: 'checkbox', checked: unreviewedOnly, onChange: (e) => setUnreviewedOnly(e.target.checked) }),
          'Unreviewed only'
        ),
        h('button', { className: 'btn btn-secondary btn-small', onClick: () => goTo(currentIndex - 1), disabled: currentIndex <= 0 }, '← Prev'),
        h('span', { className: 'card-sub', style: { fontFamily: 'var(--font-mono)' } }, `${currentIndex + 1} / ${list.length}`),
        h('button', { className: 'btn btn-secondary btn-small', onClick: () => goTo(currentIndex + 1), disabled: currentIndex >= list.length - 1 }, 'Next →')
      )
    ),

    currentEvent && h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 16 } },
      // Left: sonogram + controls + quick labels
      h('div', null,
        h('div', { className: 'card-sub', style: { marginBottom: 8 } },
          `${currentEvent.originalWav} · part ${currentEvent.partNumber} · ${currentEvent.surveyDate || '?'} ${currentEvent.time || ''}`
        ),
        wavStatus === 'missing' && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--text-muted)' } },
          `No matching WAV loaded for "${currentEvent.originalWav}". Load the WAV folder above to view its sonogram - you can still label from the BTO data alone.`),
        wavStatus === 'error' && h('div', { className: 'card', style: { marginBottom: 12, color: 'var(--danger)' } }, 'Could not parse this WAV file.'),
        wavStatus === 'loading' && h('div', { className: 'card-sub', style: { marginBottom: 12 } }, 'Loading audio...'),
        wavStatus === 'ready' && spec && h(React.Fragment, null,
          h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 12 } },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, 'FFT size',
              h('select', { value: fftSize, onChange: (e) => setFftSize(Number(e.target.value)), style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px' } },
                Dsp.FFT_SIZES.map((s) => h('option', { key: s, value: s }, s)))),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 } }, 'Brightness',
              h('input', { type: 'range', min: -100, max: -20, value: floorDb, onChange: (e) => setFloorDb(Number(e.target.value)), style: { flex: 1 } })),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 } }, 'Contrast',
              h('input', { type: 'range', min: 10, max: 100, value: rangeDb, onChange: (e) => setRangeDb(Number(e.target.value)), style: { flex: 1 } })),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 140 } }, 'Saturation',
              h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: saturation, onChange: (e) => setSaturation(Number(e.target.value)), style: { flex: 1 } }))
          ),
          h(Sonogram, { spec, samples: decodedWav.samples, sampleRate: decodedWav.sampleRate, floorDb, rangeDb, saturation, box, onBoxChange: setBox }),
          h('div', { className: 'card-sub', style: { marginTop: 6 } }, 'Drag on the sonogram to box a call and measure it.')
        ),

        measurement && h('div', { className: 'card', style: { marginTop: 14 } },
          h('div', { className: 'stat-grid' },
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Peak freq'), h('div', { className: 'stat-box-value' }, measurement.peakFreqHz != null ? (measurement.peakFreqHz / 1000).toFixed(1) + ' kHz' : '-')),
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Max freq'), h('div', { className: 'stat-box-value' }, measurement.maxFreqHz != null ? (measurement.maxFreqHz / 1000).toFixed(1) + ' kHz' : '-')),
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Min freq'), h('div', { className: 'stat-box-value' }, measurement.minFreqHz != null ? (measurement.minFreqHz / 1000).toFixed(1) + ' kHz' : '-')),
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Start freq'), h('div', { className: 'stat-box-value' }, measurement.startFreqHz != null ? (measurement.startFreqHz / 1000).toFixed(1) + ' kHz' : '-')),
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'End freq'), h('div', { className: 'stat-box-value' }, measurement.endFreqHz != null ? (measurement.endFreqHz / 1000).toFixed(1) + ' kHz' : '-')),
            h('div', { className: 'stat-box' }, h('div', { className: 'stat-box-label' }, 'Duration'), h('div', { className: 'stat-box-value' }, measurement.durationMs.toFixed(1) + ' ms' + (measurement.durationRefined ? '' : ' (raw)')))
          ),
          h('div', { style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', { style: { fontSize: 12, color: 'var(--text-muted)' } }, 'Shape:'),
            h('select', {
              value: finalShape || '', onChange: (e) => setShapeOverride(e.target.value),
              style: { background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' },
            }, SpeciesData.SHAPE_LABELS.map((s) => h('option', { key: s, value: s }, s))),
            shapeAuto && !shapeOverride && h('span', { className: 'pill' }, `auto-suggested (${Math.round(shapeAuto.confidence * 100)}%)`)
          )
        ),

        speciesResults.length > 0 && h('div', { className: 'card', style: { marginTop: 14, padding: 0, overflow: 'hidden' } },
          h('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 } }, 'Decision-tree candidates (top 6)'),
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null, h('tr', null,
              ['Species', 'Score', 'Peak', 'Start', 'End', 'Dur.'].map((c) => h('th', { key: c, style: { textAlign: 'left', padding: '5px 10px', color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase' } }, c))
            )),
            h('tbody', null, speciesResults.slice(0, 6).map((res) => h('tr', { key: res.species.name },
              h('td', { style: { padding: '5px 10px', borderTop: '1px solid var(--border)' } }, res.species.name),
              h('td', { style: { padding: '5px 10px', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, `${res.passed}/${res.evaluated}`),
              ...['peak', 'start', 'end', 'duration'].map((k) => h('td', {
                key: k, style: { padding: '5px 10px', borderTop: '1px solid var(--border)', color: res.checks[k] === true ? 'var(--teal)' : res.checks[k] === false ? 'var(--danger)' : 'var(--text-faint)' },
              }, res.checks[k] === true ? '✓' : res.checks[k] === false ? '✗' : '-'))
            )))
          )
        ),

        h('div', { className: 'card', style: { marginTop: 14 } },
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
          currentEvent.manualReview.reviewed && h('div', { style: { marginTop: 8, color: 'var(--teal)', fontSize: 13 } }, `New ID: ${currentEvent.manualReview.finalId} (reviewed)`)
        ),

        h('div', { style: { marginTop: 14 } },
          h('div', { className: 'card-sub', style: { marginBottom: 8 } }, 'Quick label (sets Final ID and moves to the next call):'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            quickSpecies.map((label) => h('button', { key: label, className: 'btn btn-secondary btn-small', onClick: () => setFinalId(label) }, label)),
            h('button', { className: 'btn btn-danger btn-small', onClick: () => setFinalId('Noise / No ID') }, 'Noise / No ID')
          )
        )
      ),

      // Right: BTO attribute panel for the current event
      h('div', { className: 'card' },
        h('div', { style: { fontWeight: 600, marginBottom: 10 } }, 'Detection attributes'),
        h(AttrRow, { label: 'Original WAV', value: currentEvent.originalWav }),
        h(AttrRow, { label: 'Part', value: currentEvent.partNumber }),
        h(AttrRow, { label: 'Survey date', value: currentEvent.surveyDate }),
        h(AttrRow, { label: 'Time', value: currentEvent.time }),
        h(AttrRow, { label: 'Location', value: currentEvent.latitude != null ? `${currentEvent.latitude}, ${currentEvent.longitude}` : '-' }),
        h(AttrRow, { label: 'Candidates', value: String(currentEvent.candidateSpecies.length) }),
        h(AttrRow, { label: 'QA status', value: currentEvent.qaStatus || 'not set (Phase 4)' })
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
  const currentIndex = list.findIndex((e) => e.id === currentId);
  const from = Math.max(0, currentIndex - TABLE_WINDOW_RADIUS);
  const to = Math.min(list.length, currentIndex + TABLE_WINDOW_RADIUS + 1);
  const windowRows = list.slice(from, to);

  useEffect(() => {
    if (rowRef.current) rowRef.current.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return h('div', { style: { marginTop: 18 } },
    h('div', { className: 'section-title' }, `Calls list (showing ${from + 1}-${to} of ${list.length})`),
    h('div', { className: 'card', style: { padding: 0, maxHeight: 320, overflowY: 'auto' } },
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
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)' } }, ev.primaryBtoId ? (ev.primaryBtoId.englishName || ev.primaryBtoId.species) : 'No ID'),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)' } }, ev.primaryBtoId && ev.primaryBtoId.probability != null ? ev.primaryBtoId.probability.toFixed(2) : ''),
            h('td', { style: { padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--teal)' } }, ev.manualReview.finalId || ''),
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
