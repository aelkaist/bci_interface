const REQUIRED_CSV_COLUMNS = [
  'participant_id',
  'trajectory_name',
  'feedback',
  'group'
];

const asText = value => String(value ?? '');
const isAnnotated = value => asText(value).trim().length > 0;

const escapeHtml = value => asText(value).replace(
  /[&<>"']/g,
  char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]
);

const csvEscape = value => {
  const text = asText(value);
  const escaped = text.replaceAll('"', '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
};

const sortedItems = codebook => [...codebook.items].sort((a, b) => a.csvRow - b.csvRow);

export function validateCodebook(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) {
    throw new Error('Unsupported Initial Codebook schema.');
  }
  if (!raw.datasetId || typeof raw.datasetId !== 'string') {
    throw new Error('Initial Codebook datasetId is missing.');
  }
  if (!raw.source || !Array.isArray(raw.source.columns)) {
    throw new Error('Initial Codebook source columns are missing.');
  }
  if (!Number.isInteger(raw.source.rowCount) || raw.source.rowCount < 0) {
    throw new Error('Initial Codebook source row count is invalid.');
  }
  if (raw.datasetId !== raw.source.sha256) {
    throw new Error('Initial Codebook datasetId does not match its source hash.');
  }
  if (JSON.stringify(raw.source.columns) !== JSON.stringify(REQUIRED_CSV_COLUMNS)) {
    throw new Error('Initial Codebook source columns do not match the sampled CSV.');
  }
  if (!Array.isArray(raw.items) || raw.items.length !== raw.source.rowCount) {
    throw new Error('Initial Codebook row count does not match its source metadata.');
  }
  if (raw.annotation?.column !== 'KY') {
    throw new Error('Initial Codebook annotation column must be KY.');
  }

  const items = sortedItems(raw);
  const ids = new Set();
  items.forEach((item, index) => {
    if (item.csvRow !== index) {
      throw new Error(`Initial Codebook csvRow ${index} is missing or out of order.`);
    }
    if (!item.sampleId || ids.has(item.sampleId)) {
      throw new Error(`Initial Codebook sampleId is missing or duplicated at row ${index + 1}.`);
    }
    ids.add(item.sampleId);
    REQUIRED_CSV_COLUMNS.forEach(column => {
      if (!Object.prototype.hasOwnProperty.call(item.csv || {}, column)) {
        throw new Error(`Initial Codebook row ${index + 1} is missing ${column}.`);
      }
    });
    if (!item.replay?.trajectoryPath || !item.replay?.feedbackId) {
      throw new Error(`Initial Codebook row ${index + 1} is missing replay metadata.`);
    }
    if (item.sampleId !== item.replay.feedbackId) {
      throw new Error(`Initial Codebook row ${index + 1} has mismatched feedback IDs.`);
    }
  });

  return { ...raw, items };
}

