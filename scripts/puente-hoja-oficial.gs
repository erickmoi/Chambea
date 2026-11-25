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

// Valores de la hoja; las fechas viajan como 'D:AAAA-MM-DD' y se quitan las celdas vacías del final.
// Un turno con fondo GRIS es una permuta recibida: se le agrega "P - " si no lo trae escrito.
function leerFilas(hoja, zona) {
  const rango = hoja.getDataRange();
  const valores = rango.getValues();
  const fondos = rango.getBackgrounds();
  const esGris = (hex) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
    return r === g && g === b && r >= 0x60 && r <= 0xc8;
  };
  const filas = valores.map((fila, i) => {
    const f = fila.map((v, j) => {
      if (v instanceof Date) return 'D:' + Utilities.formatDate(v, zona, 'yyyy-MM-dd');
      if (typeof v === 'string' && /\d:\d\d\s*(am|pm)\s*-/i.test(v) && !/^\s*P\s*[-–]/i.test(v) && esGris(fondos[i][j])) return 'P - ' + v;
      return v;
    });
    let fin = f.length;
    while (fin > 0 && (f[fin - 1] === '' || f[fin - 1] === null)) fin--;
    return f.slice(0, fin);
  });
  let ultima = filas.length;
  while (ultima > 0 && filas[ultima - 1].length === 0) ultima--;
  return filas.slice(0, ultima);
}
