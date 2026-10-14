/**
 * WaySuccess — envía la pestaña "Llamadas" al dashboard (Supabase) cada 15 minutos.
 * Instalación: Extensiones → Apps Script → pegar este archivo → ejecutar `instalar` una vez y aceptar permisos.
 */
const ENDPOINT = 'https://iqiyhlcqnxwtdhmmrlsp.supabase.co/functions/v1/sheet-ingest';
const SHEET_KEY = '__SHEET_KEY__';
const TAB = 'Llamadas';
const COLS = 38; // A..AL

function enviarLlamadas() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const last = sh.getLastRow();
  // La fila de encabezados es la que tiene "Fecha LLamada Calendar" en la columna A.
  const top = sh.getRange(1, 1, 8, COLS).getDisplayValues();
  const h = top.findIndex(r => /fecha\s*llamada/i.test(r[0]));
  if (h < 0) throw new Error('No encontré la fila de encabezados en ' + TAB);
  const objections = top[h - 1].slice(14, 33).map(s => String(s).trim()); // O..AG, nombres en la fila de arriba
  const first = h + 2; // primera fila de datos (1-based)
  if (last < first) return;
  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(first, 1, last - first + 1, COLS).getValues();
  const rows = values.map((v, i) => ({
    row: first + i,
    v: v.map(x => x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x),
  })).filter(r => String(r.v[0]).trim() !== '' || String(r.v[1]).trim() !== '');
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheet-key': SHEET_KEY },
    payload: JSON.stringify({ rows, objections }),
    muteHttpExceptions: true,
  });
  console.log(res.getResponseCode() + ' ' + res.getContentText());
}

function instalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarLlamadas')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarLlamadas').timeBased().everyMinutes(15).create();
  enviarLlamadas();
}
