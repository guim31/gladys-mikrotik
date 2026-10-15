# MikroTik

Siga su router [MikroTik](https://mikrotik.com) desde Gladys, en su red local:
sepa quién está en casa gracias a los teléfonos conectados a su Wi-Fi, vigile
el estado del router y el caudal de su acceso a internet, reciba un aviso
cuando el WAN se corta o se conecta un dispositivo desconocido y, si lo
permite, corte internet en la tableta de los niños desde una escena.

> **Desarrollada sin el hardware: sus comentarios son bienvenidos.** Esta
> integración se ha escrito y probado con las respuestas documentadas por
> MikroTik y los datos de prueba de la integración de Home Assistant, no con
> un router real. Si algo no funciona como se describe, dígalo en el
> [foro de Gladys](https://community.gladysassistant.com) o en los
> [issues](https://github.com/guim31/gladys-mikrotik/issues).

Esta integración no está afiliada a MikroTik.

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un router MikroTik con **RouterOS 7** (API REST) o **RouterOS 6.43** o
  posterior (API), accesible desde Gladys.
- Uno de estos servicios de RouterOS activado (**IP** → **Services**):
  `www-ssl` (HTTPS, RouterOS 7), `api-ssl`, `www` (HTTP, RouterOS 7) o `api`.
  La configuración por defecto de RouterOS activa `www` y `api`.
- Un usuario de RouterOS para Gladys (ver abajo).

## Puesta en marcha

### El usuario de RouterOS

Cree un usuario dedicado en lugar de usar `admin`. Una cuenta de **solo
lectura** basta para los sensores de presencia, las medidas, los
desencadenantes y los widgets. En un terminal (WinBox, WebFig o SSH):

```
/user add name=gladys group=read password=una-contrasena-larga
```

Compruebe que el grupo tiene el permiso `api`, y `rest-api` en RouterOS 7
(**System** → **Users** → **Groups**). Las órdenes (reglas de cortafuegos,
reinicio) necesitan un grupo con los permisos `write` y `reboot`, como
`write`.

Para ir más allá, permita el servicio solo desde la dirección de Gladys, por
ejemplo `/ip service set www address=192.168.88.10/32`.

### La configuración

Abra **Integraciones** → **MikroTik** → **Configuración**:

- **Dirección del router**: su dirección IP (`192.168.88.1` por defecto), con
  `:puerto` si el servicio no usa su puerto predeterminado.
- **Nombre de usuario** y **Contraseña** del usuario de RouterOS.
- **Protocolo**: _Automático_ prueba REST por HTTPS, API-SSL, REST por HTTP y
  luego API, y conserva el primero que funciona; los cifrados primero. Elija
  uno para imponerlo.
- **Aceptar un certificado autofirmado**: para HTTPS y API-SSL. RouterOS usa
  un certificado autofirmado si no ha instalado otro.
- **Intervalo de actualización**: de 10 segundos a 1 minuto (30 segundos por
  defecto).
- **Interfaces WAN**: vacío, la integración toma los miembros de la lista de
  interfaces `WAN` de RouterOS (la configuración por defecto pone `ether1`),
  si no `ether1`. Cuatro nombres como máximo, separados por comas.
- **Presencia**: el **Retraso de salida (minutos)** y las fuentes (ver abajo).
- **Reglas de cortafuegos que seguir** y **Permitir órdenes** (ver abajo).
- **Idioma de los nombres**: el idioma de los nombres de dispositivos y
  funciones.

Pulse después **Probar la conexión**: el informe indica el protocolo usado,
las interfaces WAN seguidas, cuántos clientes se ven y si las reglas seguidas
existen. Abra por último la pestaña **Descubrir** y añada los dispositivos que
desee.

## Los dispositivos

### El router

Un dispositivo, con el nombre de la identidad de RouterOS:

| Función                              | Lo que muestra                                        |
| ------------------------------------ | ----------------------------------------------------- |
| Carga del procesador                 | en %                                                  |
| Memoria usada                        | en %                                                  |
| Temperatura                          | en °C, cuando el router tiene un sensor               |
| Tiempo de funcionamiento             | en horas                                              |
| Versión de RouterOS                  | p. ej. `7.18.2`                                       |
| Actualización de RouterOS disponible | Encendido cuando RouterOS indica una versión nueva    |
| Descarga / Subida                    | por interfaz WAN, en Mbit/s, media de un ciclo        |
| Enlace WAN                           | por interfaz WAN: Encendido cuando el enlace funciona |

La integración pide a RouterOS que busque actualizaciones una vez al día (un
usuario de solo lectura no puede: se muestra entonces la última búsqueda hecha
por RouterOS).

### Sensores de presencia

La pestaña Descubrir lista los clientes del router: sus concesiones DHCP, sus
tablas de registro Wi-Fi (`wireless`, `wifiwave2`, `wifi` y CAPsMAN) y, si
está activada, su tabla ARP. Añada los teléfonos que quiera seguir: cada uno
se convierte en un sensor **Presencia**, con el nombre de su comentario en
RouterOS, si no su nombre de host.

- Un dispositivo está **presente** en cuanto el router lo ve: asociado al
  Wi-Fi, o con una entrada ARP viva si **Usar también la tabla ARP** está
  marcado, o con una concesión DHCP activa si **Contar una concesión DHCP como
  presente** está marcado.
- Solo pasa a **ausente** si no se ha visto durante el **Retraso de salida**
  (5 minutos por defecto): un teléfono en reposo deja el Wi-Fi unos minutos
  sin salir de casa.
- Cuando el router no se puede leer, nadie cambia de estado.

Un dispositivo presente se publica de nuevo cada dos minutos, de modo que la
acción de escena _Comprobar presencia del usuario_ de Gladys también funciona; con el
retraso de salida, rara vez la necesitará.

Los teléfonos usan una dirección Wi-Fi privada (aleatoria) por red. Manténgala
**fija** para el Wi-Fi de casa (en iOS: _Dirección Wi-Fi privada_ en _Fija_;
en Android: aleatoria por red, no por conexión), si no el dispositivo parecerá
nuevo tras un cambio.

### Reglas de cortafuegos

Para seguir una regla, dele un comentario en RouterOS (**IP** → **Firewall** →
**Filter Rules**) e introduzca ese comentario en **Reglas de cortafuegos que
seguir** (**Listar las reglas de cortafuegos** muestra las reglas comentadas).
Cada una se convierte en un dispositivo con una función **Regla activada**
(Encendido cuando la regla está activada). Las reglas IPv4 e IPv6 que
comparten el comentario cuentan como una.

El estado es de solo lectura. Con **Permitir órdenes** marcado, las acciones de
escena y el widget pueden activar o desactivar la regla: la integración solo
cambia entonces el indicador `disabled` de esas reglas, y nada más de la
configuración.

## Panel

Tres widgets:

- **Router MikroTik**: procesador, memoria, temperatura, caudal de descarga y
  de subida de la primera interfaz WAN, el estado de cada enlace WAN, el
  tiempo de funcionamiento, la versión de RouterOS o la actualización
  disponible, y un botón **Reiniciar** (con confirmación) cuando las órdenes
  están permitidas.
- **Dispositivos presentes**: los dispositivos seguidos como sensores de
  presencia, presentes primero, con el tiempo que llevan ausentes los demás.
  Su ajuste **Mostrar** conserva solo los presentes.
- **Reglas de cortafuegos**: las reglas seguidas y, cuando las órdenes están
  permitidas, un botón por regla (cuatro como máximo) para activarla o
  desactivarla, con confirmación. Una marca indica las reglas activadas.

## Escenas

### Desencadenantes

- **Dispositivo desconocido conectado**: una dirección MAC nunca vista se ha
  conectado al Wi-Fi o ha obtenido una concesión DHCP. Los dispositivos
  presentes en el primer arranque de la integración se aprenden sin
  desencadenar. Filtro: _Visto por_ (Wi-Fi o concesión DHCP). Variables:
  dirección MAC, dirección IP, nombre de host, visto por, interfaz.
- **Enlace WAN cortado**: una interfaz WAN ha perdido su enlace. Filtro:
  _Interfaz_. Variable: interfaz.
- **Enlace WAN restablecido**: el enlace ha vuelto. Filtro: _Interfaz_.
  Variables: interfaz, corte en minutos.

### Acciones

Necesitan **Permitir órdenes** y un usuario de RouterOS con los permisos
`write` y `reboot`.

- **Activar una regla de cortafuegos** y **Desactivar una regla de
  cortafuegos**: elija un dispositivo regla. Salida: _Regla activada_.
- **Reiniciar el router MikroTik**: la red se corta uno o dos minutos.

### Ideas de escenas

- _Nadie en casa_: cuando la presencia de cada teléfono es «Sin presencia»,
  active la alarma y baje la calefacción.
- _Hora de dormir para la tableta_: cada noche a las 21:00, **Activar una regla
  de cortafuegos** «Bloquear tableta niños»; a las 7:00, **Desactivar una
  regla de cortafuegos**.
- _Corte de internet_: con **Enlace WAN cortado**, envíe un mensaje por un
  canal que no necesite internet (una pasarela SMS de la red local) y, con
  **Enlace WAN restablecido**, indique cuánto ha durado.
- _¿Quién es?_: con **Dispositivo desconocido conectado**, envíese un mensaje
  con su nombre de host y su dirección IP.

## Con qué frecuencia se lee el router

La integración lee ella misma el router, al intervalo de actualización de la
configuración (Gladys no consulta estos dispositivos). Una lectura son unas
diez listas pequeñas (recursos, estado, interfaces, Wi-Fi, ARP, concesiones
DHCP, reglas): insignificante para el router. El estado de las
actualizaciones se lee cada hora, y RouterOS consulta los servidores de
MikroTik una vez al día. Solo se envían a Gladys los valores que cambian, más
un latido cada seis horas.

## Solución de problemas

- **«nombre de usuario o contraseña rechazados»**: compruébelos en WinBox.
  Tras un rechazo, la integración vuelve a intentarlo cada cinco minutos (cada
  intento es una línea en el registro de RouterOS).
- **«al grupo del usuario le falta un permiso»**: dé al grupo `api` (y
  `rest-api` en RouterOS 7).
- **«certificado rechazado»**: marque **Aceptar un certificado autofirmado**,
  o instale un certificado reconocido por Gladys.
- **«no responde»**: compruebe la dirección, que el servicio está activado en
  **IP** → **Services** y que su campo `address` permite a Gladys.
- **Sin caudal WAN**: los caudales necesitan dos lecturas; compruebe los
  nombres en **Interfaces WAN**.
- **Un teléfono sigue ausente**: marque **Usar también la tabla ARP**, aumente
  el retraso de salida y compruebe que su dirección Wi-Fi privada es fija.
- Más detalles: arranque la integración con `LOG_LEVEL=debug`. En el nivel por
  defecto, los registros solo muestran el arranque, el router perdido y
  recuperado, los problemas (una vez cada uno) y sus órdenes. Las contraseñas
  nunca aparecen en los registros.

## Límites

- Un router por integración. Con varios puntos de acceso, siga la presencia en
  el que ve todos los clientes (el controlador CAPsMAN, o el router con la
  tabla ARP).
- El estado del enlace WAN es el de la interfaz: un corte de internet detrás
  de un enlace que funciona (del lado del operador) no se detecta.
- Los caudales son medias del intervalo de actualización, según los contadores
  de las interfaces.
- Las tablas Wi-Fi de puntos de acceso de otras marcas no se leen: use la
  tabla ARP.
- Los nombres de los dispositivos y funciones se fijan al añadir un
  dispositivo a Gladys.
- Solo reglas de filtrado del cortafuegos (no NAT, mangle ni Kid Control),
  encontradas por su comentario exacto.
- Desarrollada sin el hardware: las respuestas de routers reales pueden
  diferir de las documentadas. Sus comentarios son bienvenidos.
