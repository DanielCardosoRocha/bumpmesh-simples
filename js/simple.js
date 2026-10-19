/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * Modificado em 2026 por Daniel Cardoso Rocha (versão simplificada)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Modo simples: uma tela com poucos controles por cima do BumpMesh original.
//
// Nada do motor foi reescrito. Este arquivo esconde os controles avançados,
// reorganiza o painel e liga cada controle simples aos campos originais
// (mudando o valor e disparando o mesmo evento que o usuário dispararia).
// Assim o main.js continua igual ao do CNC Kitchen e atualizações do
// repositório original entram sem conflito.

const SOURCE_URL  = 'https://github.com/DanielCardosoRocha/bumpmesh-simples';
const ORIGIN_URL  = 'https://github.com/CNCKitchen/stlTexturizer';

import { setSceneBackground } from './viewer.js';

const $ = (id) => document.getElementById(id);

// Ângulo usado para "não texturizar" topo/base (o padrão do original para a base).
const MASK_ANGLE = 5;

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

  // ── 1. Peça ──
  const loadHeading = document.createElement('h2');
  loadHeading.textContent = 'Peça';
  firstSection.prepend(loadHeading);

  // ── 2. Textura (galeria de favoritos + botão da galeria completa) ──
  const textureSection = section('Textura', $('preset-grid'), $('texture-gallery-btn'));

  // ── 3. Formato da peça ──
  const mapping = $('mapping-mode');
  const currentShape = mapping.value === SHAPES.redonda ? 'redonda' : 'reta';
  const shape = segmented({ redonda: 'Redonda', reta: 'Reta / caixa' }, currentShape, (value) => {
    setInput(mapping, SHAPES[value]);
    // Para vasos e copos, ajusta o eixo do cilindro ao centro real da peça.
    if (value === 'redonda') $('cylinder-autofit-btn')?.click();
  });
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
  let quality = 'normal';
  const qualitySeg = segmented({ leve: 'Leve', normal: 'Normal', detalhado: 'Detalhado' }, quality, (value) => {
    quality = value;
    applyQuality();
  });
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

  const topSlider = $('top-angle-limit');
  const bottomSlider = $('bottom-angle-limit');
  const top = checkbox('Texturizar o topo', Number(topSlider.value) === 0,
    (on) => setInput(topSlider, on ? 0 : MASK_ANGLE, 'input'));
  const bottomWarning = note('A base com textura pode reduzir a aderência na mesa.', 'sm-warning');
  const bottom = checkbox('Texturizar a base', Number(bottomSlider.value) === 0, (on) => {
    setInput(bottomSlider, on ? 0 : MASK_ANGLE, 'input');
    bottomWarning.hidden = !on;
  });
  bottomWarning.hidden = !bottom.input.checked;

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
  const sync = () => {
    shape.select(mapping.value === SHAPES.redonda ? 'redonda' : 'reta');
    top.input.checked = Number(topSlider.value) === 0;
    bottom.input.checked = Number(bottomSlider.value) === 0;
    bottomWarning.hidden = !bottom.input.checked;
  };
  for (const id of ['undo-btn', 'redo-btn']) $(id)?.addEventListener('click', () => setTimeout(sync, 0));
  window.addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey) setTimeout(sync, 0); });

  // ── Qualidade ligada à resolução e ao limite de triângulos do original ──
  const refineVal = $('refine-length-val');
  const maxTri = $('max-triangles');
  let baseEdge = Number(refineVal.value) || 1;
  let lastApplied = null;

  function applyQuality() {
    const q = QUALITY[quality];
    const edge = Math.max(0.05, Math.min(5, +(baseEdge * q.edge).toFixed(2)));
    lastApplied = String(edge);
    setInput(refineVal, edge);
    setInput(maxTri, q.tris, 'input');
  }

  // A cada peça carregada o original recalcula a resolução para o tamanho dela.
  // Esse valor vira a base, e a qualidade escolhida é aplicada por cima.
  new MutationObserver(() => {
    if (refineVal.value !== lastApplied) {
      baseEdge = Number(refineVal.value) || baseEdge;
      applyQuality();
    }
  }).observe($('mesh-info'), { childList: true, characterData: true, subtree: true });

  // Garante a qualidade escolhida no momento de baixar (antes do handler original).
  $('export-btn').addEventListener('click', () => {
    if (refineVal.value !== lastApplied) applyQuality();
  }, { capture: true });

  applyQuality();
}

buildPanel();
// Fundo do 3D no creme da plataforma (o original usa um cinza azulado).
setSceneBackground(0xfaf6ee);
