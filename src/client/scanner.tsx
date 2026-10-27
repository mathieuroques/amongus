// Lecture de QR code avec la caméra, uniquement à la demande du joueur (jamais en continu).
// Saisie manuelle du code toujours possible (secours si la caméra est refusée ou indisponible).

import { useEffect, useRef, useState } from 'preact/hooks';
import { CodeForm } from './ui';

export function Scanner({ onCode, manualLabel }: { onCode: (code: string) => Promise<boolean | void>; manualLabel?: string }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined;
    let stop = false;
    let raf = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return;
        const v = video.current!;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        const Detector = (window as any).BarcodeDetector;
        let detect: (v: HTMLVideoElement) => Promise<string | undefined>;
        if (Detector) {
          const d = new Detector({ formats: ['qr_code'] });
          detect = async (el) => (await d.detect(el))[0]?.rawValue;
        } else {
          const jsQR = (await import('jsqr')).default;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          detect = async (el) => {
            const w = 480;
            const h = Math.round((el.videoHeight / el.videoWidth) * w) || 360;
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(el, 0, 0, w, h);
            return jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data;
          };
        }
        const loop = async () => {
          if (stop) return;
          try {
            if (v.readyState >= 2) {
              const text = await detect(v);
              if (text) {
                stop = true;
                setActive(false);
                await onCode(text);
                return;
              }
            }
          } catch {
            /* image suivante */
          }
          raf = window.setTimeout(loop, 180);
        };
        loop();
      } catch (e) {
        setActive(false);
        setError(
          (e as Error).message === 'insecure'
            ? 'Caméra indisponible ici (connexion non sécurisée ou navigateur trop ancien). Saisissez le code à la main.'
            : 'Accès à la caméra refusé ou impossible. Saisissez le code imprimé sous le QR code.',
        );
      }
    })();
    return () => {
      stop = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return (
    <div class="stack">
      {active ? (
        <>
          <video ref={video} class="scanner" muted playsInline />
          <button class="btn block" onClick={() => setActive(false)}>
            Arrêter la caméra
          </button>
        </>
      ) : (
        <button
          class="btn big block primary"
          onClick={() => {
            setError(undefined);
            setActive(true);
          }}
        >
          📷 Scanner le QR code du poste
        </button>
      )}
      {error && <p class="card warn">{error}</p>}
      <p class="muted center" style={{ margin: '4px 0' }}>
        — ou —
      </p>
      <CodeForm label={manualLabel ?? 'Code imprimé sur le poste'} length={8} button="Valider le code" btnClass="" submit={onCode} />
      <p class="muted" style={{ fontSize: '0.85rem' }}>
        La caméra ne sert qu’à lire le QR code : rien n’est enregistré ni envoyé, et elle s’éteint dès la lecture.
      </p>
    </div>
  );
}
