// Puntero `mtto_periodo_activo`: vale adelantado o atrasado UN bimestre; si no, queda obsoleto.
import { punteroVigente } from '../api/_lib/mtto.js';
let ok = 0, mal = 0;
const t = (n, c) => { if (c) ok++; else { mal++; console.log('✗', n); } };
const cal = { periodo: 'NOV-DIC', anio: 2026 };
t('adelantado (ENE-FEB 2027) vale', punteroVigente(cal, { periodo: 'ENE-FEB', anio: 2027 }));
t('atrasado un bimestre (SEP-OCT 2026) vale', punteroVigente(cal, { periodo: 'SEP-OCT', anio: 2026 }));
t('igual al calendario es obsoleto', !punteroVigente(cal, { periodo: 'NOV-DIC', anio: 2026 }));
t('atrasado dos bimestres es obsoleto', !punteroVigente(cal, { periodo: 'JUL-AGO', anio: 2026 }));
t('atrasado un bimestre cruzando de año vale', punteroVigente({ periodo: 'ENE-FEB', anio: 2027 }, { periodo: 'NOV-DIC', anio: 2026 }));
t('SEP-OCT 2026 con calendario ENE-FEB 2027 es obsoleto', !punteroVigente({ periodo: 'ENE-FEB', anio: 2027 }, { periodo: 'SEP-OCT', anio: 2026 }));
t('año como texto funciona', punteroVigente(cal, { periodo: 'SEP-OCT', anio: '2026' }));
t('período desconocido no vale (ni con calendario ENE-FEB)', !punteroVigente({ periodo: 'ENE-FEB', anio: 2027 }, { periodo: 'XXX', anio: 2027 }));
t('sin datos no vale', !punteroVigente(cal, null) && !punteroVigente(cal, {}));
console.log(`${ok} ok · ${mal} mal`);
process.exit(mal ? 1 : 0);
