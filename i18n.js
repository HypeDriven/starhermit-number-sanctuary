'use strict';

// Number Sanctuary — localization table and lookup.
//
// en-US is the complete base; every other locale overrides the keys it needs.
// The active locale is chosen once at boot from `?lang=`, then a stored
// preference, then navigator.languages, falling back to en-US.
// Strings use {name} placeholders; `t(key, vars)` substitutes them.

const EN_US = {
  'app.title': 'Number Sanctuary',
  'mode.learn': 'Learn',
  'mode.journey': 'Journey',
  'mode.daily': 'Daily',
  'mode.practice': 'Practice',
  'mode.challenge': 'Challenge',
  'aria.modes': 'Game modes',
  'aria.statusPanel': 'Status and progress',
  'aria.controlsPanel': 'Controls and info',
  'aria.numberPad': 'Number pad',
  'aria.erase': 'Erase selected cell',
  'panel.status': 'Status',
  'panel.controls': 'Controls',
  'panel.progress': 'Progress',
  'status.ready': 'Ready.',
  'status.line': '{difficulty} · {filled}/81 · Score {score} · Mistakes {mistakes} · {time}',
  'status.best': ' · Best {best}',
  'sync.saving': 'Saving to cloud…',
  'sync.synced': 'Cloud save synced',
  'sync.error': 'Cloud sync failed',
  'diff.easy': 'Easy',
  'diff.medium': 'Medium',
  'diff.hard': 'Hard',
  'cell.none': 'No cell selected.',
  'cell.at': 'Cell row {row}, column {col}: {value}',
  'cell.fixed': '{digit} (fixed)',
  'cell.marked': 'marked, empty',
  'cell.empty': 'empty',
  'btn.erase': 'Erase',
  'btn.mark': 'Mark (N)',
  'btn.hint': 'Hint (H)',
  'btn.clear': 'Clear (C)',
  'btn.restart': 'Restart (R)',
  'btn.pause': 'Pause (P)',
  'btn.mute': 'Mute (M)',
  'btn.unmute': 'Unmute (M)',
  'btn.resume': 'Resume',
  'info.select': 'Click a cell (or use the arrow keys), then a number.',
  'info.colors': 'Orange tiles are fixed clues; green tiles are yours.',
  'overlay.paused': 'Paused',
  'overlay.pausedHint': 'Press P or click Resume to continue.',
  'overlay.complete': 'Sanctuary complete',
  'score.placed': 'Digits placed',
  'score.mistakes': 'Mistakes ({n})',
  'score.hints': 'Hints ({n})',
  'score.solve': 'Solve bonus',
  'score.time': 'Time bonus ({time})',
  'score.total': 'Total',
  'overlay.again': 'Press R for a new round.',
};

