// offscreen.js — 在普通文档环境把内容转成 data: URL(service worker 没有 FileReader)
'use strict';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.cmd !== 'toDataUrl') return;
  (async () => {
    try {
      const p = msg.payload || {};
      let blob;
      if (p.kind === 'text') {
        blob = new Blob([p.text ?? ''], { type: (p.mime || 'text/plain') + ';charset=utf-8' });
      } else if (p.kind === 'b64') {
        blob = new Blob([b64ToBytes(p.b64 || '')], { type: p.mime || 'application/octet-stream' });
      } else {
        throw new Error('unknown kind');
      }
      const url = await blobToDataUrl(blob);
      sendResponse(url);
    } catch (e) {
      // 出错时返回一个文本 data URL,避免下载完全失败
      sendResponse('data:text/plain;base64,' + btoa('export error: ' + String(e)));
    }
  })();
  return true;
});
