import { useEffect } from "react";
import LegalPage, { LegalSection, legalText as t } from "./LegalPage";
import { trackEvent } from "../../lib/firebase";

/**
 * Aviso de Privacidad de onlyspace. Pagina publica (sin sesion). Redactado
 * conforme a la Ley Federal de Proteccion de Datos Personales en Posesion de
 * los Particulares (LFPDPPP) de Mexico: identidad del responsable, datos que se
 * recaban, finalidades, transferencias, derechos ARCO y contacto.
 */
export default function Privacidad() {
  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Aviso de Privacidad" });
  }, []);

  return (
    <LegalPage title="Aviso de Privacidad" updatedAt="febrero de 2026">
      <p style={t.p}>
        En onlyspace valoramos tu privacidad. Este Aviso describe que datos personales tratamos,
        con que finalidad y como puedes ejercer tus derechos, conforme a la Ley Federal de
        Proteccion de Datos Personales en Posesion de los Particulares (LFPDPPP) y su Reglamento.
      </p>

      <LegalSection heading="1. Responsable del tratamiento">
        <p style={t.p}>
          onlyspace (el <strong style={t.strong}>"Responsable"</strong>), operador de la plataforma
          disponible en <a href="https://onlyspace.site" style={t.a}>onlyspace.site</a>, es
          responsable del tratamiento de tus datos personales. Para cualquier asunto relacionado
          con este Aviso puedes contactarnos en{" "}
          <a href="mailto:privacidad@onlyspace.site" style={t.a}>privacidad@onlyspace.site</a>.
        </p>
      </LegalSection>

      <LegalSection heading="2. Datos personales que recabamos">
        <ul style={t.ul}>
          <li style={t.li}>
            <strong style={t.strong}>Identificacion y contacto:</strong> nombre, correo
            electronico y numero de telefono.
          </li>
          <li style={t.li}>
            <strong style={t.strong}>Datos de la cuenta:</strong> identificador del proveedor de
            inicio de sesion (por ejemplo, Google) y foto de perfil si el proveedor la comparte.
          </li>
          <li style={t.li}>
            <strong style={t.strong}>Datos de reservas:</strong> negocio, servicio, fecha, hora,
            modalidad e historial de citas.
          </li>
          <li style={t.li}>
            <strong style={t.strong}>Datos de ubicacion:</strong> para citas a domicilio, la
            direccion y enlace de mapa que proporciones; opcionalmente tu ubicacion aproximada si
            activas "cerca de mi" en el buscador.
          </li>
          <li style={t.li}>
            <strong style={t.strong}>Datos tecnicos:</strong> direccion IP, tipo de dispositivo y
            navegador, y datos de uso mediante cookies o tecnologias similares.
          </li>
        </ul>
        <p style={t.p}>
          No recabamos datos personales sensibles. No solicitamos datos financieros completos: los
          pagos de suscripcion se procesan directamente por proveedores de pago externos.
        </p>
      </LegalSection>

      <LegalSection heading="3. Finalidades del tratamiento">
        <p style={t.p}>Finalidades primarias (necesarias para el Servicio):</p>
        <ul style={t.ul}>
          <li style={t.li}>Crear y administrar tu cuenta y autenticarte.</li>
          <li style={t.li}>Gestionar reservas, recordatorios y comunicaciones sobre tus citas.</li>
          <li style={t.li}>Permitir al negocio contactarte para coordinar el servicio reservado.</li>
          <li style={t.li}>Brindar soporte y garantizar la seguridad de la plataforma.</li>
        </ul>
        <p style={t.p}>Finalidades secundarias (puedes oponerte sin afectar el Servicio):</p>
        <ul style={t.ul}>
          <li style={t.li}>Mejorar la plataforma mediante analiticas de uso.</li>
          <li style={t.li}>Enviarte informacion sobre novedades o promociones de onlyspace.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Transferencias y encargados">
        <p style={t.p}>
          Compartimos tus datos con el negocio (Emprendedor) con el que reservas, unicamente para
          prestar el servicio solicitado. Tambien utilizamos proveedores que actuan como
          encargados (por ejemplo, alojamiento en la nube, autenticacion, procesamiento de pagos y
          publicidad), quienes tratan los datos conforme a nuestras instrucciones y a la normativa
          aplicable. No vendemos tus datos personales.
        </p>
      </LegalSection>

      <LegalSection heading="5. Cookies y tecnologias similares">
        <p style={t.p}>
          Utilizamos cookies y tecnologias similares para mantener tu sesion, recordar preferencias
          (como el tema visual) y medir el uso del Servicio. Los espacios publicitarios de terceros
          pueden emplear sus propias cookies conforme a sus politicas. Puedes gestionar las cookies
          desde la configuracion de tu navegador.
        </p>
      </LegalSection>

      <LegalSection heading="6. Derechos ARCO y revocacion">
        <p style={t.p}>
          Tienes derecho a <strong style={t.strong}>Acceder</strong>, <strong style={t.strong}>Rectificar</strong>,{" "}
          <strong style={t.strong}>Cancelar</strong> u <strong style={t.strong}>Oponerte</strong> (derechos ARCO) al
          tratamiento de tus datos, asi como a revocar tu consentimiento. Para ejercerlos, envia tu
          solicitud a <a href="mailto:privacidad@onlyspace.site" style={t.a}>privacidad@onlyspace.site</a>{" "}
          indicando tu nombre, el derecho que deseas ejercer y la informacion que permita
          identificarte. Atenderemos tu solicitud en los plazos que marca la ley.
        </p>
      </LegalSection>

      <LegalSection heading="7. Conservacion y seguridad">
        <p style={t.p}>
          Conservamos tus datos mientras mantengas una cuenta activa y por el tiempo necesario para
          cumplir las finalidades descritas y obligaciones legales. Aplicamos medidas de seguridad
          administrativas, tecnicas y fisicas razonables, incluyendo cifrado en transito (HTTPS) y
          control de acceso, para proteger tus datos.
        </p>
      </LegalSection>

      <LegalSection heading="8. Cambios al Aviso de Privacidad">
        <p style={t.p}>
          Podemos actualizar este Aviso ante cambios legales o del Servicio. Publicaremos la
          version vigente en esta pagina con su fecha de actualizacion.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contacto">
        <p style={t.p}>
          Si tienes dudas sobre el tratamiento de tus datos, escribenos a{" "}
          <a href="mailto:privacidad@onlyspace.site" style={t.a}>privacidad@onlyspace.site</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}