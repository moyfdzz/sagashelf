import { enUS, esMX } from "@clerk/localizations";

/**
 * `esMX` from @clerk/localizations leaves some texts of the sign-in and sign-up flows
 * undefined, and Clerk then shows them in English. These fill the ones a visitor can reach
 * (the bot check, the username and password fields, and their errors) in neutral Latin
 * American Spanish. Re-check this list when the package is updated: a key it now translates
 * can be dropped from here.
 */
export const spanish: typeof esMX = {
  ...esMX,
  formFieldInputPlaceholder__username: "Ingresa tu nombre de usuario",
  formFieldInputPlaceholder__signUpPassword: "Crea una contraseña",
  formFieldInput__emailAddress_format: "Formato de ejemplo: nombre@ejemplo.com",
  signIn: {
    ...esMX.signIn,
    passwordCompromised: {
      ...esMX.signIn?.passwordCompromised,
      title: "Contraseña comprometida",
    },
    passwordUntrusted: {
      ...esMX.signIn?.passwordUntrusted,
      title: "Contraseña no confiable",
    },
    protectCheck: {
      loading: "Cargando…",
      retryButton: "Intentar de nuevo",
      subtitle: "Espera mientras verificamos tu solicitud.",
      title: "Verificando tu solicitud",
    },
  },
  signUp: {
    ...esMX.signUp,
    protectCheck: {
      loading: "Cargando…",
      retryButton: "Intentar de nuevo",
      subtitle: "Espera mientras verificamos tu solicitud.",
      title: "Verificando tu solicitud",
    },
  },
  unstable__errors: {
    ...esMX.unstable__errors,
    form_password_matches_identifier:
      "La contraseña no puede ser igual a tu correo, teléfono o nombre de usuario. Por la seguridad de tu cuenta, usa una distinta.",
    form_password_untrusted__sign_in:
      "Tu contraseña podría estar comprometida. Para proteger tu cuenta, continúa con otro método de inicio de sesión. Tendrás que restablecer tu contraseña después de entrar.",
    oauth_access_denied: "No concediste acceso a tu cuenta.",
    protect_check_execution_failed:
      "La verificación no se completó. Inténtalo de nuevo.",
    protect_check_invalid_script:
      "No se pudo cargar la verificación. Si persiste, contáctanos.",
    protect_check_invalid_sdk_url:
      "No se pudo iniciar la verificación. Contáctanos.",
    protect_check_required:
      "Este inicio de sesión necesita un paso extra de verificación que no se puede mostrar aquí. Inténtalo de nuevo o usa otro método.",
    protect_check_script_load_failed:
      "No se pudo cargar la verificación. Puede ser un problema de red. Inténtalo de nuevo o contáctanos.",
    protect_check_timed_out:
      "La verificación no se completó a tiempo. Inténtalo de nuevo.",
    protect_check_unsupported_environment:
      "La verificación no es compatible con este entorno. Continúa en un navegador estándar o contáctanos.",
    too_many_unverified_identifications:
      "Hay demasiadas verificaciones pendientes en esta cuenta. Elimina un correo sin verificar que ya no necesites, o espera unos minutos, e inténtalo de nuevo.",
  },
};

export const english: typeof enUS = enUS;
