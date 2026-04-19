/**
 * MEDIA-MGR v2.0 — メインアプリケーション
 * サイバーパンク Yellow Theme
 */

'use strict';

/* ============================================================
   STATE
   ============================================================ */
const state = {
  files: [],          // {file, name, size, wb, rows, status}
  allRows: [],        // 統合後の全行データ [{brand,category,agency,media,plan,note,amount,_colors,_src}]
  agencies: [],       // 代理店一覧（順序付き）
  folderName: '',     // ドロップされたフォルダ名
  currentTab: 'all',
  searchQuery: '',
  sortCol: null,
  sortDir: 'asc',
  page: 1,
  pageSize: 50,
  previewTarget: null, // {type:'master'|'agency', agencies:[]}
};

/* ============================================================
   DOM REFS
   ============================================================ */
const $ = id => document.getElementById(id);
const els = {
  dropZone:        $('dropZone'),
  fileInput:       $('fileInput'),
  folderInput:     $('folderInput'),
  uploadedFiles:   $('uploadedFiles'),
  filesList:       $('filesList'),
  folderInfoBar:   $('folderInfoBar'),
  folderNameEl:    $('folderName'),
  folderBadge:     $('folderBadge'),
  uploadedTitle:   $('uploadedTitle'),
  btnClearFiles:   $('btnClearFiles'),
  btnIntegrate:    $('btnIntegrate'),
  processInfo:     $('processInfo'),
  uploadStatus:    $('uploadStatus'),
  uploadPanel:     $('uploadPanel'),
  dataPanel:       $('dataPanel'),
  exportPanel:     $('exportPanel'),
  get tabNav() { return $('tabNav').querySelector('.tab-nav-scroll'); },
  tableBody:       $('tableBody'),
  pagination:      $('pagination'),
  searchInput:     $('searchInput'),
  summaryTotal:    $('summaryTotal'),
  summaryAgencies: $('summaryAgencies'),
  summaryAmount:   $('summaryAmount'),
  summaryView:     $('summaryView'),
  btnBack:         $('btnBack'),
  btnToExport:     $('btnToExport'),
  fileCount:       $('fileCount'),
  rowCount:        $('rowCount'),
  statusDot:       $('statusDot'),
  statusText:      $('statusText'),
  masterFileName:  $('masterFileName'),
  agencyFilePrefix:$('agencyFilePrefix'),
  agencyCheckboxes:$('agencyCheckboxes'),
  btnExportMaster: $('btnExportMaster'),
  btnExportAgency: $('btnExportAgency'),
  btnSelectAll:    $('btnSelectAll'),
  btnDeselectAll:  $('btnDeselectAll'),
  optAllSheet:     $('optAllSheet'),
  optAgencySheets: $('optAgencySheets'),
  logConsole:      $('logConsole'),
  logBody:         $('logBody'),
  logToggle:       $('logToggle'),
  toastContainer:  $('toastContainer'),
  pastMonthSelect: $('pastMonthSelect'),
  btnLoadPast:     $('btnLoadPast'),
};

/* ============================================================
   CLOCK
   ============================================================ */
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  $('clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  $('dateDisplay').textContent = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())}`;
}
updateClock();
setInterval(updateClock, 1000);

/* ============================================================
   SYSTEM LOG
   ============================================================ */
