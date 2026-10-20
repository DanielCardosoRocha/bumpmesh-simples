/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * Modificado em 2026 por Daniel Cardoso Rocha (versão simplificada)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Modo simples: poucos controles por cima do BumpMesh original.
//
// Nada do motor foi reescrito. Cada controle simples muda o campo original
// correspondente e dispara o mesmo evento que o usuário dispararia, então o
// main.js continua igual ao do CNC Kitchen e atualizações do repositório
// original entram sem conflito.
//
// Dois jeitos de usar:
//   index.html          painel simples ao lado do 3D (página sozinha)
//   index.html?embed=1  só o 3D; quem embute manda comandos e recebe o estado
//                       por postMessage (veja "Modo embutido" no fim)

import { setSceneBackground } from './viewer.js';
import { IMAGE_PRESETS, PRESET_CATEGORIES, DEFAULT_FAVOURITES } from './presetTextures.js';

const SOURCE_URL  = 'https://github.com/DanielCardosoRocha/bumpmesh-simples';
const ORIGIN_URL  = 'https://github.com/CNCKitchen/stlTexturizer';

const $ = (id) => document.getElementById(id);

// Ângulo usado para "não texturizar" topo/base (o padrão do original para a base).
const MASK_ANGLE = 5;

// Marca na sessão: os padrões desta versão já foram aplicados nesta aba.
const DEFAULTS_KEY = 'bumpmesh-simples-defaults';

// Qualidade: multiplica a resolução que o original calcula para cada peça
// (1/250 da diagonal) e define o limite de triângulos do arquivo final.
const QUALITY = {
  leve:      { edge: 1.6, tris: 400_000 },
  normal:    { edge: 1.0, tris: 750_000 },
  detalhado: { edge: 0.6, tris: 1_500_000 },
};

// Projeção do original: 3 = cilíndrica, 5 = triplanar.
const SHAPES = { redonda: '3', reta: '5' };

function setInput(el, value, event = 'change') {
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

function setFile(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const isHidden = (el) => !el || el.classList.contains('hidden');

// ── Avisos de mudança ────────────────────────────────────────────────────────
// Qualquer mudança no estado (campo, peça carregada, textura, exportação)
// avisa os ouvintes uma vez, agrupada.

const listeners = new Set();
let notifyTimer = 0;
function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => { for (const fn of listeners) fn(); }, 30);
}

// ── Comandos ─────────────────────────────────────────────────────────────────

let app = null;   // { selectPreset, activeMapName } vindos do main.js
let quality = 'normal';
let baseEdge = 1;
let lastApplied = null;

function applyQuality() {
  const q = QUALITY[quality];
  const edge = Math.max(0.05, Math.min(5, +(baseEdge * q.edge).toFixed(2)));
  lastApplied = String(edge);
  setInput($('refine-length-val'), edge);
  setInput($('max-triangles'), q.tris, 'input');
}

