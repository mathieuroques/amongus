import QRCode from 'qrcode';
import { useEffect, useState } from 'preact/hooks';

/** QR code généré localement (aucun service externe). */
export function QR({ text, size = 220 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg, () => setSvg(''));
  }, [text]);
  return <div class="qr" style={{ width: size, height: size, background: '#fff', padding: 6, borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function joinUrl(code: string) {
  return `${location.origin}/#/j/${code}`;
}
