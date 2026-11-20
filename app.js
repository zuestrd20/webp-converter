'use strict';
const qualities = [80, 50, 30, 10];
const maxSize = 25 * 1024 * 1024, maxPixels = 24_000_000, maxEdge = 8192;
const supported = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const sizeText = n => n < 1024 ? n + ' B' : n < 1024 ** 2
  ? (n / 1024).toFixed(1) + ' KiB' : (n / 1024 ** 2).toFixed(2) + ' MiB';
const changeText = (n, original) => {
  const change = (n - original) / original * 100;
  return Math.abs(change) < .1 ? '與原檔大小相近'
    : '比原檔' + (change < 0 ? '小 ' : '大 ') + Math.abs(change).toFixed(1) + '%';
};
function validateFile(file) {
  if (!file || !supported.test(file.name)) throw Error('請選擇 JPG、PNG、WebP、GIF、BMP 或 AVIF 圖片。');
  if (!file.size) throw Error('這個檔案是空的，請換一張圖片。');
  if (file.size > maxSize) throw Error('檔案超過 25 MiB，請換一張較小的圖片。');
}
function validateDimensions(w, h) {
  if (!w || !h || w * h > maxPixels || w > maxEdge || h > maxEdge)
    throw Error('圖片太大或尺寸無效。上限為 2,400 萬像素，單邊不超過 8,192 像素。');
}
function encode(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/webp' || !blob.size)
        reject(Error('這個瀏覽器無法編碼 WebP，請用新版 Chrome、Edge 或 Firefox 重試。'));
      else resolve(blob);
    }, 'image/webp', quality / 100);
  });
}
function downloadName(filename, quality) {
  const stem = filename.replace(supported, '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim().slice(0, 110);
  return (stem || 'image') + '-webp-' + quality + '.webp';
}
function init(doc) {
  const $ = s => doc.querySelector(s);
  const fileInput = $('#file'), drop = $('#drop'), original = $('#original'), choose = $('#choose'),
    convert = $('#convert'), status = $('#status');
  const cards = qualities.map(q => doc.querySelector('[data-quality="' + q + '"]'));
  let selected, sourceURL, resultURLs = [], serial = 0, busy = false, frame;
  const zoom = $('#zoom');
  const previews = [{box:drop, img:original}, ...cards.map(card => ({box:card.querySelector('.frame'), img:card.querySelector('img')}))];
  let anchor = [0, 0];
  const programmed = new WeakMap();
  function matchScroll(except) {
    for (const {box,img} of previews) {
      if (box === except || img.hidden || zoom.value === 'fit') continue;
      const x = Math.min(anchor[0], Math.max(0, box.scrollWidth - box.clientWidth));
      const y = Math.min(anchor[1], Math.max(0, box.scrollHeight - box.clientHeight));
      if (box.scrollLeft !== x || box.scrollTop !== y) {
        box.scrollLeft = x; box.scrollTop = y;
        programmed.set(box, [box.scrollLeft, box.scrollTop]);
      }
    }
  }
  let lastScale = 0;
  function updateZoom() {
    const scale = selected && zoom.value !== 'fit' ? Number(zoom.value) / 100 : 0;
    if (scale !== lastScale) {
      anchor = scale && lastScale ? anchor.map(value => value * scale / lastScale) : [0, 0];
      lastScale = scale;
    }
    for (const {box,img} of previews) {
      const enabled = Boolean(scale && !img.hidden);
      box.classList.toggle('zoomed', enabled);
      img.style.width = enabled ? Math.round(selected.width * scale) + 'px' : '';
      img.style.height = enabled ? Math.round(selected.height * scale) + 'px' : '';
    }
    matchScroll();
  }
  zoom.addEventListener('change', updateZoom);
  for (const {box,img} of previews) box.addEventListener('scroll', () => {
    if (img.hidden || zoom.value === 'fit') return;
    const x = box.scrollLeft, y = box.scrollTop, previous = programmed.get(box);
    programmed.delete(box);
    if (previous && previous[0] === x && previous[1] === y) return;
    if (box.scrollWidth > box.clientWidth) anchor[0] = x;
    if (box.scrollHeight > box.clientHeight) anchor[1] = y;
    matchScroll(box);
  });
  function message(text, err = false) { status.textContent = text; status.classList.toggle('error', err); }
  function clearResults() {
    for (const url of resultURLs) URL.revokeObjectURL(url);
    resultURLs = [];
    for (const card of cards) {
      const img = card.querySelector('img'), link = card.querySelector('a');
      img.hidden = true; img.removeAttribute('src'); link.hidden = true; link.removeAttribute('href');
      card.querySelector('.await').hidden = false; card.querySelector('.size').textContent = '尚無結果';
      card.querySelector('.change').textContent = '';
    }
    updateZoom();
  }
  function clearSource() {
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    if (frame && typeof frame.close === 'function') frame.close();
    sourceURL = frame = selected = undefined;
    original.removeAttribute('src'); original.hidden = true;
    $('#placeholder').hidden = false; $('#details').hidden = true; convert.disabled = true;
    zoom.value = 'fit'; zoom.disabled = true; updateZoom();
  }
  async function select(files) {
    const ticket = ++serial; busy = false; clearSource(); clearResults();
    let url, decoded;
    try {
      if (files.length !== 1) throw Error('一次只轉換一張圖片。');
      const file = files[0]; validateFile(file);
      message('正在讀取原圖…');
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      try { await image.decode(); } catch { throw Error('無法讀取這張圖片。格式可能不受瀏覽器支援，或檔案已損壞。'); }
      validateDimensions(image.naturalWidth, image.naturalHeight);
      // Decode to a fixed frame early so all three output variants use the same pixels.
      if (typeof createImageBitmap === 'function') {
        try { decoded = await createImageBitmap(image); } catch { /* drawing the decoded image remains possible */ }
      }
      if (ticket !== serial) return;
      sourceURL = url; url = undefined; frame = decoded || image; decoded = undefined;
      selected = {file, width: image.naturalWidth, height: image.naturalHeight};
      original.src = sourceURL; original.hidden = false; $('#placeholder').hidden = true;
      $('#filename').textContent = file.name;
      $('#metadata').textContent = selected.width + ' × ' + selected.height + ' 像素 · ' + sizeText(file.size);
      $('#details').hidden = false; convert.disabled = false; zoom.disabled = false; updateZoom();
      message('原圖已就緒，按「轉換成 WebP」開始。');
    } catch (err) { if (ticket === serial) message(err.message, true); }
    finally { if (typeof decoded?.close === 'function') decoded.close(); if (url) URL.revokeObjectURL(url); }
  }
  async function convertImage() {
    if (!selected || busy) return;
    const ticket = serial, {file,width,height} = selected;
    busy = true; convert.disabled = true; clearResults(); message('正在轉換四種 WebP…');
    const canvas = doc.createElement('canvas');
    try {
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('無法開始轉換。請重新開啟頁面或換一張較小的圖片。');
      ctx.drawImage(frame, 0, 0, width, height);
      const blobs = [];
      for (const quality of qualities) {
        blobs.push(await encode(canvas, quality));
        if (ticket !== serial) return;
      }
      resultURLs = blobs.map(blob => URL.createObjectURL(blob));
      cards.forEach((card, i) => {
        const img = card.querySelector('img'), link = card.querySelector('a');
        img.src = resultURLs[i]; img.hidden = false;
        card.querySelector('.await').hidden = true;
        card.querySelector('.size').textContent = sizeText(blobs[i].size);
        card.querySelector('.change').textContent = changeText(blobs[i].size, file.size);
        link.href = resultURLs[i]; link.download = downloadName(file.name, qualities[i]); link.hidden = false;
        link.setAttribute('aria-label', '下載 WebP 品質 ' + qualities[i] + '%');
      });
      updateZoom();
      message('已完成 80%、50%、30%、10% 四種品質，可預覽與下載。');
    } catch (err) { if (ticket === serial) message('轉換未完成：' + err.message, true); }
    finally {
      canvas.width = canvas.height = 0;
      if (ticket === serial) { busy = false; convert.disabled = false; }
    }
  }
  choose.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files.length) void select(Array.from(fileInput.files)); fileInput.value = ''; });
  convert.addEventListener('click', convertImage);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files.length) void select(Array.from(e.dataTransfer.files)); });
  window.addEventListener('pagehide', e => { if (!e.persisted) { serial++; clearSource(); clearResults(); } });
}
if (typeof module !== 'undefined') module.exports = {sizeText, changeText, validateFile, validateDimensions, downloadName, encode, qualities};
if (typeof document !== 'undefined') init(document);
