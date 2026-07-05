// ═══════════════════════════════════════════════════════════════════════════════
//  auth-guard.js — Política de roles centralizada de MultiAire (capa de UX)
//  Única fuente de verdad de QUIÉN puede hacer QUÉ. Cada página construye su
//  `maUser` como hoy y luego llama MA.setUser(maUser); los gates de la UI pasan a
//  consultar MA.can(...) / MA.canEnter(...) en vez de comparar roles a mano.
//
//  Modelo (acordado 2026-06-25):
//   • SUPER_ADMIN — todo, incluido lo crítico (borrar, backup completo,
//                   importación masiva, gestión de usuarios, configuración).
//   • ADMIN       — ve todo, crea/edita/aprueba/exporta lo operativo; NO hace
//                   nada de lo crítico (eso es solo SUPER_ADMIN).
//   • SUPERVISOR  — opera (crea/edita/aprueba/exporta) SOLO en sus `apps[]`.
//   • TECNICO     — solo lectura.
//
//  OJO: esto es control de UX (oculta/inhabilita botones). La seguridad real
//  vive en las reglas de Firestore (pendiente, ver plan — carril B).
// ═══════════════════════════════════════════════════════════════════════════════
window.MA = (function () {
  'use strict';

  // Super admins "del sistema": SIEMPRE son SUPER_ADMIN por código (pase lo que
  // pase en Firestore) y NO se pueden degradar/eliminar desde el panel. Garantizan
  // que nunca haya cero super admins.
  var SUPER_ADMIN_EMAILS = ['marchenaangulojoseluis@gmail.com', 'plataforma@multiaire.com.pe'];
  var SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0]; // compat
  var ROLES = ['TECNICO', 'SUPERVISOR', 'ADMIN', 'SUPER_ADMIN'];

  function lc(e) { return (e || '').toLowerCase(); }
  // ¿Es un super admin del sistema (hardcodeado, intocable)?
  function isSystemSuper(email) { return SUPER_ADMIN_EMAILS.indexOf(lc(email)) !== -1; }
  // Rol efectivo de un doc de usuario (los del sistema cuentan siempre como SUPER_ADMIN).
  function effRol(u) { return (u && isSystemSuper(u.email)) ? 'SUPER_ADMIN' : ((u && u.rol) || 'USUARIO'); }
  // ¿Se puede QUITAR el super (degradar o eliminar) a este email? users = lista de
  // docs {email, rol} del panel. Devuelve { ok, motivo }. Regla: los del sistema no
  // se tocan; y nunca se puede quedar con cero super admins.
  function puedeQuitarSuper(targetEmail, users) {
    if (isSystemSuper(targetEmail)) return { ok: false, motivo: 'Es un super admin del sistema (protegido por código).' };
    var quedan = (users || []).filter(function (u) {
      return effRol(u) === 'SUPER_ADMIN' && lc(u.email) !== lc(targetEmail);
    }).length;
    if (quedan < 1) return { ok: false, motivo: 'Debe quedar al menos un super admin.' };
    return { ok: true };
  }

  // Capacidades reservadas SOLO a SUPER_ADMIN.
  //  • 'backup' = respaldo/restauración COMPLETA del sistema (configuracion.html).
  //  • 'exportar' (Excel operativo de un módulo) es OPERATIVA, no crítica.
  var SOLO_SUPER = ['borrar', 'backup', 'importMasiva', 'gestionUsuarios', 'config'];
  // Acciones operativas que un SUPERVISOR sí puede ejercer dentro de sus apps[].
  var OPERATIVAS = ['ver', 'crear', 'editar', 'aprobar', 'exportar', 'salida', 'transferencia', 'crearItem'];

  var _user = null; // { email, rol, apps:[] }

  function setUser(u) {
    _user = u || null;
    // Los super admins del sistema son SUPER_ADMIN aunque Firestore diga otra cosa.
    if (_user && isSystemSuper(_user.email)) {
      _user.rol = 'SUPER_ADMIN';
    }
    return _user;
  }
  function getUser() { return _user; }
  function rol() { return (_user && _user.rol) || 'USUARIO'; }
  function apps() { return (_user && _user.apps) || []; }

  function isSuperAdmin() { return rol() === 'SUPER_ADMIN'; }
  function isAdmin() { return rol() === 'ADMIN' || isSuperAdmin(); }

  // ¿Puede ENTRAR a una app? Los admins entran a todo; el resto, según apps[].
  function canEnter(app) {
    if (isAdmin()) return true;
    return apps().indexOf(app) !== -1;
  }

  // Corazón de la política. `accion` es un verbo de OPERATIVAS o de SOLO_SUPER;
  // `app` (opcional para ADMIN; OBLIGATORIO para SUPERVISOR) acota el permiso.
  // Diseño FAIL-CLOSED: toda acción no contemplada explícitamente devuelve false
  // (un typo en una acción crítica NO se cuela como permitido).
  function can(accion, app) {
    if (!_user) return false;
    if (isSuperAdmin()) return true;                      // super admin: todo
    if (SOLO_SUPER.indexOf(accion) !== -1) return false;  // crítico: solo super
    var esOperativa = OPERATIVAS.indexOf(accion) !== -1;
    if (rol() === 'ADMIN') return esOperativa;            // admin: SOLO operativas conocidas
    if (rol() === 'SUPERVISOR') return esOperativa && !!app && canEnter(app); // exige app habilitada
    if (rol() === 'TECNICO') return accion === 'ver' && (!app || canEnter(app));
    return false;                                         // USUARIO u otro: nada
  }

  // Pantalla de "Sin acceso" uniforme para el gate de entrada por módulo.
  // Cubre el contenido (z-index alto) y detiene la sensación de "conectando".
  function showNoAccess(seccion) {
    try {
      if (document.getElementById('ma-no-access')) return;
      var s = String(seccion || 'esta sección').replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
      var ov = document.createElement('div');
      ov.id = 'ma-no-access';
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f0f4fa;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"IBM Plex Sans",system-ui,-apple-system,sans-serif';
      ov.innerHTML =
        '<div style="max-width:380px;text-align:center;background:#fff;border:1px solid #d0daf0;border-radius:14px;padding:32px 28px;box-shadow:0 8px 30px rgba(27,63,139,.08)">'
        + '<div style="font-size:40px;margin-bottom:8px">🔒</div>'
        + '<div style="font-size:17px;font-weight:700;color:#1B3F8B;margin-bottom:8px">Sin acceso a ' + s + '</div>'
        + '<div style="font-size:13px;color:#6a7a9a;line-height:1.5;margin-bottom:20px">Tu rol no tiene acceso a esta sección. Si crees que es un error, contacta al administrador.</div>'
        + '<a href="index.html" style="display:inline-block;padding:10px 20px;background:#1B3F8B;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">← Volver al inicio</a>'
        + '</div>';
      document.body.appendChild(ov);
      document.body.style.overflow = 'hidden';
    } catch (e) { /* DOM no listo: el return del gate igual detiene la carga */ }
  }

  return {
    setUser: setUser, getUser: getUser, rol: rol, apps: apps,
    isSuperAdmin: isSuperAdmin, isAdmin: isAdmin,
    canEnter: canEnter, can: can, showNoAccess: showNoAccess,
    isSystemSuper: isSystemSuper, effRol: effRol, puedeQuitarSuper: puedeQuitarSuper,
    ROLES: ROLES, SUPER_ADMIN_EMAIL: SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAILS: SUPER_ADMIN_EMAILS
  };
})();

