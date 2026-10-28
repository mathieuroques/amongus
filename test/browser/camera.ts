// Caméra simulée pour Chromium : une vidéo Y4M qui montre un vrai QR code.
// Le navigateur la diffuse comme une webcam (--use-file-for-fake-video-capture) : le lecteur de
// l'application (jsQR, BarcodeDetector étant absent sous Linux) doit donc réellement décoder l'image.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const { chromium } = require('playwright');
const dir = mkdtempSync(join(tmpdir(), 'imposteurs-cam-'));
let n = 0;

/** Écrit une vidéo 640×480 (format Y4M, niveaux de gris) affichant le QR code de `text`. */
export function qrVideo(text: string): string {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const scale = Math.floor(400 / (size + 8));
  const total = (size + 8) * scale;
  const x0 = Math.floor((W - total) / 2);
  const y0 = Math.floor((H - total) / 2);
  const Y = Buffer.alloc(W * H, 235); // fond clair (comme une fiche sous une lampe)
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (qr.modules.get(r, c))
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) Y[(y0 + (r + 4) * scale + dy) * W + x0 + (c + 4) * scale + dx] = 20;
  const UV = Buffer.alloc((W * H) / 4, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  const file = join(dir, `qr-${n++}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame, frame]));
  return file;
}

/** Lance un Chromium dont la « webcam » filme le QR code donné. */
export async function browserFilming(text: string) {
  return chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${qrVideo(text)}`],
  });
}
