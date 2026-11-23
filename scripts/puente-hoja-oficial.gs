/**
 * Puente Chambea ← hoja oficial de horarios (Google Apps Script)
 * Lee la hoja oficial con tu permiso de lectura y cada hora se la manda a Chambea.
 * Chambea compara y solo actualiza lo que cambió (almuerzos, cenas, descansos y turnos).
 *
 * Uso: pega este código en script.google.com (con tu cuenta de DoctorSV),
 * elige la función "instalar" y toca Ejecutar. Acepta los permisos. Listo.
 */
const HOJA_ID = '1vDbLA6wO57ovyinu1SaVecV7uf7PEbwSUZpfd-Uhdss';
const CHAMBEA_URL = 'https://tocahnikeidppzkyotic.supabase.co/functions/v1/sincronizar';
const CLAVE = 'PEGAR_AQUI_LA_CLAVE'; // te la paso por el chat; no la compartas

// Una sola vez: crea la sincronización automática cada hora y hace la primera
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sincronizar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  sincronizar();
}

// Se ejecuta sola cada hora (también puedes ejecutarla a mano)
function sincronizar() {
  const libro = SpreadsheetApp.openById(HOJA_ID);
  const zona = libro.getSpreadsheetTimeZone();
  const hojas = libro.getSheets()
    .filter((h) => !h.isSheetHidden() && esHojaDeHorario(h))
    .map((h) => ({ nombre: h.getName(), filas: leerFilas(h, zona) }));

  if (!hojas.length) {
    console.warn('No encontré hojas de PLANILLA ni de SP visibles.');
    return;
  }
  const respuesta = UrlFetchApp.fetch(CHAMBEA_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ token: CLAVE, hojas: hojas }),
    muteHttpExceptions: true,
  });
  console.log(respuesta.getResponseCode() + ' ' + respuesta.getContentText().slice(0, 800));
}

// Hojas de planilla o de SP: por nombre o por su encabezado
function esHojaDeHorario(hoja) {
  if (/PLANILLA|\bSP\b|SERVICIOS/i.test(hoja.getName())) return true;
  const filas = Math.min(6, hoja.getLastRow());
  const cols = Math.min(10, hoja.getLastColumn());
  if (filas < 1 || cols < 1) return false;
  const cabecera = hoja.getRange(1, 1, filas, cols).getDisplayValues().flat().join('|').toUpperCase();
  return /MEDICO \/ FECHA/.test(cabecera) || (/NOMBRE/.test(cabecera) && (/AREA/.test(cabecera) || /GRUPOS/.test(cabecera)));
}

// Valores de la hoja; las fechas viajan como 'D:AAAA-MM-DD' y se quitan las celdas vacías del final
function leerFilas(hoja, zona) {
  const valores = hoja.getDataRange().getValues();
  const filas = valores.map((fila) => {
    const f = fila.map((v) => (v instanceof Date ? 'D:' + Utilities.formatDate(v, zona, 'yyyy-MM-dd') : v));
    let fin = f.length;
    while (fin > 0 && (f[fin - 1] === '' || f[fin - 1] === null)) fin--;
    return f.slice(0, fin);
  });
  let ultima = filas.length;
  while (ultima > 0 && filas[ultima - 1].length === 0) ultima--;
  return filas.slice(0, ultima);
}