const TABLE = {
  'en-US': EN_US,
  'en-GB': {
    'info.colors': 'Orange tiles are fixed clues; green tiles are yours.',
    'cell.marked': 'pencilled, empty',
    'btn.mark': 'Pencil (N)',
  },
  'es-ES': {
    'mode.learn': 'Aprender', 'mode.journey': 'Travesía', 'mode.daily': 'Diario',
    'mode.practice': 'Práctica', 'mode.challenge': 'Reto',
    'aria.modes': 'Modos de juego', 'aria.statusPanel': 'Estado y progreso',
    'aria.controlsPanel': 'Controles e información', 'aria.numberPad': 'Teclado numérico',
    'aria.erase': 'Borrar la casilla seleccionada',
    'panel.status': 'Estado', 'panel.controls': 'Controles', 'panel.progress': 'Progreso',
    'status.ready': 'Listo.',
    'status.line': '{difficulty} · {filled}/81 · Puntos {score} · Errores {mistakes} · {time}',
    'status.best': ' · Mejor {best}',
    'diff.easy': 'Fácil', 'diff.medium': 'Media', 'diff.hard': 'Difícil',
    'cell.none': 'Ninguna casilla seleccionada.',
    'cell.at': 'Casilla fila {row}, columna {col}: {value}',
    'cell.fixed': '{digit} (fija)', 'cell.marked': 'marcada, vacía', 'cell.empty': 'vacía',
    'btn.erase': 'Borrar', 'btn.mark': 'Marcar (N)', 'btn.hint': 'Pista (H)',
    'btn.clear': 'Limpiar (C)', 'btn.restart': 'Reiniciar (R)', 'btn.pause': 'Pausa (P)',
    'btn.mute': 'Silenciar (M)', 'btn.unmute': 'Activar sonido (M)', 'btn.resume': 'Continuar',
    'info.select': 'Pulsa una casilla (o usa las flechas) y luego un número.',
    'info.colors': 'Las fichas naranjas son pistas fijas; las verdes son tuyas.',
    'overlay.paused': 'En pausa',
    'overlay.pausedHint': 'Pulsa P o Continuar para seguir.',
    'overlay.complete': 'Santuario completado',
    'score.placed': 'Dígitos colocados', 'score.mistakes': 'Errores ({n})',
    'score.hints': 'Pistas ({n})', 'score.solve': 'Bonus por resolver',
    'score.time': 'Bonus de tiempo ({time})', 'score.total': 'Total',
    'overlay.again': 'Pulsa R para una ronda nueva.',
  },
  'de-DE': {
    'mode.learn': 'Lernen', 'mode.journey': 'Reise', 'mode.daily': 'Täglich',
    'mode.practice': 'Übung', 'mode.challenge': 'Herausforderung',
    'aria.modes': 'Spielmodi', 'aria.statusPanel': 'Status und Fortschritt',
    'aria.controlsPanel': 'Steuerung und Infos', 'aria.numberPad': 'Zahlenfeld',
    'aria.erase': 'Ausgewähltes Feld löschen',
    'panel.status': 'Status', 'panel.controls': 'Steuerung', 'panel.progress': 'Fortschritt',
    'status.ready': 'Bereit.',
    'status.line': '{difficulty} · {filled}/81 · Punkte {score} · Fehler {mistakes} · {time}',
    'status.best': ' · Bestwert {best}',
    'diff.easy': 'Leicht', 'diff.medium': 'Mittel', 'diff.hard': 'Schwer',
    'cell.none': 'Kein Feld ausgewählt.',
    'cell.at': 'Feld Zeile {row}, Spalte {col}: {value}',
    'cell.fixed': '{digit} (fest)', 'cell.marked': 'markiert, leer', 'cell.empty': 'leer',
    'btn.erase': 'Löschen', 'btn.mark': 'Notiz (N)', 'btn.hint': 'Tipp (H)',
    'btn.clear': 'Leeren (C)', 'btn.restart': 'Neustart (R)', 'btn.pause': 'Pause (P)',
    'btn.mute': 'Stumm (M)', 'btn.unmute': 'Ton an (M)', 'btn.resume': 'Weiter',
    'info.select': 'Feld anklicken (oder Pfeiltasten), dann eine Zahl.',
    'info.colors': 'Orange Steine sind feste Hinweise, grüne gehören dir.',
    'overlay.paused': 'Pausiert',
    'overlay.pausedHint': 'Drücke P oder klicke auf Weiter.',
    'overlay.complete': 'Heiligtum vollendet',
    'score.placed': 'Gesetzte Ziffern', 'score.mistakes': 'Fehler ({n})',
    'score.hints': 'Tipps ({n})', 'score.solve': 'Lösungsbonus',
    'score.time': 'Zeitbonus ({time})', 'score.total': 'Gesamt',
    'overlay.again': 'Drücke R für eine neue Runde.',
  },
  'fr-FR': {
    'mode.learn': 'Apprendre', 'mode.journey': 'Voyage', 'mode.daily': 'Quotidien',
    'mode.practice': 'Entraînement', 'mode.challenge': 'Défi',
    'aria.modes': 'Modes de jeu', 'aria.statusPanel': 'État et progression',
    'aria.controlsPanel': 'Commandes et informations', 'aria.numberPad': 'Pavé numérique',
    'aria.erase': 'Effacer la case sélectionnée',
    'panel.status': 'État', 'panel.controls': 'Commandes', 'panel.progress': 'Progression',
    'status.ready': 'Prêt.',
    'status.line': '{difficulty} · {filled}/81 · Score {score} · Erreurs {mistakes} · {time}',
    'status.best': ' · Record {best}',
    'diff.easy': 'Facile', 'diff.medium': 'Moyen', 'diff.hard': 'Difficile',
    'cell.none': 'Aucune case sélectionnée.',
    'cell.at': 'Case ligne {row}, colonne {col} : {value}',
    'cell.fixed': '{digit} (fixe)', 'cell.marked': 'annotée, vide', 'cell.empty': 'vide',
    'btn.erase': 'Effacer', 'btn.mark': 'Noter (N)', 'btn.hint': 'Indice (H)',
    'btn.clear': 'Vider (C)', 'btn.restart': 'Recommencer (R)', 'btn.pause': 'Pause (P)',
    'btn.mute': 'Muet (M)', 'btn.unmute': 'Son (M)', 'btn.resume': 'Reprendre',
    'info.select': 'Cliquez une case (ou utilisez les flèches), puis un chiffre.',
    'info.colors': 'Les tuiles orange sont des indices fixes ; les vertes sont les vôtres.',
    'overlay.paused': 'En pause',
    'overlay.pausedHint': 'Appuyez sur P ou cliquez sur Reprendre.',
    'overlay.complete': 'Sanctuaire achevé',
    'score.placed': 'Chiffres placés', 'score.mistakes': 'Erreurs ({n})',
    'score.hints': 'Indices ({n})', 'score.solve': 'Bonus de résolution',
    'score.time': 'Bonus de temps ({time})', 'score.total': 'Total',
    'overlay.again': 'Appuyez sur R pour une nouvelle partie.',
  },
  'pt-BR': {
    'mode.learn': 'Aprender', 'mode.journey': 'Jornada', 'mode.daily': 'Diário',
    'mode.practice': 'Prática', 'mode.challenge': 'Desafio',
    'aria.modes': 'Modos de jogo', 'aria.statusPanel': 'Estado e progresso',
    'aria.controlsPanel': 'Controles e informações', 'aria.numberPad': 'Teclado numérico',
    'aria.erase': 'Apagar a célula selecionada',
    'panel.status': 'Estado', 'panel.controls': 'Controles', 'panel.progress': 'Progresso',
    'status.ready': 'Pronto.',
    'status.line': '{difficulty} · {filled}/81 · Pontos {score} · Erros {mistakes} · {time}',
    'status.best': ' · Recorde {best}',
    'diff.easy': 'Fácil', 'diff.medium': 'Médio', 'diff.hard': 'Difícil',
    'cell.none': 'Nenhuma célula selecionada.',
    'cell.at': 'Célula linha {row}, coluna {col}: {value}',
    'cell.fixed': '{digit} (fixo)', 'cell.marked': 'marcada, vazia', 'cell.empty': 'vazia',
    'btn.erase': 'Apagar', 'btn.mark': 'Marcar (N)', 'btn.hint': 'Dica (H)',
    'btn.clear': 'Limpar (C)', 'btn.restart': 'Reiniciar (R)', 'btn.pause': 'Pausar (P)',
    'btn.mute': 'Sem som (M)', 'btn.unmute': 'Com som (M)', 'btn.resume': 'Continuar',
    'info.select': 'Toque numa célula (ou use as setas) e depois um número.',
    'info.colors': 'Peças laranja são pistas fixas; as verdes são suas.',
    'overlay.paused': 'Pausado',
    'overlay.pausedHint': 'Pressione P ou clique em Continuar.',
    'overlay.complete': 'Santuário completo',
    'score.placed': 'Dígitos colocados', 'score.mistakes': 'Erros ({n})',
    'score.hints': 'Dicas ({n})', 'score.solve': 'Bônus por resolver',
    'score.time': 'Bônus de tempo ({time})', 'score.total': 'Total',
    'overlay.again': 'Pressione R para uma nova rodada.',
  },
  'it-IT': {
    'mode.learn': 'Impara', 'mode.journey': 'Viaggio', 'mode.daily': 'Giornaliero',
    'mode.practice': 'Pratica', 'mode.challenge': 'Sfida',
    'aria.modes': 'Modalità di gioco', 'aria.statusPanel': 'Stato e progressi',
    'aria.controlsPanel': 'Comandi e informazioni', 'aria.numberPad': 'Tastierino numerico',
    'aria.erase': 'Cancella la casella selezionata',
    'panel.status': 'Stato', 'panel.controls': 'Comandi', 'panel.progress': 'Progressi',
    'status.ready': 'Pronto.',
    'status.line': '{difficulty} · {filled}/81 · Punti {score} · Errori {mistakes} · {time}',
    'status.best': ' · Record {best}',
    'diff.easy': 'Facile', 'diff.medium': 'Medio', 'diff.hard': 'Difficile',
    'cell.none': 'Nessuna casella selezionata.',
    'cell.at': 'Casella riga {row}, colonna {col}: {value}',
    'cell.fixed': '{digit} (fissa)', 'cell.marked': 'annotata, vuota', 'cell.empty': 'vuota',
    'btn.erase': 'Cancella', 'btn.mark': 'Annota (N)', 'btn.hint': 'Aiuto (H)',
    'btn.clear': 'Svuota (C)', 'btn.restart': 'Ricomincia (R)', 'btn.pause': 'Pausa (P)',
    'btn.mute': 'Muto (M)', 'btn.unmute': 'Audio (M)', 'btn.resume': 'Riprendi',
    'info.select': 'Tocca una casella (o usa le frecce), poi un numero.',
    'info.colors': 'Le tessere arancioni sono indizi fissi; quelle verdi sono tue.',
    'overlay.paused': 'In pausa',
    'overlay.pausedHint': 'Premi P o clicca Riprendi per continuare.',
    'overlay.complete': 'Santuario completato',
    'score.placed': 'Cifre inserite', 'score.mistakes': 'Errori ({n})',
    'score.hints': 'Aiuti ({n})', 'score.solve': 'Bonus soluzione',
    'score.time': 'Bonus tempo ({time})', 'score.total': 'Totale',
    'overlay.again': 'Premi R per un nuovo turno.',
  },
};

