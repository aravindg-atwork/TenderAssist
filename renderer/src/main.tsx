// renderer/src/main.tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/figtree';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { applyCachedTextSize } from './display';

applyCachedTextSize();

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');
createRoot(container).render(<App />);
