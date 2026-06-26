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

  var SUPER_ADMIN_EMAIL = 'marchenaangulojoseluis@gmail.com';
  var ROLES = ['TECNICO', 'SUPERVISOR', 'ADMIN', 'SUPER_ADMIN'];

  // Capacidades reservadas SOLO a SUPER_ADMIN.
  //  • 'backup' = respaldo/restauración COMPLETA del sistema (configuracion.html).
  //  • 'exportar' (Excel operativo de un módulo) es OPERATIVA, no crítica.
  var SOLO_SUPER = ['borrar', 'backup', 'importMasiva', 'gestionUsuarios', 'config'];
  // Acciones operativas que un SUPERVISOR sí puede ejercer dentro de sus apps[].
  var OPERATIVAS = ['ver', 'crear', 'editar', 'aprobar', 'exportar', 'salida', 'transferencia', 'crearItem'];

  var _user = null; // { email, rol, apps:[] }

  function setUser(u) {
    _user = u || null;
    // Refuerzo defensivo: el creador siempre es SUPER_ADMIN aunque Firestore
    // aún no lo refleje (cada página ya lo hace, pero no dependemos de ello).
    if (_user && (_user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL) {
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
    ROLES: ROLES, SUPER_ADMIN_EMAIL: SUPER_ADMIN_EMAIL
  };
})();