export function serializeAnnotatedCsv(codebook, annotations = {}) {
  const validated = validateCodebook(codebook);
  const annotationColumn = validated.annotation.column;
  const columns = [...validated.source.columns, annotationColumn];
  const records = validated.items.map(item => [
    ...validated.source.columns.map(column => item.csv[column]),
    Object.prototype.hasOwnProperty.call(annotations, item.sampleId)
      ? annotations[item.sampleId]
      : item[annotationColumn]
  ]);
  const lines = [
    columns.map(csvEscape).join(','),
    ...records.map(record => record.map(csvEscape).join(','))
  ];
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export function createAnnotationBackup(codebook, annotations = {}) {
  const validated = validateCodebook(codebook);
  return {
    schemaVersion: 1,
    datasetId: validated.datasetId,
    sourceCsv: validated.source.file,
    annotationColumn: validated.annotation.column,
    annotations: validated.items.map(item => ({
      sampleId: item.sampleId,
      csvRow: item.csvRow,
      KY: Object.prototype.hasOwnProperty.call(annotations, item.sampleId)
        ? asText(annotations[item.sampleId])
        : asText(item.KY)
    }))
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCsvBlob(blob, fileName) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'CSV file',
          accept: { 'text/csv': ['.csv'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.warn('File picker unavailable; using browser download instead.', error);
    }
  }

  downloadBlob(blob, fileName);
  return 'downloaded';
}

export class AnnotationWorkspace {
  constructor({ codebookUrl, onReplay }) {
    this.codebookUrl = codebookUrl;
    this.onReplay = onReplay;
    this.codebook = null;
    this.items = [];
    this.annotations = {};
    this.currentIndex = 0;
    this.storageKey = '';
    this.saveTimer = null;
    this.replayToken = 0;
    this.elements = {};
  }

  async init() {
    this.captureElements();
    try {
      const response = await fetch(this.codebookUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Initial Codebook request failed (${response.status}).`);
      }
      this.codebook = validateCodebook(await response.json());
      this.items = this.codebook.items;
      this.storageKey = `bci-feedback-annotations:${this.codebook.datasetId}:KY`;
      this.loadDraft();
      this.bindControls();
      this.renderItem();
      await this.replayCurrent();
    } catch (error) {
      this.showError(error);
      throw error;
    }
  }

  captureElements() {
    const ids = [
      'annotation-workspace',
      'annotation-progress-label',
      'annotation-progress-fill',
      'annotation-prev',
      'annotation-next',
      'annotation-next-empty',
      'annotation-backup',
      'annotation-export',
      'annotation-save-status'
    ];
    ids.forEach(id => {
      this.elements[id] = document.getElementById(id);
    });
    if (!this.elements['annotation-workspace']) {
      throw new Error('Annotation workspace markup is unavailable.');
    }
  }

  bindControls() {
    this.elements['annotation-prev']?.addEventListener('click', () => {
      this.goTo(this.currentIndex - 1);
    });
    this.elements['annotation-next']?.addEventListener('click', () => {
      this.goTo(this.currentIndex + 1);
    });
    this.elements['annotation-next-empty']?.addEventListener('click', () => {
      this.goToNextUnfinished();
    });
    this.elements['annotation-backup']?.addEventListener('click', () => {
      this.exportBackup();
    });
    this.elements['annotation-export']?.addEventListener('click', () => {
      this.exportCsv();
    });
    window.addEventListener('pagehide', () => this.persistDraft());
  }

  loadDraft() {
    this.annotations = Object.fromEntries(
      this.items.map(item => [item.sampleId, asText(item.KY)])
    );
    try {
      const stored = window.localStorage.getItem(this.storageKey);
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (draft.datasetId !== this.codebook.datasetId || !draft.annotations) return;
      this.items.forEach(item => {
        const value = draft.annotations[item.sampleId];
        if (typeof value === 'string') this.annotations[item.sampleId] = value;
      });
      if (Number.isInteger(draft.lastIndex)) {
        this.currentIndex = Math.min(
          this.items.length - 1,
          Math.max(0, draft.lastIndex)
        );
      }
    } catch (error) {
      console.warn('Could not restore the local annotation draft.', error);
      this.setSaveStatus('Local draft restore failed; annotation can still continue.');
    }
  }

  scheduleDraftSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.persistDraft(), 250);
  }

  persistDraft() {
    if (!this.codebook) return;
    window.clearTimeout(this.saveTimer);
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify({
        schemaVersion: 1,
        datasetId: this.codebook.datasetId,
        annotationColumn: 'KY',
        lastIndex: this.currentIndex,
        updatedAt: new Date().toISOString(),
        annotations: this.annotations
      }));
      this.setSaveStatus('Draft auto-saved in this browser.');
    } catch (error) {
      console.warn('Could not save the local annotation draft.', error);
      this.setSaveStatus('Local draft could not be saved. Export before closing.');
    }
  }

  renderItem() {
    const root = this.elements['annotation-workspace'];
    const item = this.items[this.currentIndex];
    if (!item) {
      root.innerHTML = '<div class="annotation-error">No feedback rows are available.</div>';
      return;
    }

    const csv = item.csv;
    const replay = item.replay;
    const score = replay.sentiment ?? '—';
    const range = replay.startFrame != null && replay.endFrame != null
      ? `range ${replay.startFrame}–${replay.endFrame}`
      : `around frame ${replay.baseFrame ?? '—'}`;
    root.innerHTML = `
      <div class="annotation-item-meta">
        <span class="annotation-chip">${escapeHtml(csv.group)}</span>
        <span>Row ${item.csvRow + 1}</span>
        <span>Sentiment ${escapeHtml(score)}/5</span>
        <span>${escapeHtml(range)}</span>
      </div>
      <div class="annotation-feedback">${escapeHtml(csv.feedback)}</div>
      ${replay.reason
        ? `<div class="annotation-reason"><strong>Reason:</strong> ${escapeHtml(replay.reason)}</div>`
        : ''}
      <label class="annotation-label" for="ky-annotation-input">
        <span>KY annotation</span>
        <span>${escapeHtml(csv.trajectory_name)}</span>
      </label>
      <textarea class="annotation-textarea" id="ky-annotation-input"
        placeholder="Add the KY annotation for this feedback…"></textarea>
      <div class="annotation-replay-row">
        <span class="annotation-replay-status" id="annotation-replay-status">Replay ready</span>
        <button type="button" class="annotation-btn" id="annotation-load-replay">↻ Load this replay</button>
      </div>
    `;

    const input = document.getElementById('ky-annotation-input');
    input.value = this.annotations[item.sampleId] ?? '';
    input.addEventListener('input', event => {
      this.annotations[item.sampleId] = event.target.value;
      this.scheduleDraftSave();
      this.updateProgress();
    });
    document.getElementById('annotation-load-replay')?.addEventListener('click', () => {
      this.replayCurrent();
    });

    this.updateProgress();
  }

  updateProgress() {
    const completed = this.items.reduce(
      (count, item) => count + (isAnnotated(this.annotations[item.sampleId]) ? 1 : 0),
      0
    );
    const total = this.items.length;
    const percent = total ? (completed / total) * 100 : 0;
    if (this.elements['annotation-progress-label']) {
      this.elements['annotation-progress-label'].textContent =
        `${this.currentIndex + 1} / ${total} · ${completed} annotated`;
    }
    if (this.elements['annotation-progress-fill']) {
      this.elements['annotation-progress-fill'].style.width = `${percent}%`;
    }
    if (this.elements['annotation-prev']) {
      this.elements['annotation-prev'].disabled = this.currentIndex === 0;
    }
    if (this.elements['annotation-next']) {
      this.elements['annotation-next'].disabled = this.currentIndex >= total - 1;
    }
    if (this.elements['annotation-next-empty']) {
      this.elements['annotation-next-empty'].disabled = completed === total;
    }
    if (this.elements['annotation-export']) {
      this.elements['annotation-export'].textContent = completed === total
        ? 'Save all & export KY CSV'
        : `Export KY CSV (${completed}/${total})`;
    }
  }

  goTo(index) {
    if (!this.items.length) return;
    const target = Math.min(this.items.length - 1, Math.max(0, index));
    if (target === this.currentIndex && index !== this.currentIndex) return;
    this.persistDraft();
    this.currentIndex = target;
    this.renderItem();
    this.replayCurrent();
  }

  goToNextUnfinished() {
    const total = this.items.length;
    for (let offset = 1; offset <= total; offset += 1) {
      const candidate = (this.currentIndex + offset) % total;
      if (!isAnnotated(this.annotations[this.items[candidate].sampleId])) {
        this.goTo(candidate);
        return;
      }
    }
    this.setSaveStatus('All feedback rows have a KY annotation.');
  }

  async replayCurrent() {
    const item = this.items[this.currentIndex];
    const status = document.getElementById('annotation-replay-status');
    const token = ++this.replayToken;
    if (!item || typeof this.onReplay !== 'function') {
      if (status) status.textContent = 'Replay handler unavailable';
      return;
    }

    if (status) status.textContent = 'Loading sampled trajectory…';
    try {
      await this.onReplay(item);
      if (token === this.replayToken && status) {
        status.textContent = `Loaded ${item.replay.trajectoryPath}`;
      }
    } catch (error) {
      console.error('Could not load sampled feedback replay.', error);
      if (token === this.replayToken && status) {
        status.textContent = 'Replay unavailable; annotation remains editable';
      }
    }
  }

  exportBackup() {
    this.persistDraft();
    const backup = createAnnotationBackup(this.codebook, this.annotations);
    const blob = new Blob(
      [JSON.stringify(backup, null, 2) + '\n'],
      { type: 'application/json;charset=utf-8' }
    );
    downloadBlob(blob, 'feedback_sample_10pct_KY_annotations.json');
    this.setSaveStatus('Separate KY annotation JSON downloaded.');
  }

  async exportCsv() {
    this.persistDraft();
    const completed = this.items.reduce(
      (count, item) => count + (isAnnotated(this.annotations[item.sampleId]) ? 1 : 0),
      0
    );
    if (
      completed !== this.items.length
      && !window.confirm(
        `${this.items.length - completed} feedback rows are unfinished. Export with blank KY cells anyway?`
      )
    ) {
      return;
    }

    const csv = serializeAnnotatedCsv(this.codebook, this.annotations);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const result = await saveCsvBlob(blob, this.codebook.source.file);
    if (result === 'saved') {
      this.setSaveStatus(`${this.codebook.source.file} saved with the KY column.`);
    } else if (result === 'downloaded') {
      this.setSaveStatus(`${this.codebook.source.file} downloaded with the KY column.`);
    } else {
      this.setSaveStatus('CSV export cancelled.');
    }
  }

  setSaveStatus(message) {
    if (this.elements['annotation-save-status']) {
      this.elements['annotation-save-status'].textContent = message;
    }
  }

  showError(error) {
    const root = this.elements['annotation-workspace'];
    if (root) {
      root.innerHTML = `<div class="annotation-error">Initial Codebook could not be loaded.<br>${escapeHtml(error.message)}</div>`;
    }
    if (this.elements['annotation-progress-label']) {
      this.elements['annotation-progress-label'].textContent = 'Codebook unavailable';
    }
  }
}