const controls = {
  setShape(value) {
    if (!SHAPES[value]) return;
    setInput($('mapping-mode'), SHAPES[value]);
    // Para vasos e copos, ajusta o eixo do cilindro ao centro real da peça.
    if (value === 'redonda') $('cylinder-autofit-btn')?.click();
  },
  setQuality(value) {
    if (!QUALITY[value]) return;
    quality = value;
    applyQuality();
  },
  setAmplitude(mm) { if (Number.isFinite(mm)) setInput($('amplitude-val'), mm); },
  setScale(mm)     { if (Number.isFinite(mm) && mm > 0) setInput($('scale-u-val'), mm); },
  setSeam(v)       { if (Number.isFinite(v)) setInput($('seam-band-width-val'), v); },
  setRotation(deg) { if (Number.isFinite(deg)) setInput($('rotation-val'), deg); },
  setTop(on)    { setInput($('top-angle-limit'), on ? 0 : MASK_ANGLE, 'input'); },
  setBottom(on) { setInput($('bottom-angle-limit'), on ? 0 : MASK_ANGLE, 'input'); },
  setPreview(on) {
    const box = $('displacement-preview');
    if (box.checked === !!on) return;
    box.checked = !!on;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  },
  loadModel(file)   { if (file instanceof File) setFile($('stl-file-input'), file); },
  loadTexture(file) { if (file instanceof File) setFile($('texture-file-input'), file); },
  async selectTexture(name) {
    const idx = IMAGE_PRESETS.findIndex((p) => p.name === name);
    if (idx < 0) return;
    await app.selectPreset(idx);
    notify();
  },
  exportStl() {
    const btn = $('export-btn');
    if (!btn.disabled) btn.click();
  },

  // ── Onde aplicar: textura só em parte da peça ──
  // 'all' = peça toda; 'include' = só onde marcar; 'exclude' = menos onde marcar.
  // Os botões originais de modo já ligam o balde quando não há ferramenta.
  setMaskMode(mode) {
    if (mode === 'all') {
      if (isActive($('excl-mode-include'))) $('excl-mode-exclude').click();
      $('excl-clear-btn').click();
      controls.setTool(null);
      erase = false;
      app.setErase(false);
    } else if (mode === 'include') {
      $('excl-mode-include').click();
    } else if (mode === 'exclude') {
      $('excl-mode-exclude').click();
    }
    maskMode = mode;
  },
  /** 'bucket' (face inteira), 'brush' (pincel) ou null (só girar a peça). */
  setTool(tool) {
    const current = activeTool();
    if (current === tool) return;
    // Clicar no botão da ferramenta ativa desliga; no outro, troca.
    if (tool === null) $(`excl-${current}-btn`)?.click();
    else $(`excl-${tool}-btn`).click();
  },
  setBrushSize(mm) { if (Number.isFinite(mm) && mm > 0) setInput($('excl-brush-radius-val'), mm); },
  setErase(on) {
    erase = !!on;
    app.setErase(erase);
  },
  clearMask() { $('excl-clear-btn').click(); },
};

const isActive = (el) => !!el && el.classList.contains('active');

function activeTool() {
  if (isActive($('excl-brush-btn'))) return 'brush';
  if (isActive($('excl-bucket-btn'))) return 'bucket';
  return null;
}

let maskMode = null;   // definido na primeira leitura (pode vir da sessão salva)
let erase = false;

function readState() {
  return {
    info: $('mesh-info').textContent,
    texture: app.activeMapName(),
    shape: $('mapping-mode').value === SHAPES.redonda ? 'redonda' : 'reta',
    quality,
    amplitude: Number($('amplitude-val').value),
    scale: Number($('scale-u-val').value),
    seam: Number($('seam-band-width-val').value),
    rotation: Number($('rotation-val').value),
    top: Number($('top-angle-limit').value) === 0,
    bottom: Number($('bottom-angle-limit').value) === 0,
    preview: $('displacement-preview').checked,
    canExport: !$('export-btn').disabled,
    exporting: !isHidden($('export-progress')),
    progress: parseFloat($('export-progress-bar').style.width) || 0,
    progressLabel: $('export-progress-label').textContent,
    amplitudeWarning: !isHidden($('amplitude-warning')),
    // Resultado da checagem rápida da malha ("✔ A malha parece boa" ou o problema).
    meshCheck: isHidden($('mesh-diagnostics')) ? null : $('mesh-diag-fast').textContent.trim() || null,
    maskMode: maskMode ?? (isActive($('excl-mode-include')) ? 'include' : 'all'),
    tool: activeTool(),
    brushSize: Number($('excl-brush-radius-val').value),
    erase,
    /** "12 faces selecionadas" / "3 faces mascaradas" */
    maskCount: $('excl-count').textContent.trim(),
  };
}

