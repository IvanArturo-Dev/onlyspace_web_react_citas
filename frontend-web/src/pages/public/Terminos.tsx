import { useEffect } from "react";
import LegalPage, { LegalSection, legalText as t } from "./LegalPage";
import { trackEvent } from "../../lib/firebase";

/**
 * Terminos y Condiciones de uso de onlyspace. Pagina publica (sin sesion).
 * Contenido real y aplicable a la plataforma de reserva de citas: alcance del
 * servicio, cuentas, uso aceptable, reservas/cancelaciones, pagos, propiedad
 * intelectual, responsabilidad y contacto.
 */
export default function Terminos() {
  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Terminos y Condiciones" });
  }, []);

  return (
    <LegalPage title="Terminos y Condiciones" updatedAt="febrero de 2026">
      <p style={t.p}>
        Estos Terminos y Condiciones (los <strong style={t.strong}>"Terminos"</strong>) regulan el
        acceso y uso de la plataforma onlyspace, disponible en{" "}
        <a href="https://onlyspace.site" style={t.a}>onlyspace.site</a> (el{" "}
        <strong style={t.strong}>"Servicio"</strong>). Al crear una cuenta, reservar una cita o
        utilizar el Servicio, aceptas estos Terminos. Si no estas de acuerdo, no utilices el
        Servicio.
      </p>

      <LegalSection heading="1. Descripcion del servicio">
        <p style={t.p}>
          onlyspace es una plataforma que permite a negocios (los{" "}
          <strong style={t.strong}>"Emprendedores"</strong>) publicar sus servicios y gestionar
          agendas, y a las personas usuarias (los <strong style={t.strong}>"Clientes"</strong>)
          buscar negocios y reservar citas en linea, presenciales o a domicilio. onlyspace actua
          como intermediario tecnologico: el servicio final (corte, consulta, tratamiento, etc.) lo
          presta directamente el Emprendedor, no onlyspace.
        </p>
      </LegalSection>

      <LegalSection heading="2. Cuentas de usuario">
        <ul style={t.ul}>
          <li style={t.li}>
            Para reservar o gestionar citas puedes iniciar sesion mediante un proveedor de
            identidad (por ejemplo, Google). Eres responsable de la actividad realizada desde tu
            cuenta.
          </li>
          <li style={t.li}>
            Debes proporcionar informacion veraz y mantenerla actualizada, incluyendo un telefono
            de contacto valido cuando reserves.
          </li>
          <li style={t.li}>
            Debes ser mayor de edad o contar con autorizacion de tu tutor para usar el Servicio.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. Reservas, cancelaciones e inasistencias">
        <ul style={t.ul}>
          <li style={t.li}>
            Al reservar aceptas la fecha, hora, modalidad y condiciones publicadas por el
            Emprendedor. Para citas a domicilio deberas indicar una direccion y un enlace de
            ubicacion validos.
          </li>
          <li style={t.li}>
            Cada Emprendedor define su propia politica de cancelacion, tiempos de gracia y posibles
            penalizaciones. onlyspace muestra y aplica esas reglas, pero no las fija.
          </li>
          <li style={t.li}>
            Las inasistencias reiteradas pueden derivar en la suspension de tu capacidad de
            reservar con un negocio, conforme a las politicas del Emprendedor.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. Uso aceptable">
        <p style={t.p}>Al usar el Servicio te comprometes a NO:</p>
        <ul style={t.ul}>
          <li style={t.li}>Publicar contenido falso, ilicito, ofensivo o que infrinja derechos de terceros.</li>
          <li style={t.li}>Suplantar a otra persona o negocio, ni crear reservas fraudulentas.</li>
          <li style={t.li}>Intentar vulnerar la seguridad del Servicio, acceder a datos ajenos o interferir con su funcionamiento.</li>
          <li style={t.li}>Utilizar el Servicio para enviar spam o realizar actividades no autorizadas.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Planes y pagos">
        <p style={t.p}>
          El uso basico del Servicio para reservar es gratuito para los Clientes. Los Emprendedores
          pueden contratar planes de suscripcion con funciones adicionales. Los cobros de
          suscripcion se procesan a traves de proveedores de pago externos; onlyspace no almacena
          los datos completos de tarjetas. Los precios y condiciones vigentes se muestran al
          momento de la contratacion.
        </p>
      </LegalSection>

      <LegalSection heading="6. Publicidad">
        <p style={t.p}>
          El Servicio puede mostrar espacios publicitarios de terceros junto al contenido de la
          plataforma. Dichos anuncios se identifican como publicidad y se rigen por las politicas
          del proveedor correspondiente. onlyspace no respalda necesariamente los productos o
          servicios anunciados.
        </p>
      </LegalSection>

      <LegalSection heading="7. Propiedad intelectual">
        <p style={t.p}>
          La plataforma, su codigo, diseno, marcas y contenidos propios son titularidad de
          onlyspace o de sus licenciantes. Los Emprendedores conservan los derechos sobre los
          contenidos que publican (logotipos, imagenes, descripciones) y otorgan a onlyspace una
          licencia limitada para mostrarlos dentro del Servicio.
        </p>
      </LegalSection>

      <LegalSection heading="8. Limitacion de responsabilidad">
        <p style={t.p}>
          onlyspace ofrece el Servicio "tal cual" y hace esfuerzos razonables para mantener su
          disponibilidad, sin garantizar que sea ininterrumpido o libre de errores. onlyspace no es
          responsable de la calidad, seguridad o legalidad de los servicios prestados por los
          Emprendedores, ni de acuerdos celebrados directamente entre Clientes y Emprendedores.
        </p>
      </LegalSection>

      <LegalSection heading="9. Cambios en los Terminos">
        <p style={t.p}>
          Podemos actualizar estos Terminos para reflejar cambios en el Servicio o en la
          normativa aplicable. La version vigente estara siempre disponible en esta pagina, con su
          fecha de actualizacion. El uso continuado del Servicio tras un cambio implica su
          aceptacion.
        </p>
      </LegalSection>

      <LegalSection heading="10. Legislacion aplicable">
        <p style={t.p}>
          Estos Terminos se rigen por las leyes de los Estados Unidos Mexicanos. Cualquier
          controversia se resolvera ante los tribunales competentes, sin perjuicio de los derechos
          que la ley reconozca a las personas consumidoras.
        </p>
      </LegalSection>

      <LegalSection heading="11. Contacto">
        <p style={t.p}>
          Para dudas sobre estos Terminos, escribenos a{" "}
          <a href="mailto:soporte@onlyspace.site" style={t.a}>soporte@onlyspace.site</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}