// Regional variants inherit from their parent and override only what differs.
TABLE['es-419'] = Object.assign({}, TABLE['es-ES'], {
  'mode.practice': 'Práctica libre',
  'btn.clear': 'Borrar todo (C)',
  'info.select': 'Toca una casilla (o usa las flechas) y luego un número.',
  'overlay.again': 'Presiona R para una ronda nueva.',
  'overlay.pausedHint': 'Presiona P o Continuar para seguir.',
});
TABLE['fr-CA'] = Object.assign({}, TABLE['fr-FR'], {
  'mode.challenge': 'Épreuve',
  'btn.hint': 'Aide (H)',
  'score.hints': 'Aides ({n})',
  'info.select': 'Touchez une case (ou utilisez les flèches), puis un chiffre.',
});

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const DEFAULT_LOCALE = 'en-US';
const STORE_KEY = 'number-sanctuary:lang';

// Best match for a BCP-47 tag: exact, then a same-language locale, else null.
function match(tag) {
  if (!tag) return null;
  const want = String(tag).replace('_', '-');
  const exact = LOCALES.find((l) => l.toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const lang = want.split('-')[0].toLowerCase();
  if (lang === 'es' && /^es-(419|ar|bo|cl|co|cr|do|ec|gt|hn|mx|ni|pa|pe|pr|py|sv|us|uy|ve)$/i.test(want)) return 'es-419';
  if (lang === 'pt') return 'pt-BR';
  return LOCALES.find((l) => l.split('-')[0] === lang) || null;
}

function detect() {
  try {
    const q = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('lang');
    const forced = match(q);
    if (forced) { try { localStorage.setItem(STORE_KEY, forced); } catch (e) { /* ignore */ } return forced; }
  } catch (e) { /* no location */ }
  try {
    const saved = match(localStorage.getItem(STORE_KEY));
    if (saved) return saved;
  } catch (e) { /* storage unavailable */ }
  const nav = (globalThis.navigator && (navigator.languages || [navigator.language])) || [];
  for (const tag of nav) { const m = match(tag); if (m) return m; }
  return DEFAULT_LOCALE;
}

let _locale = DEFAULT_LOCALE;
let _strings = EN_US;

export function setLocale(tag) {
  _locale = match(tag) || DEFAULT_LOCALE;
  _strings = Object.assign({}, EN_US, TABLE[_locale] || {});
  return _locale;
}

export function getLocale() { return _locale; }

// Missing keys fall through to en-US, then to the key itself, so a partial
// translation degrades to English rather than to blank UI.
export function t(key, vars) {
  let s = _strings[key];
  if (s === undefined) s = EN_US[key];
  if (s === undefined) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}

setLocale(detect());

export default { t, setLocale, getLocale, LOCALES };