// ── Máscara de URL (decisión de UX 2026-07-02) ────────────────────────────────
// La barra de direcciones muestra siempre SOLO el dominio (app.multiaire.com.pe),
// sin /pagina.html. Es cosmético, NO seguridad (cada módulo mantiene su gate de
// auth + firestore.rules). Los deep-links SÍ abren (la máscara reescribe después
// de cargar la página), solo que no se pueden copiar de la barra. Se omite en
// localhost para no estorbar el desarrollo local. Revertir = borrar este bloque.
//
// RECARGA DENTRO DE UN MÓDULO (fix 2026-07-05, reporte del usuario): con la URL
// enmascarada, F5 recargaba "/" y te botaba al índice. Ahora cada módulo recuerda
// su página en sessionStorage (por pestaña) y el índice, al cargar, te devuelve al
// módulo recordado. Navegar a propósito (clic en ← Inicio o en cualquier link
// interno) limpia el recuerdo, así que ir al índice sigue funcionando normal.
(function () {
  try {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    // Solo la raíz o páginas .html servidas en la raíz: en subrutas tipo GitHub
    // Pages (/repo/ y también /repo sin slash, que redirige a /repo/),
    // replaceState('/') cambia la base de los href relativos y rompe la navegación.
    if (location.pathname !== '/' && !/^\/[^/]+\.html?$/i.test(location.pathname)) return;

    var esIndex = location.pathname === '/' || /^\/index\.html?$/i.test(location.pathname);
    if (esIndex) {
      // ¿Esta pestaña estaba dentro de un módulo? → volver ahí (fue un F5, no un clic)
      var rec = sessionStorage.getItem('ma_pagina');
      if (rec && /^\/[^/]+\.html?$/i.test(rec) && !/^\/index\.html?$/i.test(rec)) {
        location.replace(rec);
        return;
      }
    } else {
      sessionStorage.setItem('ma_pagina', location.pathname);
    }

    if (location.pathname !== '/' || location.search || location.hash) {
      history.replaceState(null, '', '/');
    }

    // Clic en cualquier link interno = navegación A PROPÓSITO → olvidar el módulo
    // (el destino se recuerda solo al cargar; el índice no recuerda nada).
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && a.host === location.host) sessionStorage.removeItem('ma_pagina');
    }, true);
  } catch (e) { /* sin history/sessionStorage (iframe sandbox): URL tal cual */ }
})();