function watchChanges() {
  const panel = $('settings-panel');
  panel.addEventListener('input', notify);
  panel.addEventListener('change', notify);
  window.addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey) notify(); });

  const observe = (el, opts) => el && new MutationObserver(notify).observe(el, opts);
  observe($('export-progress'), { attributes: true, childList: true, characterData: true, subtree: true });
  observe($('export-btn'), { attributes: true, attributeFilter: ['disabled'] });
  observe($('amplitude-warning'), { attributes: true, attributeFilter: ['class'] });
  observe($('mesh-diagnostics'), { attributes: true, childList: true, characterData: true, subtree: true });
  // A textura ativa é marcada na grade de favoritos (inclusive a escolhida no início).
  observe($('preset-grid'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  // Marcação: ferramenta e modo ativos, contagem de faces marcadas.
  for (const id of ['excl-brush-btn', 'excl-bucket-btn', 'excl-mode-include', 'excl-mode-exclude']) {
    observe($(id), { attributes: true, attributeFilter: ['class'] });
  }
  observe($('excl-count'), { childList: true, characterData: true, subtree: true });
  // Shift no teclado também apaga; ao soltar, volta ao que o botão diz.
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift' && erase) app.setErase(true); });

  // A cada peça carregada o original recalcula a resolução para o tamanho dela.
  // Esse valor vira a base, e a qualidade escolhida é aplicada por cima.
  new MutationObserver(() => {
    const refine = $('refine-length-val');
    if (refine.value !== lastApplied) {
      baseEdge = Number(refine.value) || baseEdge;
      applyQuality();
    }
    notify();
  }).observe($('mesh-info'), { childList: true, characterData: true, subtree: true });

  // Garante a qualidade escolhida no momento de baixar (antes do handler original).
  $('export-btn').addEventListener('click', () => {
    if ($('refine-length-val').value !== lastApplied) applyQuality();
  }, { capture: true });
}

// ── Painel simples (página sozinha) ──────────────────────────────────────────

function setLabel(el, text, title) {
  if (!el) return;
  el.removeAttribute('data-i18n');
  el.removeAttribute('data-i18n-title');
  el.textContent = text;
  if (title) el.title = title; else el.removeAttribute('title');
}

function section(title, ...children) {
  const s = document.createElement('section');
  s.className = 'panel-section sm-section';
  const h = document.createElement('h2');
  h.textContent = title;
  s.append(h, ...children);
  return s;
}

function segmented(options, current, onPick) {
  const seg = document.createElement('div');
  seg.className = 'excl-seg sm-seg';
  seg.setAttribute('role', 'group');
  const buttons = Object.entries(options).map(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'excl-seg-btn';
    b.textContent = label;
    b.dataset.value = value;
    b.addEventListener('click', () => { select(value); onPick(value); });
    seg.appendChild(b);
    return b;
  });
  function select(value) {
    for (const b of buttons) {
      const on = b.dataset.value === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  select(current);
  return { el: seg, select };
}

function checkbox(text, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'form-row';
  const label = document.createElement('label');
  label.className = 'checkbox-label';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  row.appendChild(label);
  return { row, input };
}

function note(text, extraClass = '') {
  const p = document.createElement('p');
  p.className = `sm-note ${extraClass}`.trim();
  p.textContent = text;
  return p;
}

function buildPanel() {
  const panel = $('settings-panel');
  const firstSection = panel.querySelector('.panel-section');   // Carregar modelo
  const state = readState();

  // ── 1. Peça ──
  const loadHeading = document.createElement('h2');
  loadHeading.textContent = 'Peça';
  firstSection.prepend(loadHeading);

  // ── 2. Textura (galeria de favoritos + botão da galeria completa) ──
  const textureSection = section('Textura', $('preset-grid'), $('texture-gallery-btn'));

  // ── 3. Formato da peça ──
  const shape = segmented({ redonda: 'Redonda', reta: 'Reta / caixa' }, state.shape, controls.setShape);
  const shapeSection = section('Formato da peça', shape.el,
    note('Redonda: vasos, copos, cilindros. Reta: caixas, suportes e o resto.'));

  // ── 4. Ajustes: profundidade e tamanho ──
  const amplitudeRow = $('amplitude').closest('.form-row');
  setLabel(amplitudeRow.querySelector('label'), 'Profundidade (mm)',
    'Quanto a textura sobe da superfície da peça.');
  const scaleRow = $('scale-u').closest('.form-row');
  setLabel(scaleRow.querySelector('label'), 'Tamanho da textura (mm)',
    'Tamanho de cada repetição do desenho. Menor = padrão mais miúdo.');
  const adjustSection = section('Ajustes', amplitudeRow, scaleRow, $('amplitude-warning'));

  // ── 5. Qualidade + exportar ──
  const qualitySeg = segmented({ leve: 'Leve', normal: 'Normal', detalhado: 'Detalhado' }, quality, controls.setQuality);
  const exportSection = $('export-btn').closest('.panel-section');
  setLabel(exportSection.querySelector('h2'), 'Qualidade');
  exportSection.querySelector('h2').after(qualitySeg.el,
    note('Leve: arquivo menor, abre rápido no fatiador. Detalhado: mais definição, arquivo maior.'));
  setLabel($('export-btn'), 'Baixar STL');

  // ── Avançado ──
  const advanced = document.createElement('details');
  advanced.className = 'panel-section sm-advanced';
  const summary = document.createElement('summary');
  summary.textContent = 'Avançado';
  advanced.appendChild(summary);

  const seamRow = $('seam-band-width').closest('.form-row');
  setLabel(seamRow.querySelector('label'), 'Suavizar emendas',
    'Disfarça as linhas onde os lados da textura se encontram.');

  const rotationRow = $('rotation').closest('.form-row');
  setLabel(rotationRow.querySelector('label'), 'Girar textura (°)');

  const uploadLabel = document.querySelector('label[for="texture-file-input"]');
  setLabel(uploadLabel.querySelector('span'), 'Usar minha imagem');
  const uploadRow = document.createElement('div');
  uploadRow.className = 'map-actions';
  uploadRow.appendChild(uploadLabel);

  const top = checkbox('Texturizar o topo', state.top, controls.setTop);
  const bottomWarning = note('A base com textura pode reduzir a aderência na mesa.', 'sm-warning');
  const bottom = checkbox('Texturizar a base', state.bottom, controls.setBottom);
  bottomWarning.hidden = !state.bottom;

  const previewRow = $('displacement-preview').closest('.form-row');
  setLabel(previewRow.querySelector('label span'), 'Prévia 3D real (mais pesada)');
  previewRow.querySelector('label').removeAttribute('data-i18n-title');
  previewRow.querySelector('label').title = 'Mostra o relevo de verdade na tela. Pode ficar lento em peças grandes ou no celular.';

  advanced.append(seamRow, rotationRow, uploadRow, $('custom-map-row'),
    top.row, bottom.row, bottomWarning, previewRow);

  // ── Ordem final do painel ──
  firstSection.after(textureSection);
  textureSection.after(shapeSection);
  shapeSection.after(adjustSection);
  adjustSection.after(exportSection);
  exportSection.after(advanced);

  // ── Rodapé: crédito e código-fonte (exigência da licença AGPL) ──
  const footer = document.createElement('p');
  footer.className = 'sm-footer';
  footer.innerHTML =
    `Baseado no <a href="${ORIGIN_URL}" target="_blank" rel="noopener">BumpMesh</a>, ` +
    `da <a href="https://www.youtube.com/@CNCKitchen" target="_blank" rel="noopener">CNC Kitchen</a>. ` +
    `<a href="${SOURCE_URL}" target="_blank" rel="noopener">Código-fonte</a> · ` +
    `<a href="${SOURCE_URL}/blob/main/LICENSE" target="_blank" rel="noopener">Licença AGPL-3.0</a>`;
  advanced.after(footer);

  // Mantém os controles simples em dia quando o original muda os valores
  // (desfazer, restauração da sessão).
  listeners.add(() => {
    const s = readState();
    shape.select(s.shape);
    top.input.checked = s.top;
    bottom.input.checked = s.bottom;
    bottomWarning.hidden = !s.bottom;
  });
}

// ── Modo embutido ────────────────────────────────────────────────────────────
// A página que embute (mesma origem) manda { source: 'tc-texturizador', type, value }
// e recebe { source: 'bumpmesh', type: 'ready' | 'state', ... }.
//
//   hello                    pede o 'ready' de novo (lista de texturas + estado)
//   model / texture-file     value: File
//   texture                  value: nome da textura (IMAGE_PRESETS[].name)
//   shape                    'redonda' | 'reta'
//   quality                  'leve' | 'normal' | 'detalhado'
//   amplitude / scale        mm
//   seam / rotation          0–1 / graus
//   top / bottom / preview   boolean
//   export                   baixa o STL
//   mask-mode                'all' | 'include' | 'exclude' (onde aplicar)
//   tool                     'bucket' | 'brush' | null (marcar faces no 3D)
//   brush-size               mm (diâmetro do pincel)
//   erase                    boolean (marcar apaga em vez de marcar)
//   mask-clear               limpa a marcação

const COMMANDS = {
  model: (v) => controls.loadModel(v),
  'texture-file': (v) => controls.loadTexture(v),
  texture: (v) => controls.selectTexture(v),
  shape: (v) => controls.setShape(v),
  quality: (v) => controls.setQuality(v),
  amplitude: (v) => controls.setAmplitude(Number(v)),
  scale: (v) => controls.setScale(Number(v)),
  seam: (v) => controls.setSeam(Number(v)),
  rotation: (v) => controls.setRotation(Number(v)),
  top: (v) => controls.setTop(!!v),
  bottom: (v) => controls.setBottom(!!v),
  preview: (v) => controls.setPreview(!!v),
  export: () => controls.exportStl(),
  'mask-mode': (v) => controls.setMaskMode(v),
  tool: (v) => controls.setTool(v ?? null),
  'brush-size': (v) => controls.setBrushSize(Number(v)),
  erase: (v) => controls.setErase(!!v),
  'mask-clear': () => controls.clearMask(),
};

function initEmbed() {
  const host = window.parent;
  if (host === window) return;
  const post = (msg) => host.postMessage({ source: 'bumpmesh', ...msg }, location.origin);
  const sendReady = () => post({
    type: 'ready',
    presets: IMAGE_PRESETS.map((p) => ({
      name: p.name,
      thumb: new URL(p.thumb, location.href).pathname,
      category: p.category,
      credit: p.credit ?? null,
    })),
    categories: PRESET_CATEGORIES.map((c) => c.id),
    favourites: DEFAULT_FAVOURITES,
    state: readState(),
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== host) return;
    const m = e.data;
    if (!m || m.source !== 'tc-texturizador') return;
    if (m.type === 'hello') { sendReady(); return; }
    const run = COMMANDS[m.type];
    if (!run) return;
    Promise.resolve(run(m.value)).catch((err) => console.error('[embed]', m.type, err));
    notify();
  });

  listeners.add(() => post({ type: 'state', state: readState() }));
  sendReady();
}

export function initSimple(appApi) {
  app = appApi;
  const embedded = new URLSearchParams(location.search).has('embed');
  if (embedded) document.body.classList.add('embed-mode');

  // Padrão desta versão: textura no topo e na base. Aplicado uma vez por aba;
  // depois vale o que a pessoa deixou (o original guarda os ajustes na sessão
  // do navegador, e já salva durante a inicialização, por isso a marca própria).
  let applied = false;
  try { applied = sessionStorage.getItem(DEFAULTS_KEY) === '1'; } catch { /* modo privado */ }
  if (!applied) {
    controls.setTop(true);
    controls.setBottom(true);
    try { sessionStorage.setItem(DEFAULTS_KEY, '1'); } catch { /* modo privado */ }
  }

  baseEdge = Number($('refine-length-val').value) || 1;
  watchChanges();
  if (!embedded) buildPanel();
  applyQuality();

  // Fundo do 3D no creme da plataforma (o original usa um cinza azulado).
  setSceneBackground(0xfaf6ee);

  if (embedded) initEmbed();
}
