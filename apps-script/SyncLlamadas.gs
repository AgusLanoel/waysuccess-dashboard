/**
 * WaySuccess — envía la pestaña "Llamadas" de "WaySucess - Tracker Comercial" al dashboard (Supabase) cada 15 minutos.
 * Instalación: Extensiones → Apps Script → pegar este archivo → ejecutar `instalar` una vez y aceptar permisos.
 * Las columnas se leen por el nombre del encabezado, así que se pueden agregar o mover columnas sin romper nada.
 */
const ENDPOINT = 'https://iqiyhlcqnxwtdhmmrlsp.supabase.co/functions/v1/sheet-ingest';
const SHEET_KEY = '__SHEET_KEY__';
const TAB = 'Llamadas';

function enviarLlamadas() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const width = sh.getLastColumn();
  // La fila de encabezados es la que tiene "Fecha LLamada Calendar" en la columna A.
  const top = sh.getRange(1, 1, 8, width).getDisplayValues();
  const h = top.findIndex(r => /fecha\s*llamada/i.test(r[0]));
  if (h < 0) throw new Error('No encontré la fila de encabezados en ' + TAB);
  const headers = top[h];
  const above = h > 0 ? top[h - 1] : []; // nombres de las objeciones
  const first = h + 2; // primera fila de datos (1-based)
  // Última fila con nombre del lead (la hoja tiene fórmulas hasta muy abajo)
  const names = sh.getRange(first, 2, Math.max(sh.getLastRow() - first + 1, 1), 1).getValues();
  let n = names.length;
  while (n > 0 && String(names[n - 1][0]).trim() === '') n--;
  if (n === 0) return;
  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(first, 1, n, width).getValues();
  const rows = values.map((v, i) => ({
    row: first + i,
    v: v.map(x => x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x),
  })).filter(r => String(r.v[0]).trim() !== '' || String(r.v[1]).trim() !== '');
  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sheet-key': SHEET_KEY },
    payload: JSON.stringify({ headers, above, rows }),
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