function sysLog(msg, type='info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  entry.innerHTML = `<span class="log-time">[${ts}]</span><span class="log-msg">${msg}</span>`;
  els.logBody.appendChild(entry);
  els.logBody.scrollTop = els.logBody.scrollHeight;
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  els.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
function showLoading(title='PROCESSING...', sub='') {
  let ov = $('loadingOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'loadingOverlay';
    ov.className = 'loading-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div class="loading-title">${title}</div>
    <div class="loading-sub">${sub}</div>
    <div class="loading-bar-wrap"><div class="loading-bar"></div></div>
  `;
  ov.style.display = 'flex';
}
function hideLoading() {
  const ov = $('loadingOverlay');
  if (ov) ov.style.display = 'none';
}

/* ============================================================
   LOG TOGGLE
   ============================================================ */
els.logToggle.addEventListener('click', () => {
  const body = els.logBody;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  els.logToggle.textContent = isHidden ? '▼' : '▲';
});

/* ============================================================
   FILE DROP & SELECT
   ============================================================ */

// ドロップゾーン Drag & Drop
els.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  els.dropZone.classList.add('drag-over');
});
els.dropZone.addEventListener('dragleave', () => {
  els.dropZone.classList.remove('drag-over');
});
els.dropZone.addEventListener('drop', e => {
  e.preventDefault();
  els.dropZone.classList.remove('drag-over');
  handleDrop(e.dataTransfer);
});
els.dropZone.addEventListener('click', e => {
  // ラベルのクリックはそのまま通す
  if (e.target.tagName === 'LABEL' || e.target.closest('label')) return;
});

// フォルダ選択
els.folderInput.addEventListener('change', e => {
  const files = Array.from(e.target.files).filter(f => /\.(xlsx|xls)$/i.test(f.name));
  if (files.length === 0) return;
  // webkitRelativePathからフォルダ名取得
  const firstPath = files[0].webkitRelativePath || '';
  const folderName = firstPath.split('/')[0] || '';
  handleFiles(files, folderName);
  e.target.value = '';
});

// ファイル選択
els.fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  handleFiles(files, '');
  e.target.value = '';
});

/**
 * ドロップ処理 — FileSystemEntry API でフォルダ再帰読み込み対応
 */
async function handleDrop(dataTransfer) {
  const excelFiles = [];
  let folderName = '';

  const items = Array.from(dataTransfer.items || []);

  if (items.length > 0 && items[0].webkitGetAsEntry) {
    // FileSystemEntry API を使う
    const entries = items.map(i => i.webkitGetAsEntry()).filter(Boolean);

    for (const entry of entries) {
      if (entry.isDirectory) {
        folderName = folderName || entry.name;
        await collectFromDirectory(entry, excelFiles);
      } else if (entry.isFile && /\.(xlsx|xls)$/i.test(entry.name)) {
        const file = await getFileFromEntry(entry);
        excelFiles.push(file);
      }
    }
  } else {
    // フォールバック
    const files = Array.from(dataTransfer.files || []).filter(f => /\.(xlsx|xls)$/i.test(f.name));
    excelFiles.push(...files);
  }

  handleFiles(excelFiles, folderName);
}

function getFileFromEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function collectFromDirectory(dirEntry, files) {
  const reader = dirEntry.createReader();
  return new Promise(resolve => {
    reader.readEntries(async entries => {
      for (const entry of entries) {
        if (entry.isDirectory) {
          await collectFromDirectory(entry, files);
        } else if (entry.isFile && /\.(xlsx|xls)$/i.test(entry.name)) {
          const file = await getFileFromEntry(entry);
          files.push(file);
        }
      }
      resolve();
    });
  });
}

/**
 * ファイル群を state に追加
 */
function handleFiles(newFiles, folderName) {
  if (newFiles.length === 0) {
    toast('Excelファイルが見つかりませんでした', 'warn');
    return;
  }

  if (folderName) {
    state.folderName = folderName;
    // ファイル名の自動設定
    els.masterFileName.value = `【まとめ】${folderName}`;
    els.agencyFilePrefix.value = folderName;
  }

  newFiles.forEach(file => {
    if (state.files.some(f => f.name === file.name && f.size === file.size)) return; // 重複スキップ
    state.files.push({ file, name: file.name, size: file.size, status: 'loading', wb: null, rows: [] });
  });

  renderFileList();
  parseAllFiles();
  sysLog(`FILES ADDED: ${newFiles.length}件`, 'ok');
}

/* ============================================================
   RENDER FILE LIST
   ============================================================ */
function renderFileList() {
  if (state.files.length === 0) {
    els.uploadedFiles.style.display = 'none';
    els.folderInfoBar.style.display = 'none';
    return;
  }

  // フォルダバー
  if (state.folderName) {
    els.folderInfoBar.style.display = 'flex';
    els.folderNameEl.textContent = state.folderName;
    const xlsCount = state.files.length;
    els.folderBadge.textContent = `Excel ${xlsCount}件`;
  } else {
    els.folderInfoBar.style.display = 'none';
  }

  els.uploadedFiles.style.display = 'block';
  const ready = state.files.filter(f => f.status === 'ready').length;
  els.uploadedTitle.textContent = `UPLOADED FILES (${ready}/${state.files.length} ready)`;

  els.filesList.innerHTML = state.files.map((f, i) => `
    <div class="file-item ${f.status}">
      <span class="file-name">${escHtml(f.name)}</span>
      <span class="file-size">${(f.size/1024).toFixed(1)}KB</span>
      <span class="file-status">${f.status === 'ready' ? '✓ OK' : f.status === 'loading' ? '...' : '✗ ERR'}</span>
    </div>
  `).join('');

  els.fileCount.textContent = state.files.length;
  checkIntegrateReady();
}

function checkIntegrateReady() {
  const ready = state.files.filter(f => f.status === 'ready').length;
  els.btnIntegrate.disabled = ready === 0;
  if (ready > 0) {
    els.uploadStatus.textContent = `${ready} FILE(S) READY`;
  }
}

function clearFiles() {
  state.files = [];
  state.folderName = '';
  els.folderInfoBar.style.display = 'none';
  els.uploadedFiles.style.display = 'none';
  els.filesList.innerHTML = '';
  els.btnIntegrate.disabled = true;
  els.uploadStatus.textContent = 'WAITING INPUT';
  els.fileCount.textContent = '0';
}

els.btnClearFiles.addEventListener('click', clearFiles);

/* ============================================================
   PARSE EXCEL FILES
   ============================================================ */
function parseAllFiles() {
  const pending = state.files.filter(f => f.status === 'loading');
  let done = 0;
  pending.forEach(entry => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellStyles: true, cellNF: true });
        entry.wb = wb;
        entry.rows = extractRows(wb);
        entry.status = 'ready';
        sysLog(`PARSED: ${entry.name} → ${entry.rows.length} rows`, 'ok');
      } catch (err) {
        entry.status = 'error';
        sysLog(`PARSE ERROR: ${entry.name} — ${err.message}`, 'error');
        toast(`${entry.name} の読み込みに失敗しました`, 'error');
      }
      done++;
      renderFileList();
      if (done === pending.length) checkIntegrateReady();
    };
    reader.readAsArrayBuffer(entry.file);
  });
}

/**
 * Excelから行データを抽出（背景色も保持）
 * 構造: row1=タイトル, row2=空, row3=ヘッダー, row4~=データ
 * 列: A=ブランド, B=カテゴリ, C=代理店, D=媒体, E=プラン, F=備考, G=金額
 */
function extractRows(wb) {
  const rows = [];
  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const maxRow = range.e.r;

    // ヘッダー行を自動検出（「ブランド」「代理店」などが含まれる行）
    let headerRow = 2; // デフォルト row3 (0-indexed=2)
    for (let r = 0; r <= Math.min(maxRow, 6); r++) {
      const a = getCellVal(ws, r, 0);
      const c = getCellVal(ws, r, 2);
      if (String(a).includes('ブランド') || String(c).includes('代理店')) {
        headerRow = r;
        break;
      }
    }

    // データ行: headerRow+1 から
    for (let r = headerRow + 1; r <= maxRow; r++) {
      const brand    = getCellVal(ws, r, 0);
      const category = getCellVal(ws, r, 1);
      const agency   = getCellVal(ws, r, 2);
      const media    = getCellVal(ws, r, 3);
      const plan     = getCellVal(ws, r, 4);
      const note     = getCellVal(ws, r, 5);
      const amount   = getCellVal(ws, r, 6);

      // 空行をスキップ
      if (!brand && !agency && !media) continue;

      // 各列の背景色を取得
      const cellColors = [];
      for (let c = 0; c < 7; c++) {
        cellColors.push(getCellBgColor(ws, r, c));
      }

      rows.push({
        brand:    String(brand || ''),
        category: String(category || ''),
        agency:   String(agency || '').trim(),
        media:    String(media || ''),
        plan:     String(plan || ''),
        note:     String(note || ''),
        amount:   typeof amount === 'number' ? amount : (parseFloat(String(amount).replace(/[^\d.-]/g,'')) || 0),
        _colors:  cellColors,
        _src: sheetName,
      });
    }
  });
  return rows;
}

function getCellVal(ws, r, c) {
  const addr = XLSX.utils.encode_cell({r, c});
  const cell = ws[addr];
  if (!cell) return '';
  if (cell.t === 'n') return cell.v;
  return cell.v !== undefined ? cell.v : '';
}

/**
 * セルの背景色を取得（6桁RGBまたはnull）
 */
function getCellBgColor(ws, r, c) {
  const addr = XLSX.utils.encode_cell({r, c});
  const cell = ws[addr];
  if (!cell || !cell.s || !cell.s.fgColor) return null;
  const fg = cell.s.fgColor;

  // theme色は無視 (rgb=undefined or "00000000")
  if (!fg.rgb || fg.rgb === '00000000' || fg.rgb === 'FFFFFFFF') return null;

  // 8桁(AARRGGBB) → 6桁(RRGGBB) に正規化
  const rgb = fg.rgb.length === 8 ? fg.rgb.slice(2) : fg.rgb;

  // 白・黒はnull扱い
  if (rgb === 'FFFFFF' || rgb === '000000') return null;
  return rgb;
}

/* ============================================================
   INTEGRATE
   ============================================================ */
function integrateFiles() {
  showLoading('INTEGRATING...', 'データを統合中');
  setTimeout(() => {
    try {
      state.allRows = [];
      state.files.filter(f => f.status === 'ready').forEach(f => {
        f.rows.forEach(row => state.allRows.push({...row, _file: f.name}));
      });

      if (state.allRows.length === 0) {
        hideLoading();
        toast('データが見つかりませんでした。ファイル形式を確認してください。', 'error');
        return;
      }

      // 代理店一覧（出現順・重複なし）
      state.agencies = [];
      state.allRows.forEach(r => {
        if (r.agency && !state.agencies.includes(r.agency)) {
          state.agencies.push(r.agency);
        }
      });

      state.currentTab = 'all';
      state.searchQuery = '';
      state.sortCol = null;
      state.page = 1;

      els.rowCount.textContent = state.allRows.length;
      sysLog(`INTEGRATED: ${state.allRows.length} rows, ${state.agencies.length} agencies`, 'ok');

      hideLoading();
      renderTabs();
      renderTable();
      renderExportPanel();

      els.uploadPanel.style.display = 'none';
      els.dataPanel.style.display = 'block';
      els.exportPanel.style.display = 'block';

      toast(`統合完了: ${state.allRows.length}行 / ${state.agencies.length}代理店`, 'success');

      // DB保存（非同期・UIをブロックしない）
      saveAllFilesToDb().catch(err => {
        sysLog('DB保存失敗: ' + err.message, 'error');
        toast('DB保存に失敗しました: ' + err.message, 'error');
      });
    } catch(err) {
      hideLoading();
      toast('統合処理でエラーが発生しました: ' + err.message, 'error');
      sysLog(`INTEGRATE ERROR: ${err.message}`, 'error');
    }
  }, 300);
}

els.btnIntegrate.addEventListener('click', integrateFiles);

/**
 * 現在のstate.filesをファイル単位でDBに保存（同名は上書き）
 */
async function saveAllFilesToDb() {
  const readyFiles = state.files.filter(f => f.status === 'ready');
  if (readyFiles.length === 0) return;

  sysLog(`DB保存開始: ${readyFiles.length}ファイル`, 'ok');
  let saved = 0;
  for (const f of readyFiles) {
    try {
      const result = await saveFileToDb(f.name, state.folderName, f.rows);
      saved++;
      sysLog(`  ${f.name} → ${result.row_count}行 (month: ${result.month})`, 'ok');
    } catch (err) {
      sysLog(`  ${f.name} 保存失敗: ${err.message}`, 'error');
      throw err;
    }
  }
  sysLog(`DB保存完了: ${saved}/${readyFiles.length}ファイル`, 'ok');
  toast(`DB保存完了: ${saved}/${readyFiles.length}ファイル`, 'success');
  // 保存後、月一覧を更新
  refreshPastMonthList().catch(err => sysLog('月一覧の更新に失敗: ' + err.message, 'warn'));
}

/* ============================================================
   PAST DATA (DB)
   ============================================================ */
async function refreshPastMonthList() {
  try {
    const months = await getSavedMonths();
    els.pastMonthSelect.innerHTML = '<option value="">-- 月を選択 --</option>' +
      months.map(m =>
        `<option value="${m.month}">${m.month}（${m.file_count}ファイル / ${m.total_rows}行）</option>`
      ).join('');
    sysLog(`月一覧取得: ${months.length}件`, 'ok');
  } catch (err) {
    sysLog('月一覧の取得に失敗: ' + err.message, 'error');
    throw err;
  }
}

els.pastMonthSelect.addEventListener('change', () => {
  els.btnLoadPast.disabled = !els.pastMonthSelect.value;
});

els.btnLoadPast.addEventListener('click', async () => {
  const month = els.pastMonthSelect.value;
  if (!month) return;

  showLoading('LOADING...', `${month} のデータを取得中`);
  try {
    const { files, rows } = await loadMonthData(month);
    if (files.length === 0) {
      hideLoading();
      toast('データが見つかりません', 'warn');
      return;
    }

    // stateを再構築（DB行 → app用行フォーマット）
    const fileMap = {};
    files.forEach(f => { fileMap[f.id] = f; });

    state.files = files.map(f => ({
      file: null, name: f.filename, size: 0, status: 'ready', wb: null,
      rows: rows.filter(r => r.file_id === f.id)
        .map(r => ({
          brand: r.brand, category: r.category, agency: r.agency,
          media: r.media, plan: r.plan, note: r.note, amount: Number(r.amount) || 0,
          _colors: {}, _src: f.filename
        }))
    }));

    state.allRows = [];
    state.files.forEach(f => {
      f.rows.forEach(row => state.allRows.push({ ...row, _file: f.name }));
    });

    state.agencies = [];
    state.allRows.forEach(r => {
      if (r.agency && !state.agencies.includes(r.agency)) state.agencies.push(r.agency);
    });

    // ファイル名用: "2026-05" → "2026.5" (元の命名規則に合わせる)
    const [y, m] = month.split('-');
    const displayMonth = `${y}.${parseInt(m, 10)}`;
    // 保存時の folder_name があればそれを優先（アップロード時と同じファイル名になる）
    const savedFolderName = files[0]?.folder_name;
    const baseName = savedFolderName || `媒体管理表${displayMonth}`;

    state.folderName = `[DB] ${month}`;
    els.masterFileName.value = `【まとめ】${baseName}`;
    els.agencyFilePrefix.value = baseName;

    state.currentTab = 'all';
    state.searchQuery = '';
    state.sortCol = null;
    state.page = 1;

    els.rowCount.textContent = state.allRows.length;
    renderTabs();
    renderTable();
    renderExportPanel();

    els.uploadPanel.style.display = 'none';
    els.dataPanel.style.display = 'block';
    els.exportPanel.style.display = 'block';

    hideLoading();
    sysLog(`過去データ読み込み: ${month} / ${files.length}ファイル / ${state.allRows.length}行`, 'ok');
    toast(`${month} を読み込みました（${state.allRows.length}行）`, 'success');
  } catch (err) {
    hideLoading();
    sysLog('過去データ読み込み失敗: ' + err.message, 'error');
    toast('読み込み失敗: ' + err.message, 'error');
  }
});

// 初回ロード時に月一覧を取得
refreshPastMonthList().catch(() => {});

/* ============================================================
   TABS
   ============================================================ */
function renderTabs() {
  const nav = els.tabNav;
  // 全データ + 代理店タブ
  nav.innerHTML = `
    <button class="tab-btn ${state.currentTab === 'all' ? 'active' : ''}" data-tab="all">
      <span class="tab-icon">◈</span>全データ
    </button>
    ${state.agencies.map(ag => `
      <button class="tab-btn ${state.currentTab === ag ? 'active' : ''}" data-tab="${escHtml(ag)}">
        <span class="tab-icon">▷</span>${escHtml(ag)}
      </button>
    `).join('')}
  `;
  nav.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentTab = btn.dataset.tab;
      state.page = 1;
      renderTabs();
      renderTable();
    });
  });
}

/* ============================================================
   TABLE
   ============================================================ */
function renderTable() {
  const rows = filteredRows();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;

  const start = (state.page - 1) * state.pageSize;
  const slice = rows.slice(start, start + state.pageSize);

  els.tableBody.innerHTML = slice.map(r => `
    <tr>
      <td>${escHtml(r.brand)}</td>
      <td>${escHtml(r.category)}</td>
      <td>${escHtml(r.agency)}</td>
      <td>${escHtml(r.media)}</td>
      <td>${escHtml(r.plan)}</td>
      <td>${escHtml(r.note)}</td>
      <td class="p-amount">${fmtYen(r.amount)}</td>
    </tr>
  `).join('');

  // サマリー
  const viewRows = state.currentTab === 'all' ? state.allRows : state.allRows.filter(r => r.agency === state.currentTab);
  const totalAmount = viewRows.reduce((s,r) => s + (Number(r.amount)||0), 0);
  els.summaryTotal.textContent = viewRows.length.toLocaleString();
  els.summaryAgencies.textContent = state.agencies.length;
  els.summaryAmount.textContent = '¥' + totalAmount.toLocaleString();
  els.summaryView.textContent = state.currentTab === 'all' ? 'ALL' : state.currentTab;

  renderPagination(pages);

  // ヘッダーソートアイコン
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.col === state.sortCol) {
      icon.textContent = state.sortDir === 'asc' ? '↑' : '↓';
    } else {
      icon.textContent = '⇅';
      icon.style.opacity = '.4';
    }
    th.onclick = () => {
      if (state.sortCol === th.dataset.col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = th.dataset.col;
        state.sortDir = 'asc';
      }
      state.page = 1;
      renderTable();
    };
  });
}

function filteredRows() {
  let rows = state.currentTab === 'all'
    ? [...state.allRows]
    : state.allRows.filter(r => r.agency === state.currentTab);

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r =>
      Object.values(r).some(v => String(v).toLowerCase().includes(q))
    );
  }

  if (state.sortCol) {
    rows.sort((a, b) => {
      let va = a[state.sortCol], vb = b[state.sortCol];
      if (state.sortCol === 'amount') { va = Number(va); vb = Number(vb); }
      else { va = String(va||'').toLowerCase(); vb = String(vb||'').toLowerCase(); }
      if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  return rows;
}

function renderPagination(pages) {
  if (pages <= 1) { els.pagination.innerHTML = ''; return; }
  const btns = [];
  for (let i = 1; i <= pages; i++) {
    btns.push(`<button class="page-btn ${i===state.page?'active':''}" data-page="${i}">${i}</button>`);
  }
  els.pagination.innerHTML = btns.join('');
  els.pagination.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page);
      renderTable();
    });
  });
}

// 検索
els.searchInput.addEventListener('input', e => {
  state.searchQuery = e.target.value;
  state.page = 1;
  renderTable();
});

// 戻る
els.btnBack.addEventListener('click', () => {
  els.dataPanel.style.display = 'none';
  els.exportPanel.style.display = 'none';
  els.uploadPanel.style.display = 'block';
  // DB由来のデータから戻った場合はクリア（新規アップロードと混ざらないように）
  if (state.folderName && state.folderName.startsWith('[DB] ')) {
    clearFiles();
    state.allRows = [];
    state.agencies = [];
    els.rowCount.textContent = '0';
    els.pastMonthSelect.value = '';
    els.btnLoadPast.disabled = true;
  }
});

// DATA→EXPORT
els.btnToExport.addEventListener('click', () => {
  els.exportPanel.scrollIntoView({ behavior: 'smooth' });
});

/* ============================================================
   EXPORT PANEL
   ============================================================ */
function renderExportPanel() {
  els.agencyCheckboxes.innerHTML = state.agencies.map(ag => `
    <label class="agency-cb-label">
      <input type="checkbox" class="agency-export-cb" value="${escHtml(ag)}">
      <span>${escHtml(ag)}</span>
    </label>
  `).join('');

  els.btnSelectAll.onclick = () =>
    document.querySelectorAll('.agency-export-cb').forEach(cb => cb.checked = true);
  els.btnDeselectAll.onclick = () =>
    document.querySelectorAll('.agency-export-cb').forEach(cb => cb.checked = false);
}

/* ============================================================
   PREVIEW MODAL
   ============================================================ */
function showPreviewModal(type, agencies) {
  const overlay = document.createElement('div');
  overlay.id = 'previewModalOverlay';
  overlay.className = 'preview-overlay';

  const sheets = type === 'master'
    ? [
        ...(els.optAllSheet.checked ? [{ name:'全データ', rows: state.allRows }] : []),
        ...(els.optAgencySheets.checked
          ? state.agencies
              .filter(ag => state.allRows.some(r => r.agency === ag))
              .map(ag => ({ name: ag, rows: state.allRows.filter(r => r.agency === ag) }))
          : [])
      ]
    : agencies.map(ag => ({ name: ag, rows: state.allRows.filter(r => r.agency === ag) }));

  if (sheets.length === 0) {
    toast('出力するデータがありません', 'warn');
    return;
  }

  let currentSheet = 0;

  function renderSheetPreview() {
    const s = sheets[currentSheet];
    const rows = s.rows.slice(0, 100);
    const totalAmt = s.rows.reduce((sum,r) => sum + (Number(r.amount)||0), 0);
    document.getElementById('previewFooterInfo').textContent =
      s.rows.length > 100
        ? `表示: 100/${s.rows.length}行 (合計: ¥${totalAmt.toLocaleString()})`
        : `全${s.rows.length}行 (合計: ¥${totalAmt.toLocaleString()})`;

    document.getElementById('previewTableWrap').innerHTML = `
      <table class="preview-table">
        <thead><tr>
          <th>ブランド</th><th>カテゴリ</th><th>代理店</th>
          <th>媒体</th><th>プラン</th><th>備考</th><th>金額</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escHtml(r.brand)}</td>
              <td>${escHtml(r.category)}</td>
              <td>${escHtml(r.agency)}</td>
              <td>${escHtml(r.media)}</td>
              <td>${escHtml(r.plan)}</td>
              <td>${escHtml(r.note)}</td>
              <td class="p-amount">${fmtYen(r.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // タブ更新
    document.querySelectorAll('.preview-sheet-tab').forEach((t,i) => {
      t.classList.toggle('active', i === currentSheet);
    });
  }

  overlay.innerHTML = `
    <div class="preview-modal">
      <div class="preview-modal-header">
        <span class="preview-modal-title">⬡ EXPORT PREVIEW</span>
        <button class="preview-close" id="btnPreviewClose">✕ 閉じる</button>
      </div>
      <div class="preview-modal-body">
        <div class="preview-sheet-tabs">
          ${sheets.map((s,i) => `
            <button class="preview-sheet-tab ${i===0?'active':''}" data-idx="${i}">
              ${escHtml(s.name)} (${s.rows.length}行)
            </button>
          `).join('')}
        </div>
        <div class="preview-table-wrap" id="previewTableWrap"></div>
      </div>
      <div class="preview-modal-footer">
        <span id="previewFooterInfo"></span>
        <button class="hud-btn btn-primary" id="btnPreviewDownload">
          <span class="btn-icon">⬇</span>
          <span>ダウンロード実行</span>
          <span class="btn-glow"></span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  renderSheetPreview();

  overlay.querySelectorAll('.preview-sheet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentSheet = parseInt(tab.dataset.idx);
      renderSheetPreview();
    });
  });

  $('btnPreviewClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  $('btnPreviewDownload').addEventListener('click', () => {
    overlay.remove();
    if (type === 'master') downloadMaster();
    else downloadAgency(agencies);
  });
}

/* ============================================================
   EXCEL DOWNLOAD
   ============================================================ */

/**
 * 統合Excelを生成してダウンロード
 */
els.btnExportMaster.addEventListener('click', () => {
  if (!state.allRows.length) { toast('データがありません', 'warn'); return; }
  showPreviewModal('master', state.agencies);
});

async function downloadMaster() {
  showLoading('GENERATING...', 'Excelファイルを生成中');
  await new Promise(r => setTimeout(r, 200));
  try {
    const wb = XLSX.utils.book_new();
    const includeAll    = els.optAllSheet.checked;
    const includeAgency = els.optAgencySheets.checked;

    if (includeAll) {
      const ws = buildSheet(state.allRows);
      XLSX.utils.book_append_sheet(wb, ws, '全データ');
    }
    if (includeAgency) {
      state.agencies.forEach(ag => {
        const rows = state.allRows.filter(r => r.agency === ag);
        if (rows.length === 0) return;
        const ws = buildSheet(rows);
        const safeAg = ag.slice(0, 31).replace(/[\\/:?*[\]]/g,'_');
        XLSX.utils.book_append_sheet(wb, ws, safeAg);
      });
    }

    const fname = (els.masterFileName.value || '【まとめ】媒体管理表') + '.xlsx';
    await writeWorkbook(wb, fname);
    hideLoading();
    toast(`「${fname}」をダウンロードしました`, 'success');
    sysLog(`EXPORT MASTER: ${fname}`, 'ok');
  } catch(err) {
    hideLoading();
    toast('Excelの生成に失敗しました: ' + err.message, 'error');
    sysLog(`EXPORT ERROR: ${err.message}`, 'error');
  }
}

/**
 * 代理店別個別ファイルを生成・ダウンロード
 */
els.btnExportAgency.addEventListener('click', () => {
  const selected = [...document.querySelectorAll('.agency-export-cb:checked')].map(cb => cb.value);
  if (selected.length === 0) { toast('代理店を選択してください', 'warn'); return; }
  showPreviewModal('agency', selected);
});

async function downloadAgency(agencies) {
  showLoading('GENERATING...', 'Excelファイルを生成中');
  await new Promise(r => setTimeout(r, 200));
  try {
    let count = 0;
    for (const ag of agencies) {
      const rows = state.allRows.filter(r => r.agency === ag);
      if (rows.length === 0) continue;

      const wb = XLSX.utils.book_new();
      const ws = buildSheet(rows);
      const safeAg = ag.slice(0, 31).replace(/[\\/:?*[\]]/g,'_');
      XLSX.utils.book_append_sheet(wb, ws, safeAg);

      const prefix = els.agencyFilePrefix.value || '媒体管理表';
      const fname = `【${ag}】${prefix}.xlsx`;
      await writeWorkbook(wb, fname);
      count++;
      sysLog(`EXPORT: ${fname}`, 'ok');
    }
    hideLoading();
    toast(`${count}ファイルをダウンロードしました`, 'success');
  } catch(err) {
    hideLoading();
    toast('Excelの生成に失敗しました: ' + err.message, 'error');
    sysLog(`EXPORT ERROR: ${err.message}`, 'error');
  }
}

/**
 * Excelシートを生成（ヘッダー + データ + スタイル）
 * - ヘッダー行: 薄黄色背景・太字・中央・黒細罫線
 * - データ行: 原本の背景色をそのまま反映、黒細罫線
 * - 金額列: 通貨フォーマット・右寄せ
 */
function buildSheet(rows) {
  const COLS       = ['ブランド','カテゴリ','代理店','媒体','プラン','備考','金額'];
  const COL_WIDTHS = [16, 12, 18, 28, 32, 22, 14];

  /* ---- スタイル定義 ---- */
  const thinBlack = { style: 'thin', color: { rgb: '000000' } };
  const allBlack  = { top: thinBlack, bottom: thinBlack, left: thinBlack, right: thinBlack };

  // ヘッダースタイル
  const styleHeader = {
    fill: { fgColor: { rgb: 'FFF9C4' } },
    font: { bold: true, sz: 10, name: 'Meiryo UI' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
    border: allBlack,
  };

  /* ---- ワークシート組み立て ---- */
  const ws = {};

  // ヘッダー行 (row 0)
  COLS.forEach((label, ci) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
    ws[addr] = { v: label, t: 's', s: styleHeader };
  });

  // データ行 (row 1〜)
  rows.forEach((r, ri) => {
    const rowIdx = ri + 1;
    const dataArr = [r.brand, r.category, r.agency, r.media, r.plan, r.note, r.amount];

    dataArr.forEach((val, ci) => {
      const addr  = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
      const isAmt = ci === 6;

      // 原本の背景色を取得（なければ白）
      const srcRgb = (r._colors && r._colors[ci]) || null;
      const fillColor = srcRgb ? { rgb: srcRgb } : { rgb: 'FFFFFF' };

      const style = {
        fill: { fgColor: fillColor },
        font: { sz: 10, name: 'Meiryo UI' },
        alignment: isAmt
          ? { horizontal: 'right', vertical: 'center' }
          : { horizontal: 'left',  vertical: 'center' },
        border: allBlack,
        numFmt: isAmt ? '"¥"#,##0;[Red]-"¥"#,##0' : 'General',
      };

      if (isAmt) {
        ws[addr] = { v: Number(val) || 0, t: 'n', s: style };
      } else {
        ws[addr] = { v: String(val ?? ''), t: 's', s: style };
      }
    });
  });

  // シート範囲
  ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: rows.length, c: 6 });

  // 列幅
  ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }));

  // 行の高さ（ヘッダーを少し高く）
  ws['!rows'] = [{ hpt: 20 }];

  // オートフィルター
  ws['!autofilter'] = { ref: 'A1:G1' };

  return ws;
}

/* ============================================================
   WRITE HELPER — スタイル付き＋ウィンドウ枠固定で書き出す
   JSZip で xlsx バイナリを開き、sheet XML に直接 <pane> を注入する。
   ============================================================ */
async function writeWorkbook(wb, fname) {
  // 1. xlsx-js-style でバイナリ生成（ArrayBuffer）
  const wbout = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });

  // 2. JSZip で ZIP を開く
  const zip = await JSZip.loadAsync(wbout);

  // 3. 各シートの XML にウィンドウ枠固定を注入
  const sheetPaths = Object.keys(zip.files)
    .filter(p => /xl\/worksheets\/sheet\d+\.xml$/.test(p));

  for (const path of sheetPaths) {
    let xml = await zip.files[path].async('string');

    // すでに <pane> があればスキップ
    if (xml.includes('<pane ')) { zip.file(path, xml); continue; }

    const paneXml =
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';

    if (xml.includes('</sheetView>')) {
      // パターンA: </sheetView> 閉じタグあり → 直前に挿入
      xml = xml.replace(/<\/sheetView>/g, paneXml + '</sheetView>');
    } else {
      // パターンB: <sheetView .../> 自己閉じ（xlsx-js-styleの出力形式）
      xml = xml.replace(/<sheetView\b([^>]*)\/>/g,
        (_, attrs) => `<sheetView${attrs}>${paneXml}</sheetView>`);
    }

    zip.file(path, xml);
  }

  // 4. 修正済みバイナリをBlobとして生成 → ダウンロード
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* ============================================================
   UTILITIES
   ============================================================ */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function fmtYen(val) {
  const n = Number(val) || 0;
  return '¥' + n.toLocaleString('ja-JP');
}

// 起動ログ
sysLog('MEDIA-MGR v2.0 INITIALIZED', 'ok');
sysLog('フォルダまたはExcelファイルをドロップしてください', 'info');
