import { render } from 'preact';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Service worker : permet l'installation (PWA) et le chargement rapide de l'interface.
// Il ne met jamais en cache les échanges avec le serveur de jeu (/api).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
