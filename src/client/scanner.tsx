// Lecture de QR code avec la caméra, uniquement à la demande du joueur (jamais en continu).
// Saisie manuelle du code toujours possible (secours si la caméra est refusée ou indisponible).
// En partie, la caméra s'ouvre d'elle-même sur l'onglet « Poste » (autoStart) et se met en pause
// après une minute sans lecture pour économiser la batterie.

import { useEffect, useRef, useState } from 'preact/hooks';
import { CodeForm } from './ui';

/** Durée sans QR code lu au bout de laquelle la caméra se met en pause. */
export const CAMERA_IDLE_MS = 60_000;
/** Délai avant de relire après un code refusé. */
const RETRY_MS = 2000;
/** Un QR code refusé n'est pas relu avant ce délai (sinon il compterait en boucle comme code erroné). */
export const SAME_QR_IGNORE_MS = 15_000;

export function Scanner({ onCode, manualLabel, autoStart }: { onCode: (code: string) => Promise<boolean | void>; manualLabel?: string; autoStart?: boolean }) {
  const [active, setActive] = useState(!!autoStart);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const rejected = useRef<{ text: string; at: number }>();

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined;
    let stop = false;
    let raf = 0;
    let idle = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
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
        idle = window.setTimeout(() => {
          stop = true;
          setActive(false);
          setPaused(true);
        }, CAMERA_IDLE_MS);
        const loop = async () => {
          if (stop) return;
          try {
            if (v.readyState >= 2) {
              const text = await detect(v);
              const r = rejected.current;
              const again = !!text && !!r && r.text === text && Date.now() - r.at < SAME_QR_IGNORE_MS;
              if (text && !stop && !again) {
                stop = true;
                setActive(false);
                const ok = await onCodeRef.current(text);
                if (ok === false) {
                  // code refusé : on relit un peu plus tard (la caméra reste à portée de main), en ignorant ce même QR code
                  rejected.current = { text, at: Date.now() };
                  if (autoStart) setTimeout(() => setActive(true), RETRY_MS);
                }
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
      clearTimeout(idle);
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
        <>
          {paused && <p class="muted center" style={{ margin: 0 }}>Caméra en pause pour économiser la batterie.</p>}
          <button
            class="btn big block primary"
            onClick={() => {
              setError(undefined);
              setPaused(false);
              setActive(true);
            }}
          >
            📷 Scanner le QR code du poste
          </button>
        </>
      )}
      {error && <p class="card warn">{error}</p>}
      <p class="muted center" style={{ margin: '4px 0' }}>
        — ou —
      </p>
      <CodeForm label={manualLabel ?? 'Code imprimé sur le poste'} length={4} button="Valider le code" btnClass="" submit={onCode} />
      <p class="muted" style={{ fontSize: '0.85rem' }}>
        La caméra ne sert qu’à lire le QR code : rien n’est enregistré ni envoyé, et elle s’éteint dès la lecture.
      </p>
    </div>
  );
}
