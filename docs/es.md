# AppTable Elior — documentación

Esta integración conecta Gladys con **AppTable**, la aplicación de los comedores
escolares de **Elior** (sustituye a la antigua aplicación Bon'App). Para cada uno de sus
hijos lee el menú del comedor y la reserva de la comida, y para su cuenta, las facturas
pendientes.

## Requisitos

- Gladys **5.3** o posterior.
- Una cuenta de AppTable (la de la aplicación móvil o de
  [apptable.elior.com](https://apptable.elior.com)), con al menos un niño vinculado.
- Gladys necesita acceso a Internet: AppTable es un servicio en la **nube**.

## Configuración

1. Instale la integración **AppTable Elior** desde el catálogo de integraciones.
2. En la pantalla **Configuración** de la integración, rellene:
   - **Correo electrónico**: la dirección de su cuenta de AppTable;
   - **Contraseña**: la contraseña de esa cuenta (un campo secreto, nunca mostrado ni
     escrito en los registros);
   - **Intervalo de actualización**: cada cuánto se lee AppTable, en minutos (60 por
     defecto, de 15 a 1440).
3. Pulse **Probar la conexión**: el mensaje indica el número de niños encontrados y el
   número de facturas pendientes.
4. En la pestaña **Descubrir**, añada los dispositivos propuestos.

Si la contraseña es rechazada, la pantalla de configuración lo indica. Si AppTable no
está disponible, la integración lo vuelve a intentar sola en el siguiente intervalo.

## Dispositivos

**Un dispositivo por niño** — «Cantine Léa»:

| Función                   | Tipo                  | Contenido                                   |
| ------------------------- | --------------------- | ------------------------------------------- |
| Repas réservé aujourd'hui | interruptor (lectura) | 1 = reservado hoy, 0 = no reservado         |
| Repas réservé demain      | interruptor (lectura) | 1 = reservado mañana, 0 = no reservado      |
| Menu d'aujourd'hui        | texto                 | «Carottes râpées, Poulet basquaise, Yaourt» |
| Menu de demain            | texto                 | lo mismo, para mañana                       |

Un día sin comida (fin de semana, vacaciones, menú aún no publicado) muestra «—». Las
reservas solo aparecen si su cuenta gestiona las reservas de ese niño.

**Un dispositivo para la cuenta** — «AppTable – Factures»:

| Función          | Tipo     | Contenido                                 |
| ---------------- | -------- | ----------------------------------------- |
| Montant à payer  | moneda   | total de las facturas sin pagar, en euros |
| Factures à payer | contador | número de facturas pendientes de pago     |

Los nombres de dispositivos y funciones están en francés, como el servicio AppTable:
puede cambiarlos en Gladys. Las reservas se modifican en la aplicación AppTable (donde
se muestran los plazos y precios del municipio): en Gladys son de solo lectura.

### Hermanos: un solo menú

Dos niños que comen en el **mismo restaurante escolar y la misma sección** tienen el
mismo menú. La integración lo pide entonces **una sola vez** a AppTable, y el widget
«Menú del comedor» lo muestra una sola vez con los nombres de los niños afectados. Cada
niño conserva su propio dispositivo y sus propias reservas.

## Disparadores de escena

- **Hay una nueva factura del comedor** — acaba de aparecer una factura en la cuenta.
  Variables: `label`, `amount` (en €), `period` (mes, AAAA-MM), `paid`. Las facturas ya
  presentes en la primera instalación no se anuncian.
- **Ha cambiado una reserva de comida** — la comida de hoy o de mañana de un niño se ha
  reservado o cancelado (por el otro progenitor, el colegio o usted). Filtros: el niño,
  el cambio (reservado / cancelado), el día (hoy / mañana). Variables: `child_name`,
  `change`, `when`, `date`.

## Acciones de escena

- **Leer el menú del comedor de un niño** — elija el niño y el día (próxima comida, hoy,
  mañana). Resultados: `menu` (el menú en una línea), `has_menu`, `date`, `booked`,
  `child_name`. «Próxima comida» significa hoy hasta las 14 h, después el siguiente día
  con menú (el lunes, un viernes por la tarde).
- **Actualizar AppTable ahora** — lee AppTable sin esperar al intervalo. Resultados:
  `children`, `amount_due`, `invoices_to_pay`.

Ejemplo de escena matinal: disparador «todos los días a las 7:30», acción «Leer el menú
del comedor de un niño», luego «Enviar un mensaje» con el texto
`Hoy en el comedor: {{0.0.menu}}`.

## Widgets del panel

- **Menú del comedor** — el menú del día elegido (próxima comida, hoy o mañana). Un solo
  menú para todos los niños: los platos se listan directamente. Menús distintos
  (colegios distintos): una fila por menú, el detalle al pulsar. Debajo, la reserva de
  cada niño para ese día.
- **Cuenta del comedor** — el importe a pagar y el número de facturas (en directo), las
  reservas de mañana, la hora de la última actualización, un botón **Actualizar** y un
  enlace a AppTable.

## Preguntas frecuentes

**El menú muestra «—».** Ese día no se sirve comida, o la cocina aún no ha publicado el
menú.

**Las facturas no aparecen.** Algunos municipios no facturan a través de AppTable: el
dispositivo «Factures» queda vacío, los menús siguen funcionando.

**¿Se comparten mis datos?** No. La integración habla directamente con AppTable, con su
cuenta, desde su Gladys. La contraseña se queda en el campo secreto de Gladys.

**¿Es una integración oficial de Elior?** No. Es una integración de la comunidad, que
usa la misma interfaz que el sitio de AppTable. Si Elior cambia esa interfaz, puede ser
necesaria una actualización de la integración.

## Diagnóstico

Active **Registros detallados** en la configuración y consulte los registros de la
integración. La contraseña y los tokens de conexión nunca aparecen en ellos.
